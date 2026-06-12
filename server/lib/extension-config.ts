import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { extensionConfigs, extensionHeartbeats, extensionReleases } from '@/db/schema';
import { buildRequestContext, normalizeRequestClientInfo } from './request-context';

export const EXTENSION_CHANNELS = ['chrome_store', 'website'] as const;
export type ExtensionChannel = typeof EXTENSION_CHANNELS[number];
export type RolloutState = 'hidden' | 'available' | 'paused';

const DEFAULT_POLL_INTERVAL_SECONDS = 600;
const DEFAULT_VERSION = '0.1.0';
const DEFAULT_SCAN_POLICY = {
  minIntervalSeconds: 60,
  maxIntervalSeconds: 300,
  defaultIntervalSeconds: 120,
  allowedIntervalSeconds: [60, 120, 180, 300],
  requestSpacingMs: 2000,
  maxRequestsPerCycle: 30,
  maxRequestsPerTripPerCycle: 8,
  backoff: {
    errorBaseSeconds: 300,
    rateLimitBaseSeconds: 600,
    maxSeconds: 1800,
  },
};
const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

export function normalizeExtensionChannel(value: unknown): ExtensionChannel {
  return value === 'chrome_store' ? 'chrome_store' : 'website';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeLogSyncMinLevel(extraConfig: Record<string, unknown>) {
  return LOG_LEVELS.find(level => level === extraConfig.logSyncMinLevel) ?? 'info';
}

function normalizeScanPolicy(extraConfig: Record<string, unknown>) {
  const raw = optionalRecord(extraConfig.scanPolicy);
  const backoff = optionalRecord(raw.backoff);
  const allowed = Array.isArray(raw.allowedIntervalSeconds)
    ? raw.allowedIntervalSeconds.filter((item): item is number => Number.isInteger(item) && item > 0)
    : DEFAULT_SCAN_POLICY.allowedIntervalSeconds;

  const minIntervalSeconds = positiveInteger(raw.minIntervalSeconds, DEFAULT_SCAN_POLICY.minIntervalSeconds);
  const maxIntervalSeconds = Math.max(
    minIntervalSeconds,
    positiveInteger(raw.maxIntervalSeconds, DEFAULT_SCAN_POLICY.maxIntervalSeconds),
  );

  const allowedIntervalSeconds = allowed
    .filter(seconds => seconds >= minIntervalSeconds && seconds <= maxIntervalSeconds)
    .sort((a, b) => a - b);

  return {
    minIntervalSeconds,
    maxIntervalSeconds,
    defaultIntervalSeconds: Math.min(
      maxIntervalSeconds,
      Math.max(minIntervalSeconds, positiveInteger(raw.defaultIntervalSeconds, DEFAULT_SCAN_POLICY.defaultIntervalSeconds)),
    ),
    allowedIntervalSeconds: allowedIntervalSeconds.length ? allowedIntervalSeconds : DEFAULT_SCAN_POLICY.allowedIntervalSeconds,
    requestSpacingMs: positiveInteger(raw.requestSpacingMs, DEFAULT_SCAN_POLICY.requestSpacingMs),
    maxRequestsPerCycle: positiveInteger(raw.maxRequestsPerCycle, DEFAULT_SCAN_POLICY.maxRequestsPerCycle),
    maxRequestsPerTripPerCycle: positiveInteger(raw.maxRequestsPerTripPerCycle, DEFAULT_SCAN_POLICY.maxRequestsPerTripPerCycle),
    backoff: {
      errorBaseSeconds: positiveInteger(backoff.errorBaseSeconds, DEFAULT_SCAN_POLICY.backoff.errorBaseSeconds),
      rateLimitBaseSeconds: positiveInteger(backoff.rateLimitBaseSeconds, DEFAULT_SCAN_POLICY.backoff.rateLimitBaseSeconds),
      maxSeconds: positiveInteger(backoff.maxSeconds, DEFAULT_SCAN_POLICY.backoff.maxSeconds),
    },
  };
}

function optionalNotes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

export function extensionConfigRequestBody(body: unknown): {
  channel: ExtensionChannel;
  clientId?: string;
  extensionId?: string;
  browser?: string;
  locale?: string;
  clientInfo?: ReturnType<typeof normalizeRequestClientInfo>;
} {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return {
    channel: normalizeExtensionChannel(input.channel),
    clientId: optionalString(input.clientId),
    extensionId: optionalString(input.extensionId),
    browser: optionalString(input.browser),
    locale: optionalString(input.locale),
    clientInfo: normalizeRequestClientInfo(input),
  };
}

export async function getExtensionConfigResponse(channel: ExtensionChannel) {
  const [config] = await db
    .select()
    .from(extensionConfigs)
    .where(eq(extensionConfigs.channel, channel))
    .limit(1);

  const effectiveConfig = config ?? {
    channel,
    latestVersion: DEFAULT_VERSION,
    minSupportedVersion: DEFAULT_VERSION,
    rolloutState: 'hidden',
    pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
    downloadUrl: null,
    forceUpdateMessage: 'Please update campsoon to continue.',
    maintenanceEnabled: false,
    maintenanceMessage: null,
    featureFlags: {},
    extraConfig: {},
    updatedAt: new Date(),
  };

  const [release] = await db
    .select()
    .from(extensionReleases)
    .where(and(
      eq(extensionReleases.channel, channel),
      eq(extensionReleases.version, effectiveConfig.latestVersion),
    ))
    .orderBy(desc(extensionReleases.publishedAt), desc(extensionReleases.createdAt))
    .limit(1);

  const extraConfig = optionalRecord(effectiveConfig.extraConfig);

  return {
    serverTime: new Date().toISOString(),
    channel: effectiveConfig.channel,
    latestVersion: effectiveConfig.latestVersion,
    minSupportedVersion: effectiveConfig.minSupportedVersion,
    rolloutState: effectiveConfig.rolloutState,
    pollIntervalSeconds: effectiveConfig.pollIntervalSeconds,
    downloadUrl: effectiveConfig.downloadUrl,
    forceUpdateMessage: effectiveConfig.forceUpdateMessage,
    maintenance: {
      enabled: effectiveConfig.maintenanceEnabled,
      message: effectiveConfig.maintenanceMessage,
    },
    logSyncMinLevel: normalizeLogSyncMinLevel(extraConfig),
    featureFlags: optionalRecord(effectiveConfig.featureFlags),
    extraConfig,
    scanPolicy: normalizeScanPolicy(extraConfig),
    releaseNote: release ? {
      version: release.version,
      title: release.title,
      summary: release.summary,
      notes: optionalNotes(release.notes),
      changelogUrl: release.changelogUrl,
      publishedAt: release.publishedAt?.toISOString() ?? null,
    } : null,
    updatedAt: effectiveConfig.updatedAt.toISOString(),
  };
}

export async function recordExtensionHeartbeat(
  request: Request,
  body: ReturnType<typeof extensionConfigRequestBody>,
  userId?: string,
): Promise<void> {
  if (!body.clientId) return;

  const context = await buildRequestContext(request, body.clientId, body.clientInfo);
  await db.insert(extensionHeartbeats).values({
    clientId: body.clientId,
    userId,
    channel: body.channel,
    extensionVersion: body.clientInfo?.extensionVersion,
    extensionId: body.extensionId,
    browser: body.browser,
    locale: body.locale,
    userAgent: context.userAgent,
    platformOs: context.platformOs,
    platformArch: context.platformArch,
    ipAddress: context.ipAddress,
    country: context.country,
    region: context.region,
    city: context.city,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: extensionHeartbeats.clientId,
    set: {
      userId,
      channel: body.channel,
      extensionVersion: body.clientInfo?.extensionVersion,
      extensionId: body.extensionId,
      browser: body.browser,
      locale: body.locale,
      userAgent: context.userAgent,
      platformOs: context.platformOs,
      platformArch: context.platformArch,
      ipAddress: context.ipAddress,
      country: context.country,
      region: context.region,
      city: context.city,
      lastSeenAt: sql`now()`,
    },
  });
}
