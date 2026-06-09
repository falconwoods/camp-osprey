import crypto from 'node:crypto';

export interface ScanLeaseTripInput {
  id: string;
  userId: string;
  clientId?: string | null;
  name: string;
  parks: unknown;
  dateRanges: unknown;
  filters: unknown;
  mode: string;
  status: string;
  updatedAt?: Date | string | number | null;
}

export interface ScanLeasePayload {
  v: 1;
  leaseId: string;
  userId: string;
  tripId: string;
  clientId?: string;
  mode: string;
  tripHash: string;
  issuedAt: string;
  expiresAt: string;
}

const DEFAULT_TTL_SECONDS = 2 * 60 * 60;

function getLeaseSecret(): string {
  const secret = process.env.SCAN_LEASE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('SCAN_LEASE_SECRET or BETTER_AUTH_SECRET is required');
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function sign(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', getLeaseSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function scanLeaseTripHash(trip: ScanLeaseTripInput): string {
  const canonical = stableValue({
    id: trip.id,
    userId: trip.userId,
    clientId: trip.clientId ?? null,
    name: trip.name,
    parks: trip.parks,
    dateRanges: trip.dateRanges,
    filters: trip.filters,
    mode: trip.mode,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
}

export function createScanLease(input: {
  userId: string;
  trip: ScanLeaseTripInput;
  clientId?: string;
  ttlSeconds?: number;
}): { lease: string; payload: ScanLeasePayload } {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000);
  const payload: ScanLeasePayload = {
    v: 1,
    leaseId: crypto.randomUUID(),
    userId: input.userId,
    tripId: input.trip.id,
    clientId: input.clientId || input.trip.clientId || undefined,
    mode: input.trip.mode,
    tripHash: scanLeaseTripHash(input.trip),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return { lease: `${encodedPayload}.${sign(encodedPayload)}`, payload };
}

export function parseScanLease(lease: string): ScanLeasePayload {
  const [encodedPayload, signature, extra] = lease.split('.');
  if (!encodedPayload || !signature || extra) throw new Error('invalid_scan_lease');
  const expectedSignature = sign(encodedPayload);
  if (!timingSafeEqualString(signature, expectedSignature)) throw new Error('invalid_scan_lease');

  let payload: ScanLeasePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as ScanLeasePayload;
  } catch {
    throw new Error('invalid_scan_lease');
  }

  if (payload.v !== 1 || !payload.leaseId || !payload.userId || !payload.tripId || !payload.mode || !payload.tripHash) {
    throw new Error('invalid_scan_lease');
  }
  if (Number.isNaN(new Date(payload.expiresAt).getTime()) || Date.now() > new Date(payload.expiresAt).getTime()) {
    throw new Error('expired_scan_lease');
  }
  return payload;
}

export function verifyScanLease(input: {
  lease: unknown;
  userId: string;
  trip: ScanLeaseTripInput;
  clientId?: string;
}): ScanLeasePayload {
  if (typeof input.lease !== 'string' || !input.lease.trim()) throw new Error('scan_lease_required');
  const payload = parseScanLease(input.lease);
  if (payload.userId !== input.userId || payload.tripId !== input.trip.id) throw new Error('invalid_scan_lease');
  if (payload.mode !== input.trip.mode) throw new Error('invalid_scan_lease');
  if (payload.clientId && input.clientId && payload.clientId !== input.clientId) throw new Error('invalid_scan_lease');
  if (payload.tripHash !== scanLeaseTripHash(input.trip)) throw new Error('stale_scan_lease');
  return payload;
}
