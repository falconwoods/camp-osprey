export type ExtensionLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface ExtensionLogEntry {
  ts: string;
  level: ExtensionLogLevel;
  event: string;
  message: string;
  tripId?: string;
  tripName?: string;
  parkName?: string;
  siteName?: string;
  checkIn?: string;
  checkOut?: string;
  foundAt?: string;
  reservedAt?: string;
  paidAt?: string;
  bookingDate?: string;
  status?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtensionLogContext {
  userId: string;
  userEmail: string;
  clientId?: string;
  ipAddress?: string;
  country?: string;
  clientInfo?: ExtensionClientInfo;
}

export interface ExtensionClientInfo {
  extensionVersion?: string;
  userAgent?: string;
  platformOs?: string;
  platformArch?: string;
  platformNaclArch?: string;
}

const LOG_LEVEL_RANK: Record<ExtensionLogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const VALID_LEVELS = new Set(Object.keys(LOG_LEVEL_RANK));
const MAX_LOG_BATCH_SIZE = 500;

export function getServerLogMinLevel(): ExtensionLogLevel {
  const value = process.env.EXTENSION_LOG_MIN_LEVEL?.toLowerCase();
  return isExtensionLogLevel(value) ? value : 'info';
}

export function isExtensionLogLevel(value: unknown): value is ExtensionLogLevel {
  return typeof value === 'string' && VALID_LEVELS.has(value);
}

export function shouldAcceptLogLevel(level: ExtensionLogLevel, minLevel = getServerLogMinLevel()): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLevel];
}

export function normalizeExtensionLogEntries(body: unknown): ExtensionLogEntry[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const entries = (body as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.length > MAX_LOG_BATCH_SIZE) return [];

  return entries
    .map(normalizeExtensionLogEntry)
    .filter((entry): entry is ExtensionLogEntry => Boolean(entry));
}

export function normalizeExtensionLogClientId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const clientId = (body as { clientId?: unknown }).clientId;
  return typeof clientId === 'string' && clientId ? clientId : undefined;
}

export function normalizeExtensionClientInfo(body: unknown): ExtensionClientInfo | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const clientInfo = (body as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== 'object' || Array.isArray(clientInfo)) return undefined;

  const input = clientInfo as Partial<Record<keyof ExtensionClientInfo, unknown>>;
  const output: ExtensionClientInfo = {};
  for (const field of ['extensionVersion', 'userAgent', 'platformOs', 'platformArch', 'platformNaclArch'] as const) {
    if (typeof input[field] === 'string' && input[field]) output[field] = input[field];
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeExtensionLogEntry(value: unknown): ExtensionLogEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<ExtensionLogEntry>;
  if (typeof entry.ts !== 'string' || Number.isNaN(Date.parse(entry.ts))) return null;
  if (!isExtensionLogLevel(entry.level)) return null;
  if (typeof entry.event !== 'string' || !entry.event) return null;
  if (typeof entry.message !== 'string') return null;

  return {
    ts: entry.ts,
    level: entry.level,
    event: entry.event,
    message: entry.message,
    ...copyOptionalStringFields(entry),
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? entry.metadata
      : undefined,
  };
}

function copyOptionalStringFields(entry: Partial<ExtensionLogEntry>): Partial<ExtensionLogEntry> {
  const output: Partial<ExtensionLogEntry> = {};
  for (const field of [
    'tripId',
    'tripName',
    'parkName',
    'siteName',
    'checkIn',
    'checkOut',
    'foundAt',
    'reservedAt',
    'paidAt',
    'bookingDate',
    'status',
    'error',
  ] as const) {
    if (typeof entry[field] === 'string') output[field] = entry[field];
  }
  return output;
}

export function filterAcceptedExtensionLogs(
  entries: ExtensionLogEntry[],
  minLevel = getServerLogMinLevel(),
): ExtensionLogEntry[] {
  return entries.filter(entry => shouldAcceptLogLevel(entry.level, minLevel));
}

export async function sendExtensionLogsToLoki(
  entries: ExtensionLogEntry[],
  context: ExtensionLogContext,
): Promise<void> {
  if (entries.length === 0) return;

  const lokiUrl = process.env.LOKI_URL ?? 'http://localhost:3100';
  const response = await fetch(`${lokiUrl.replace(/\/$/, '')}/loki/api/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      streams: groupEntriesForLoki(entries, context),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Loki push failed: ${response.status} ${body}`);
  }
}

function groupEntriesForLoki(entries: ExtensionLogEntry[], context: ExtensionLogContext) {
  const grouped = new Map<ExtensionLogLevel, ExtensionLogEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.level, [...(grouped.get(entry.level) ?? []), entry]);
  }

  return [...grouped].map(([level, levelEntries]) => ({
    stream: {
      service: 'camposprey',
      source: 'extension',
      level,
    },
    values: levelEntries.map(entry => [
      timestampToNanoseconds(entry.ts),
      JSON.stringify({
        ...entry,
        userId: context.userId,
        userEmail: context.userEmail,
        clientId: context.clientId,
        ipAddress: context.ipAddress,
        country: context.country,
        clientInfo: context.clientInfo,
      }),
    ]),
  }));
}

function timestampToNanoseconds(ts: string): string {
  return String(BigInt(new Date(ts).getTime()) * BigInt(1_000_000));
}
