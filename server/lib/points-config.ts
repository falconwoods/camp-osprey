export interface PointPackage {
  id: string;
  name: string;
  points: number;
  stripePriceId: string;
}

let packageCache: PointPackage[] | null = null;

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function isPointPackage(value: unknown): value is PointPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pkg = value as Partial<PointPackage>;
  return typeof pkg.id === 'string' && pkg.id.trim().length > 0
    && typeof pkg.name === 'string' && pkg.name.trim().length > 0
    && Number.isInteger(pkg.points) && pkg.points > 0
    && typeof pkg.stripePriceId === 'string' && pkg.stripePriceId.trim().startsWith('price_');
}

export function getPointPackages(): PointPackage[] {
  if (packageCache) return packageCache;
  const raw = process.env.POINT_PACKAGES;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('POINT_PACKAGES must be valid JSON');
  }

  if (!Array.isArray(parsed) || !parsed.every(isPointPackage)) {
    throw new Error('POINT_PACKAGES must be an array of valid point packages');
  }

  const seen = new Set<string>();
  for (const pkg of parsed) {
    if (seen.has(pkg.id)) throw new Error(`POINT_PACKAGES contains duplicate id: ${pkg.id}`);
    seen.add(pkg.id);
  }

  packageCache = parsed.map(pkg => ({
    id: pkg.id.trim(),
    name: pkg.name.trim(),
    points: pkg.points,
    stripePriceId: pkg.stripePriceId.trim(),
  }));
  return packageCache;
}

export function getPointPackage(packageId: string): PointPackage | null {
  return getPointPackages().find(pkg => pkg.id === packageId) ?? null;
}

export function getSuccessfulBookingPointCost(): number {
  return parsePositiveInteger('SUCCESSFUL_BOOKING_POINT_COST', process.env.SUCCESSFUL_BOOKING_POINT_COST, 100);
}
