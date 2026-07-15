import { getClientId } from './storage'
import { getExtensionRemoteConfig } from './serverApi'
import type { ExtensionRemoteConfig } from './types'

const STORAGE_KEY = 'extensionConfig'
export const EXTENSION_DOWNLOAD_URL = 'https://dub.sh/x2yQGXT'
const DEFAULT_POLL_INTERVAL_SECONDS = 600
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
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result as Record<string, unknown>)))
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set(values, () => resolve()))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asLogLevel(value: unknown): ExtensionRemoteConfig['logSyncMinLevel'] {
  return value === 'debug' || value === 'info' || value === 'warning' || value === 'error'
    ? value
    : 'info'
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function normalizeScanPolicy(value: unknown): ExtensionRemoteConfig['scanPolicy'] {
  const raw = isRecord(value) ? value : {}
  const backoff = isRecord(raw.backoff) ? raw.backoff : {}
  const minIntervalSeconds = positiveInteger(raw.minIntervalSeconds, DEFAULT_SCAN_POLICY.minIntervalSeconds)
  const maxIntervalSeconds = Math.max(
    minIntervalSeconds,
    positiveInteger(raw.maxIntervalSeconds, DEFAULT_SCAN_POLICY.maxIntervalSeconds),
  )
  const allowed = Array.isArray(raw.allowedIntervalSeconds)
    ? raw.allowedIntervalSeconds.filter((item): item is number => Number.isInteger(item) && item > 0)
    : DEFAULT_SCAN_POLICY.allowedIntervalSeconds
  const allowedIntervalSeconds = allowed
    .filter(seconds => seconds >= minIntervalSeconds && seconds <= maxIntervalSeconds)
    .sort((a, b) => a - b)

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
  }
}

export function normalizeExtensionConfig(value: unknown): ExtensionRemoteConfig | null {
  if (!isRecord(value)) return null
  if (
    value.channel !== 'chrome_store' &&
    value.channel !== 'website'
  ) return null
  if (
    value.rolloutState !== 'hidden' &&
    value.rolloutState !== 'available' &&
    value.rolloutState !== 'paused'
  ) return null
  if (
    typeof value.latestVersion !== 'string' ||
    typeof value.minSupportedVersion !== 'string' ||
    typeof value.serverTime !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) return null

  const maintenance = isRecord(value.maintenance) ? value.maintenance : {}
  const userLimits = isRecord(value.userLimits) ? value.userLimits : {}
  const releaseNote = isRecord(value.releaseNote) &&
    typeof value.releaseNote.version === 'string' &&
    typeof value.releaseNote.title === 'string'
    ? {
        version: value.releaseNote.version,
        title: value.releaseNote.title,
        summary: typeof value.releaseNote.summary === 'string' ? value.releaseNote.summary : null,
        notes: asStringArray(value.releaseNote.notes),
        changelogUrl: typeof value.releaseNote.changelogUrl === 'string' ? value.releaseNote.changelogUrl : null,
        publishedAt: typeof value.releaseNote.publishedAt === 'string' ? value.releaseNote.publishedAt : null,
      }
    : null

  return {
    serverTime: value.serverTime,
    channel: value.channel,
    latestVersion: value.latestVersion,
    minSupportedVersion: value.minSupportedVersion,
    rolloutState: value.rolloutState,
    pollIntervalSeconds: typeof value.pollIntervalSeconds === 'number'
      ? Math.max(60, value.pollIntervalSeconds)
      : DEFAULT_POLL_INTERVAL_SECONDS,
    downloadUrl: typeof value.downloadUrl === 'string' ? value.downloadUrl : null,
    forceUpdateMessage: typeof value.forceUpdateMessage === 'string' ? value.forceUpdateMessage : null,
    maintenance: {
      enabled: maintenance.enabled === true,
      message: typeof maintenance.message === 'string' ? maintenance.message : null,
    },
    logSyncMinLevel: asLogLevel(value.logSyncMinLevel),
    scanPolicy: normalizeScanPolicy(value.scanPolicy),
    userLimits: {
      maxActiveTrips: positiveInteger(userLimits.maxActiveTrips, 1),
    },
    featureFlags: isRecord(value.featureFlags) ? value.featureFlags : {},
    extraConfig: isRecord(value.extraConfig) ? value.extraConfig : {},
    releaseNote,
    updatedAt: value.updatedAt,
    fetchedAt: typeof value.fetchedAt === 'string' ? value.fetchedAt : undefined,
  }
}

export function getDefaultScanPolicy(): ExtensionRemoteConfig['scanPolicy'] {
  return DEFAULT_SCAN_POLICY
}

export function clampScanIntervalSeconds(intervalSeconds: number, policy: ExtensionRemoteConfig['scanPolicy']): number {
  return Math.min(policy.maxIntervalSeconds, Math.max(policy.minIntervalSeconds, intervalSeconds))
}

export function resolveScanIntervalSeconds(intervalSeconds: number, policy: ExtensionRemoteConfig['scanPolicy']): number {
  const clamped = clampScanIntervalSeconds(intervalSeconds, policy)
  const allowed = policy.allowedIntervalSeconds
    .filter(seconds => seconds >= policy.minIntervalSeconds && seconds <= policy.maxIntervalSeconds)
    .sort((a, b) => a - b)
  if (!allowed.length) return clamped
  return allowed.find(seconds => seconds >= clamped) ?? allowed[allowed.length - 1]
}

export async function getCachedExtensionConfig(): Promise<ExtensionRemoteConfig | null> {
  const result = await storageGet([STORAGE_KEY])
  return normalizeExtensionConfig(result[STORAGE_KEY])
}

export async function refreshExtensionConfig(): Promise<ExtensionRemoteConfig | null> {
  const clientId = await getClientId()
  const config = await getExtensionRemoteConfig(clientId)
  const next = { ...config, fetchedAt: new Date().toISOString() }
  await storageSet({ [STORAGE_KEY]: next })
  return normalizeExtensionConfig(next)
}

export function compareVersions(left: string, right: string): number {
  const parse = (version: string) => version
    .split(/[.-]/)
    .map(part => {
      const number = Number(part)
      return Number.isFinite(number) ? number : part
    })

  const leftParts = parse(left)
  const rightParts = parse(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const l = leftParts[index] ?? 0
    const r = rightParts[index] ?? 0
    if (l === r) continue
    if (typeof l === 'number' && typeof r === 'number') return l > r ? 1 : -1
    return String(l).localeCompare(String(r))
  }
  return 0
}

export function getCurrentExtensionVersion(): string {
  return chrome.runtime.getManifest?.().version ?? '0.0.0'
}

export function isForceUpdateRequired(config: ExtensionRemoteConfig | null): boolean {
  if (!config) return false
  return compareVersions(getCurrentExtensionVersion(), config.minSupportedVersion) < 0
}

export function isOptionalUpdateAvailable(config: ExtensionRemoteConfig | null): boolean {
  if (!config || config.rolloutState !== 'available') return false
  return compareVersions(getCurrentExtensionVersion(), config.latestVersion) < 0
}

export function getExtensionUpdateUrl(config: ExtensionRemoteConfig | null): string {
  if (config?.downloadUrl) return config.downloadUrl
  return EXTENSION_DOWNLOAD_URL
}
