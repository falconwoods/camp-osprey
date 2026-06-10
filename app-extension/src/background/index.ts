import { BCParksApiError, BCParksCooldownError, BCParksProvider } from '../providers/bcparks'
import { getStorage, addDebugLog, formatDateTime } from '../storage'
import { isLoggedIn, watchLoginChanges } from './login'
import { scanTrip, buildBookingUrl } from './scanner'
import type { ScanBudget, TripScanCursor } from './scanner'
import type { AvailableSite, DebugLogEntry, ExtensionRemoteConfig, MatchedSite, ScanLease, Trip } from '../types'
import { validateAuth } from '../auth'
import { notifyUserResult, requestScanLease, sendBookingPaymentEvent } from '../serverApi'
import type { BookingPaymentEventPayload } from '../serverApi'
import { flushPendingServerLogs } from '../logSync'
import { getTrips, updateTrip } from '../tripStore'
import { IS_LOCAL_BUILD } from '../config'
import {
  getCachedExtensionConfig,
  getExtensionUpdateUrl,
  getDefaultScanPolicy,
  isForceUpdateRequired,
  refreshExtensionConfig,
  resolveScanIntervalSeconds,
} from '../extensionConfig'
import { LogEventCode, ProviderCode, ProviderSnapshotSourceCode, ResultCode, RuntimeMessageCode, opaqueHash } from '../protocol'

const ALARM_NAME = 'scan'
const LOG_SYNC_ALARM_NAME = 'log-sync'
const EXTENSION_CONFIG_ALARM_NAME = 'extension-config'
const PENDING_BOOKING_PAYMENT_EVENTS_KEY = 'pendingBookingPaymentEvents'
const SCAN_CURSORS_KEY = 'campsoonScanCursors'
const SCAN_TRIP_CURSOR_KEY = 'campsoonScanTripCursor'
const provider = new BCParksProvider()
let scanInProgress = false
let bookingPaymentFlushInProgress = false
let lastAvailabilityRequestAt = 0
let availabilityPacingQueue: Promise<void> = Promise.resolve()
let availabilityBackoffUntil = 0
let availabilityErrorCount = 0
let pendingScanAll = false
const pendingScanTripIds = new Set<string>()
const stoppedTripIds = new Set<string>()
const activeTripControllers = new Map<string, AbortController>()
const activeMatchKeys = new Set<string>()
const activeScanLeases = new Map<string, ScanLease>()
const authNotificationKeys = new Set<string>()
const AUTH_NOTIFICATION_SUPPRESSIONS_KEY = 'campOspreyAuthNotificationSuppressions'
type AuthNotificationKind = 'server' | 'bcparks'
let contentLogFlushTimer: ReturnType<typeof setTimeout> | null = null

type ConfirmedBookingPaymentPayload = BookingPaymentEventPayload & { idempotencyKey: string }
type ScanCursorMap = Record<string, TripScanCursor>

interface PendingBookingPaymentEvent {
  payload: ConfirmedBookingPaymentPayload
  tripName?: string
  queuedAt: string
  attempts: number
  lastAttemptAt?: string
  lastError?: string
}

function logEntry(
  entry: Omit<DebugLogEntry, 'ts'> & { ts?: string },
  options: { forceServerSync?: boolean } = {},
): Promise<void> {
  const result = options.forceServerSync ? addDebugLog(entry, options) : addDebugLog(entry)
  if (options.forceServerSync) void result.then(scheduleContentLogFlush)
  return result
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result as Record<string, unknown>)))
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set(values, () => resolve()))
}

function getScanPolicy(config: ExtensionRemoteConfig | null | undefined): ExtensionRemoteConfig['scanPolicy'] {
  return config?.scanPolicy ?? getDefaultScanPolicy()
}

function getEffectiveScanIntervalSeconds(settingsIntervalSeconds: number, config: ExtensionRemoteConfig | null | undefined): number {
  return resolveScanIntervalSeconds(settingsIntervalSeconds, getScanPolicy(config))
}

function isTripScanCursor(value: unknown): value is TripScanCursor {
  if (!value || typeof value !== 'object') return false
  const cursor = value as Partial<TripScanCursor>
  return Number.isInteger(cursor.parkIndex) && Number.isInteger(cursor.dateRangeIndex) && Number.isInteger(cursor.windowIndex)
    && cursor.parkIndex! >= 0 && cursor.dateRangeIndex! >= 0 && cursor.windowIndex! >= 0
}

async function getScanCursors(): Promise<ScanCursorMap> {
  const result = await storageGet([SCAN_CURSORS_KEY])
  const value = result[SCAN_CURSORS_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, TripScanCursor] => typeof entry[0] === 'string' && isTripScanCursor(entry[1]))
  )
}

async function saveScanCursor(tripId: string, cursor: TripScanCursor): Promise<void> {
  const cursors = await getScanCursors()
  cursors[tripId] = cursor
  await storageSet({ [SCAN_CURSORS_KEY]: cursors })
}

async function getScanTripCursor(): Promise<string | null> {
  const result = await storageGet([SCAN_TRIP_CURSOR_KEY])
  return typeof result[SCAN_TRIP_CURSOR_KEY] === 'string' ? result[SCAN_TRIP_CURSOR_KEY] : null
}

async function saveScanTripCursor(tripId: string | null): Promise<void> {
  await storageSet({ [SCAN_TRIP_CURSOR_KEY]: tripId })
}

function orderTripsForCycle(trips: Trip[], startTripId: string | null): Trip[] {
  if (!startTripId || trips.length === 0) return trips
  const startIndex = trips.findIndex(trip => trip.id === startTripId)
  if (startIndex <= 0) return trips
  return [...trips.slice(startIndex), ...trips.slice(0, startIndex)]
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForAvailabilitySlot(spacingMs: number, signal?: AbortSignal): Promise<void> {
  const run = availabilityPacingQueue.catch(() => undefined).then(async () => {
    const elapsed = Date.now() - lastAvailabilityRequestAt
    await wait(Math.max(0, spacingMs - elapsed), signal)
    lastAvailabilityRequestAt = Date.now()
  })
  availabilityPacingQueue = run.catch(() => undefined)
  return run
}

function getAvailabilityBackoffDelayMs(err: unknown, policy: ExtensionRemoteConfig['scanPolicy']): number {
  if (err instanceof BCParksCooldownError) return Math.max(0, err.cooldownUntil - Date.now())
  if (err instanceof BCParksApiError && (err.status === 429 || err.status === 400 || err.status >= 500)) {
    return policy.backoff.rateLimitBaseSeconds * 1000
  }
  return policy.backoff.errorBaseSeconds * 1000
}

function recordAvailabilityFailure(err: unknown, policy: ExtensionRemoteConfig['scanPolicy']): void {
  if (err instanceof DOMException && err.name === 'AbortError') return
  availabilityErrorCount += 1
  const baseDelayMs = getAvailabilityBackoffDelayMs(err, policy)
  const multiplier = Math.max(1, Math.min(4, availabilityErrorCount))
  const delayMs = Math.min(policy.backoff.maxSeconds * 1000, baseDelayMs * multiplier)
  availabilityBackoffUntil = Math.max(availabilityBackoffUntil, Date.now() + delayMs)
}

function clearAvailabilityFailure(): void {
  availabilityErrorCount = 0
}

function isScanLease(value: unknown): value is ScanLease {
  if (!value || typeof value !== 'object') return false
  const lease = value as Partial<ScanLease>
  return typeof lease.lease === 'string'
    && typeof lease.leaseId === 'string'
    && typeof lease.expiresAt === 'string'
    && typeof lease.tripHash === 'string'
}

function scanLeaseExpiresSoon(scanLease: ScanLease): boolean {
  const expiresAt = new Date(scanLease.expiresAt).getTime()
  return !Number.isFinite(expiresAt) || expiresAt - Date.now() < 90_000
}

async function getScanLeaseForTrip(trip: Trip): Promise<ScanLease> {
  const cached = activeScanLeases.get(trip.id)
  if (cached && !scanLeaseExpiresSoon(cached)) return cached

  const scanLease = await requestScanLease(trip.id)
  activeScanLeases.set(trip.id, scanLease)
  await logEntry({
    level: 'debug',
    eventCode: LogEventCode.scanLeaseAcquired,
    message: 'Scan lease acquired',
    tripId: trip.id,
    tripName: trip.name,
    metadata: { leaseId: scanLease.leaseId, expiresAt: scanLease.expiresAt },
  })
  return scanLease
}

function isConfirmedBookingPaymentPayload(value: unknown): value is ConfirmedBookingPaymentPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<ConfirmedBookingPaymentPayload>
  return payload.providerCode === ProviderCode.bcParks
    && typeof payload.idempotencyKey === 'string'
    && !!payload.idempotencyKey
    && typeof payload.parkName === 'string'
    && typeof payload.siteName === 'string'
    && typeof payload.checkIn === 'string'
    && typeof payload.checkOut === 'string'
}

function isPendingBookingPaymentEvent(value: unknown): value is PendingBookingPaymentEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<PendingBookingPaymentEvent>
  return isConfirmedBookingPaymentPayload(event.payload)
    && typeof event.queuedAt === 'string'
    && typeof event.attempts === 'number'
}

async function getPendingBookingPaymentEvents(): Promise<Record<string, PendingBookingPaymentEvent>> {
  const result = await storageGet([PENDING_BOOKING_PAYMENT_EVENTS_KEY])
  const value = result[PENDING_BOOKING_PAYMENT_EVENTS_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, PendingBookingPaymentEvent] =>
        typeof entry[0] === 'string' && isPendingBookingPaymentEvent(entry[1])
      )
  )
}

async function savePendingBookingPaymentEvents(events: Record<string, PendingBookingPaymentEvent>): Promise<void> {
  await storageSet({ [PENDING_BOOKING_PAYMENT_EVENTS_KEY]: events })
}

async function enqueueBookingPaymentEvent(payload: ConfirmedBookingPaymentPayload, tripName?: string): Promise<void> {
  const pending = await getPendingBookingPaymentEvents()
  const existing = pending[payload.idempotencyKey]
  pending[payload.idempotencyKey] = {
    ...existing,
    payload,
    tripName: tripName ?? existing?.tripName,
    queuedAt: existing?.queuedAt ?? new Date().toISOString(),
    attempts: existing?.attempts ?? 0,
  }
  await savePendingBookingPaymentEvents(pending)
}

async function removePendingBookingPaymentEvent(idempotencyKey: string): Promise<void> {
  const pending = await getPendingBookingPaymentEvents()
  if (!pending[idempotencyKey]) return
  delete pending[idempotencyKey]
  await savePendingBookingPaymentEvents(pending)
}

async function bookingPaymentIdempotencyKey(
  trip: Trip,
  match: MatchedSite,
  confirmationNumber: string | undefined,
  paidAt: string,
): Promise<string> {
  const normalizedConfirmation = confirmationNumber?.trim()
  return opaqueHash([
    2407,
    trip.id,
    match.resourceId,
    match.checkIn,
    match.checkOut,
    normalizedConfirmation && normalizedConfirmation !== 'unknown' ? normalizedConfirmation : '',
    paidAt,
  ])
}

async function buildBookingPaymentEvent(
  trip: Trip,
  match: MatchedSite,
  confirmationNumber: string | undefined,
  paidAt: string,
  scanLease: string | undefined,
  bookingUrl?: string,
): Promise<ConfirmedBookingPaymentPayload> {
  const normalizedConfirmation = confirmationNumber?.trim() || undefined
  return {
    tripId: trip.id,
    clientEventId: crypto.randomUUID(),
    idempotencyKey: await bookingPaymentIdempotencyKey(trip, match, normalizedConfirmation, paidAt),
    scanLease,
    providerCode: ProviderCode.bcParks,
    confirmationNumber: normalizedConfirmation,
    parkName: match.parkName,
    sectionName: match.sectionName,
    siteName: match.siteName,
    resourceId: match.resourceId,
    checkIn: match.checkIn,
    checkOut: match.checkOut,
    paidAt,
    bookingUrl: bookingUrl ?? match.bookingUrl,
    rawProviderSnapshot: {
      sourceCode: ProviderSnapshotSourceCode.confirmationDom,
      confirmationRouteObserved: true,
      confirmationNumber: normalizedConfirmation,
    },
  }
}

async function flushPendingBookingPaymentEvents(): Promise<void> {
  if (bookingPaymentFlushInProgress) return
  bookingPaymentFlushInProgress = true
  try {
    const pending = await getPendingBookingPaymentEvents()
    for (const [idempotencyKey, event] of Object.entries(pending)) {
      const lastAttemptAt = new Date().toISOString()
      try {
        const result = await sendBookingPaymentEvent(event.payload)
        await removePendingBookingPaymentEvent(idempotencyKey)
        await logEntry({
          level: result.chargeStatus === 'failed_insufficient_points' ? 'warning' : 'info',
          eventCode: LogEventCode.bookingPaymentEventReported,
          message: result.duplicate
            ? 'Booking payment event already reported'
            : 'Booking payment event reported',
          tripId: event.payload.tripId,
          tripName: event.tripName,
          parkName: event.payload.parkName,
          siteName: event.payload.siteName,
          checkIn: event.payload.checkIn,
          checkOut: event.payload.checkOut,
          paidAt: event.payload.paidAt,
          status: 'paid',
          metadata: {
            confirmationNumber: event.payload.confirmationNumber,
            bookingPaymentEventId: result.bookingPaymentEventId,
            chargeStatus: result.chargeStatus,
            pointTransactionId: result.pointTransactionId,
            balanceAfter: result.balanceAfter,
            duplicate: result.duplicate,
            idempotencyKey,
          },
        }, { forceServerSync: true })
      } catch (err) {
        const latest = await getPendingBookingPaymentEvents()
        if (!latest[idempotencyKey]) continue
        latest[idempotencyKey] = {
          ...latest[idempotencyKey],
          attempts: latest[idempotencyKey].attempts + 1,
          lastAttemptAt,
          lastError: err instanceof Error ? err.message : String(err),
        }
        await savePendingBookingPaymentEvents(latest)
        await logEntry({
          level: 'error',
          eventCode: LogEventCode.bookingPaymentEventReportFailed,
          message: 'Booking payment event reporting failed; will retry',
          tripId: event.payload.tripId,
          tripName: event.tripName,
          parkName: event.payload.parkName,
          siteName: event.payload.siteName,
          checkIn: event.payload.checkIn,
          checkOut: event.payload.checkOut,
          paidAt: event.payload.paidAt,
          status: 'paid',
          error: err instanceof Error ? err.message : String(err),
          metadata: { idempotencyKey, attempts: latest[idempotencyKey].attempts },
        }, { forceServerSync: true })
      }
    }
  } finally {
    bookingPaymentFlushInProgress = false
  }
}

function scheduleContentLogFlush(): void {
  if (contentLogFlushTimer) return
  contentLogFlushTimer = setTimeout(() => {
    contentLogFlushTimer = null
    void flushPendingServerLogs()
  }, 3000)
}

function authNotificationKey(kind: AuthNotificationKind, tripId: string): string {
  return `${kind}:${tripId}`
}

function getAuthNotificationSuppressions(): Promise<Record<string, true>> {
  return new Promise(resolve => {
    chrome.storage.local.get([AUTH_NOTIFICATION_SUPPRESSIONS_KEY], result => {
      const value = (result as Record<string, unknown>)[AUTH_NOTIFICATION_SUPPRESSIONS_KEY]
      resolve(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, true> : {})
    })
  })
}

function saveAuthNotificationSuppressions(suppressions: Record<string, true>): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [AUTH_NOTIFICATION_SUPPRESSIONS_KEY]: suppressions }, () => resolve())
  })
}

async function shouldNotifyAuthIssue(kind: AuthNotificationKind, tripId: string): Promise<boolean> {
  const key = authNotificationKey(kind, tripId)
  if (authNotificationKeys.has(key)) return false
  const suppressions = await getAuthNotificationSuppressions()
  if (suppressions[key]) {
    authNotificationKeys.add(key)
    return false
  }
  suppressions[key] = true
  authNotificationKeys.add(key)
  await saveAuthNotificationSuppressions(suppressions)
  return true
}

async function clearAuthIssue(kind: AuthNotificationKind, tripId: string): Promise<void> {
  const key = `${kind}:${tripId}`
  authNotificationKeys.delete(key)
  const suppressions = await getAuthNotificationSuppressions()
  if (suppressions[key]) {
    delete suppressions[key]
    await saveAuthNotificationSuppressions(suppressions)
  }
}

// Log full raw daily API response for every site that passes availability check
provider.onAvailabilityRaw = (siteId, siteName, daily) => {
  void logEntry({
    level: 'debug',
    eventCode: LogEventCode.availabilityRaw,
    message: 'Raw availability response',
    siteName,
    metadata: { siteId, daily },
  })
}

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm(getDefaultScanPolicy().defaultIntervalSeconds)
  setupLogSyncAlarm()
  setupExtensionConfigAlarm(10 * 60)
  void refreshAndScheduleExtensionConfig()
})

// Restore alarm on service worker restart
chrome.storage.local.get(['settings', 'extensionConfig'], result => {
  const data = result as Record<string, { pollIntervalSeconds?: number } | ExtensionRemoteConfig | null>
  const settings = data['settings'] as { pollIntervalSeconds?: number } | undefined
  const config = data['extensionConfig'] as ExtensionRemoteConfig | null | undefined
  const interval = getEffectiveScanIntervalSeconds(
    settings?.pollIntervalSeconds ?? getScanPolicy(config).defaultIntervalSeconds,
    config,
  )
  setupAlarm(interval)
  setupLogSyncAlarm()
  setupExtensionConfigAlarm(10 * 60)
  void flushPendingBookingPaymentEvents()
  void refreshAndScheduleExtensionConfig()
})

chrome.storage.onChanged.addListener(changes => {
  if (!changes.settings && !changes.extensionConfig) return
  void (async () => {
    const { settings, extensionConfig } = await getStorage()
    await setupAlarm(getEffectiveScanIntervalSeconds(settings.pollIntervalSeconds, extensionConfig))
  })()
})

async function setupAlarm(intervalSeconds: number): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(ALARM_NAME, () => resolve()))
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalSeconds / 60 })
}

async function setupLogSyncAlarm(): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(LOG_SYNC_ALARM_NAME, () => resolve()))
  chrome.alarms.create(LOG_SYNC_ALARM_NAME, { periodInMinutes: 1 })
}

async function setupExtensionConfigAlarm(intervalSeconds: number): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(EXTENSION_CONFIG_ALARM_NAME, () => resolve()))
  chrome.alarms.create(EXTENSION_CONFIG_ALARM_NAME, { periodInMinutes: Math.max(1, intervalSeconds / 60) })
}

async function refreshAndScheduleExtensionConfig(): Promise<void> {
  try {
    const config = await refreshExtensionConfig()
    if (config) await setupExtensionConfigAlarm(config.pollIntervalSeconds)
  } catch (err) {
    await logEntry({
      level: 'warning',
      eventCode: LogEventCode.extensionConfigRefreshFailed,
      message: 'Extension config refresh failed',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

chrome.alarms.onAlarm.addListener(async (alarm: chrome.alarms.Alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runScanCycle()
  } else if (alarm.name === LOG_SYNC_ALARM_NAME) {
    await flushPendingBookingPaymentEvents()
    await flushPendingServerLogs()
  } else if (alarm.name === EXTENSION_CONFIG_ALARM_NAME) {
    await refreshAndScheduleExtensionConfig()
  }
})

watchLoginChanges(async loggedIn => {
  if (!loggedIn) return
  await flushPendingBookingPaymentEvents()
  // Trigger a scan immediately on login
  await runScanCycle()
})

async function runScanCycle(targetTripIds?: string | string[]): Promise<void> {
  if (scanInProgress) {
    if (targetTripIds) {
      for (const id of Array.isArray(targetTripIds) ? targetTripIds : [targetTripIds]) {
        pendingScanTripIds.add(id)
      }
    } else {
      pendingScanAll = true
    }
    const { settings } = await getStorage()
    if (IS_LOCAL_BUILD) await logEntry({
      level: 'debug',
      eventCode: LogEventCode.scanSkipped,
      message: 'Previous scan still running',
    })
    return
  }

  scanInProgress = true
  try {
    let extensionConfig = await getCachedExtensionConfig()
    if (!extensionConfig) extensionConfig = await refreshExtensionConfig().catch(() => null)
    if (isForceUpdateRequired(extensionConfig)) {
      await logEntry({
        level: 'warning',
        eventCode: LogEventCode.extensionUpdateRequired,
        message: 'Scan skipped because this extension version is no longer supported',
        metadata: {
          minSupportedVersion: extensionConfig?.minSupportedVersion,
          latestVersion: extensionConfig?.latestVersion,
          channel: extensionConfig?.channel,
        },
      }, { forceServerSync: true })
      await notify(
        'campsoon update required',
        extensionConfig?.forceUpdateMessage ?? 'Update campsoon to continue scanning.',
      )
      if (extensionConfig?.downloadUrl) {
        chrome.tabs.create({ url: getExtensionUpdateUrl(extensionConfig) })
      }
      return
    }

    const { settings } = await getStorage()
    const trips = await getTrips()
    const scanPolicy = getScanPolicy(extensionConfig)
    provider.beforeAvailabilityMapRequest = signal => waitForAvailabilitySlot(scanPolicy.requestSpacingMs, signal)
    const effectiveIntervalSeconds = getEffectiveScanIntervalSeconds(settings.pollIntervalSeconds, extensionConfig)
    await setupAlarm(effectiveIntervalSeconds)
    const targetSet = targetTripIds
      ? new Set(Array.isArray(targetTripIds) ? targetTripIds : [targetTripIds])
      : null

    const scanTripCursor = targetSet ? null : await getScanTripCursor()
    const scanningTrips = orderTripsForCycle(trips.filter(t =>
      t.status === 'scanning' && (!targetSet || targetSet.has(t.id))
    ), scanTripCursor)
    const debug = IS_LOCAL_BUILD
    const cursors = await getScanCursors()
    const cycleBudget = { remainingCycleRequests: scanPolicy.maxRequestsPerCycle }
    let completedTripCycle = true

    await logEntry({
      level: 'debug',
      eventCode: LogEventCode.scanCycleStarted,
      message: 'Alarm fired',
      metadata: {
        scanningTripCount: scanningTrips.length,
        effectiveIntervalSeconds,
        requestSpacingMs: scanPolicy.requestSpacingMs,
        maxRequestsPerCycle: scanPolicy.maxRequestsPerCycle,
        maxRequestsPerTripPerCycle: scanPolicy.maxRequestsPerTripPerCycle,
      },
    })

    for (let tripIndex = 0; tripIndex < scanningTrips.length; tripIndex += 1) {
      const trip = scanningTrips[tripIndex]
      if (Date.now() < availabilityBackoffUntil) {
        completedTripCycle = false
        if (!targetSet) await saveScanTripCursor(trip.id)
        await logEntry({
          level: 'warning',
          message: 'BC Parks availability backoff active; continuing next cycle',
          metadata: { backoffUntil: new Date(availabilityBackoffUntil).toISOString() },
        })
        break
      }
      if (cycleBudget.remainingCycleRequests <= 0) {
        completedTripCycle = false
        if (!targetSet) await saveScanTripCursor(trip.id)
        await logEntry({
          level: 'info',
          message: 'Scan budget exhausted; continuing next cycle',
          metadata: { remainingTrips: scanningTrips.length - tripIndex },
        })
        break
      }

      const serverLoggedIn = await validateAuth()
      if (!serverLoggedIn) {
        await logEntry({
          level: 'debug',
          eventCode: LogEventCode.serverAuthMissing,
          message: 'Not signed in to server; skipping scan',
          tripId: trip.id,
          tripName: trip.name,
        })
        if (await shouldNotifyAuthIssue('server', trip.id)) {
          await notify(
            'Sign In Required',
            `Sign in to start "${trip.name}" and keep booking emails connected to your account.`
          )
        }
        continue
      }
      await clearAuthIssue('server', trip.id)
      let scanLease: ScanLease
      try {
        scanLease = await getScanLeaseForTrip(trip)
      } catch (err) {
        await logEntry({
          level: 'error',
          eventCode: LogEventCode.scanLeaseFailed,
          message: 'Could not acquire scan lease; skipping trip',
          tripId: trip.id,
          tripName: trip.name,
          error: err instanceof Error ? err.message : String(err),
        }, { forceServerSync: true })
        continue
      }

      const loggedIn = await isLoggedIn()
      const needsLogin = trip.mode !== 'alert' && !loggedIn
      if (needsLogin) {
        await logEntry({
          level: 'warning',
          eventCode: LogEventCode.bcparksLoginMissing,
          message: 'Not logged in to BC Parks; skipping reserve or auto-pay',
          tripId: trip.id,
          tripName: trip.name,
          metadata: { mode: trip.mode },
        })
        if (await shouldNotifyAuthIssue('bcparks', trip.id)) {
          await notify(
            'campsoon — Login Required',
            `Log in to BC Parks to use ${trip.mode} mode for "${trip.name}"`
          )
        }
        continue
      }
      await clearAuthIssue('bcparks', trip.id)

      if (debug) {
        const parkNames = trip.parks.map(p => p.name).join(', ')
        await logEntry({
          level: 'debug',
          eventCode: LogEventCode.tripScanStarted,
          message: 'Scanning trip',
          tripId: trip.id,
          tripName: trip.name,
          metadata: {
            parkCount: trip.parks.length,
            parkNames,
            dateRangeCount: trip.dateRanges.length,
          },
        })
      }

      try {
        const controller = new AbortController()
        activeTripControllers.set(trip.id, controller)
        const tripBudget: ScanBudget = {
          remainingCycleRequests: cycleBudget.remainingCycleRequests,
          remainingTripRequests: scanPolicy.maxRequestsPerTripPerCycle,
        }
        const scanResult = await scanTrip(trip, async (id, ci, co, filters) => {
          const parkName = trip.parks.find(p => p.id === id)?.name ?? id
          if (debug) await logEntry({
            level: 'debug',
            eventCode: LogEventCode.parkChecked,
            message: 'Checking park date window',
            tripId: trip.id,
            tripName: trip.name,
            parkName,
            checkIn: ci,
            checkOut: co,
          })
          const results = await provider.getAvailability(id, ci, co, filters, controller.signal)
          clearAvailabilityFailure()
          if (results.length > 0) {
            await logEntry({
              level: 'info',
              eventCode: LogEventCode.availabilityResult,
              message: `${results.length} available site(s)`,
              tripId: trip.id,
              tripName: trip.name,
              parkName,
              checkIn: ci,
              checkOut: co,
              metadata: {
                availableCount: results.length,
                sites: results.map(s => ({
                  sectionName: s.sectionName || 'no section',
                  siteName: s.siteName,
                  resourceId: s.resourceId,
                  isWalkin: s.isWalkin,
                  isDouble: s.isDouble,
                })),
              },
            })
          } else if (debug) {
            await logEntry({
              level: 'debug',
              eventCode: LogEventCode.availabilityResult,
              message: '0 available site(s)',
              tripId: trip.id,
              tripName: trip.name,
              parkName,
              checkIn: ci,
              checkOut: co,
              metadata: { availableCount: 0, sites: [] },
            })
          }
          return results
        }, () => !stoppedTripIds.has(trip.id) && !controller.signal.aborted, {
          cursor: cursors[trip.id],
          budget: tripBudget,
        })
        cycleBudget.remainingCycleRequests = tripBudget.remainingCycleRequests
        await saveScanCursor(trip.id, scanResult.cursor)

        if (scanResult.site) {
          await handleMatch(trip, scanResult.site, scanLease.lease)
        } else if (stoppedTripIds.has(trip.id) || controller.signal.aborted) {
          if (debug) await logEntry({
            level: 'debug',
            eventCode: LogEventCode.tripScanStopped,
            message: 'Trip scan stopped',
            tripId: trip.id,
            tripName: trip.name,
          })
        } else if (scanResult.budgetExhausted) {
          await logEntry({
            level: 'info',
            message: 'Trip scan budget exhausted; continuing next cycle',
            tripId: trip.id,
            tripName: trip.name,
            metadata: {
              requestsMade: scanResult.requestsMade,
              remainingCycleRequests: cycleBudget.remainingCycleRequests,
            },
          })
        } else {
          if (debug) await logEntry({
            level: 'debug',
            eventCode: LogEventCode.tripScanEmpty,
            message: 'No availability this cycle',
            tripId: trip.id,
            tripName: trip.name,
          })
        }
        if (cycleBudget.remainingCycleRequests <= 0) {
          completedTripCycle = false
          if (!targetSet) {
            const nextTripId = scanResult.budgetExhausted
              ? trip.id
              : (scanningTrips[tripIndex + 1]?.id ?? null)
            await saveScanTripCursor(nextTripId)
          }
          break
        }
      } catch (err) {
        if (stoppedTripIds.has(trip.id)) {
          if (debug) await logEntry({
            level: 'debug',
            eventCode: LogEventCode.tripScanStopped,
            message: 'Trip scan stopped',
            tripId: trip.id,
            tripName: trip.name,
          })
        } else {
          recordAvailabilityFailure(err, scanPolicy)
          await logEntry({
            level: 'error',
            eventCode: LogEventCode.tripScanError,
            message: 'Error scanning trip',
            tripId: trip.id,
            tripName: trip.name,
            error: err instanceof Error ? err.message : String(err),
          })
          console.error(`Scan error for trip ${trip.id}:`, err)
          if (Date.now() < availabilityBackoffUntil) {
            completedTripCycle = false
            if (!targetSet) await saveScanTripCursor(trip.id)
            await logEntry({
              level: 'warning',
              message: 'BC Parks availability backoff scheduled',
              tripId: trip.id,
              tripName: trip.name,
              metadata: { backoffUntil: new Date(availabilityBackoffUntil).toISOString() },
            })
            break
          }
        }
      } finally {
        activeTripControllers.delete(trip.id)
      }
    }
    if (completedTripCycle && !targetSet) await saveScanTripCursor(null)
  } finally {
    await flushPendingServerLogs()
    scanInProgress = false
    const queuedAll = pendingScanAll
    const queuedTripIds = [...pendingScanTripIds]
    pendingScanAll = false
    pendingScanTripIds.clear()
    if (queuedAll || queuedTripIds.length > 0) {
      await runScanCycle(queuedAll ? undefined : queuedTripIds)
    }
  }
}

function activeMatchKey(tripId: string, site: AvailableSite | MatchedSite): string {
  return `${tripId}|${site.resourceId}|${site.checkIn}|${site.checkOut}`
}

function clearActiveMatchesForTrip(tripId: string): void {
  for (const key of [...activeMatchKeys]) {
    if (key.startsWith(`${tripId}|`)) activeMatchKeys.delete(key)
  }
}

function clearFailedActiveMatch(tripId: string, attemptKey?: string | null): void {
  if (attemptKey) {
    activeMatchKeys.delete(`${tripId}|${attemptKey}`)
    return
  }
  clearActiveMatchesForTrip(tripId)
}

function isSameMatch(match: MatchedSite | null, site: AvailableSite): boolean {
  return !!match &&
    match.resourceId === site.resourceId &&
    match.checkIn === site.checkIn &&
    match.checkOut === site.checkOut
}

async function reportFoundResult(
  trip: Trip,
  matchedSite: MatchedSite,
  scanLease: string,
): Promise<void> {
  try {
    await logEntry({
      level: 'info',
      eventCode: LogEventCode.serverResultReported,
      message: 'Reporting found site result to server',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      checkIn: matchedSite.checkIn,
      checkOut: matchedSite.checkOut,
      status: 'found',
    })
    await notifyUserResult(trip.id, {
      resultCode: ResultCode.found,
      matchedSite,
      scanLease,
      tripSnapshot: {
        name: trip.name,
        parks: trip.parks,
        dateRanges: trip.dateRanges,
        filters: trip.filters,
        mode: trip.mode,
        status: trip.status,
        attempted: trip.attempted,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
        deletedAt: trip.deletedAt,
      },
    })
  } catch (err) {
    await logEntry({
      level: 'error',
      eventCode: LogEventCode.serverResultFailed,
      message: 'Site found result reporting failed',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleMatch(
  trip: Trip,
  site: AvailableSite,
  scanLease: string,
): Promise<void> {
  const key = activeMatchKey(trip.id, site)
  if (activeMatchKeys.has(key) || isSameMatch(trip.lastMatch, site)) {
    await logEntry({
      level: 'warning',
      eventCode: LogEventCode.activeMatchSuppressed,
      message: 'Already handling active match; suppressing duplicate tab and notification',
      tripId: trip.id,
      tripName: trip.name,
      parkName: site.campgroundName || site.campgroundId,
      siteName: site.siteName,
      checkIn: site.checkIn,
      checkOut: site.checkOut,
      metadata: { resourceId: site.resourceId },
    })
    return
  }

  activeMatchKeys.add(key)
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const nightStr = `${nights} night${nights !== 1 ? 's' : ''}`
  const bookingUrl = buildBookingUrl(site)
  const availableCount = site.availableCount ?? 1
  const availableLabel = `${availableCount} available site${availableCount === 1 ? '' : 's'}`
  const foundAt = new Date().toISOString()
  const foundAtLabel = formatDateTime(foundAt)

  const matchedSite: MatchedSite = {
    parkName: site.campgroundName || site.campgroundId,
    siteName: site.siteName,
    sectionName: site.sectionName,
    checkIn: site.checkIn,
    checkOut: site.checkOut,
    bookingUrl,
    resourceId: site.resourceId,
    availableCount,
    foundAt,
  }

  await logEntry({
    level: 'info',
    eventCode: LogEventCode.siteFound,
    message: 'Found reservable site',
    tripId: trip.id,
    tripName: trip.name,
    parkName: matchedSite.parkName,
    siteName: matchedSite.siteName,
    checkIn: site.checkIn,
    checkOut: site.checkOut,
    foundAt,
    bookingDate: foundAt,
    status: 'found',
    metadata: { availableCount },
  })

  await reportFoundResult(trip, matchedSite, scanLease)

  if (trip.mode === 'alert') {
    await notify(
      `Campsite Available — ${matchedSite.parkName}`,
      `${availableLabel}\n${site.checkIn} → ${site.checkOut} (${nightStr})\nFound: ${foundAtLabel}`,
      bookingUrl,
      true,
    )
    await updateTrip(trip.id, { lastMatch: matchedSite })
    return
  }

  // For reserve and autopay: open BC Parks booking tab so the reservation
  // happens inside the user's real browser session (not the extension's
  // isolated service-worker session, which has a separate cart).
  // Use chrome.storage.local (not session) — content scripts can only access local storage
  await new Promise<void>(resolve =>
    chrome.storage.local.set({
      campOspreyTarget: {
        resourceId: site.resourceId,
        siteName: site.siteName,
        sectionName: site.sectionName,
        parkName: site.campgroundName || site.campgroundId,
        tripId: trip.id,
        mode: trip.mode,
        noDouble: trip.filters.noDouble,
        noWalkin: trip.filters.noWalkin,
        checkIn: site.checkIn,
        checkOut: site.checkOut,
        availableCount,
        foundAt,
        scanLease,
        setAt: Date.now(),
      },
    }, resolve)
  )

  if (trip.mode === 'reserve') {
    await updateTrip(trip.id, { status: 'reserving', lastMatch: matchedSite })
    await notify(
      `Site Available — Reserve Now`,
      `${matchedSite.parkName} › ${availableLabel}\n${site.checkIn} → ${site.checkOut}\nFound: ${foundAtLabel}\nBC Parks is opening — click Reserve in your browser.`,
      bookingUrl,
      true,
    )
    chrome.tabs.create({ url: bookingUrl })
    await logEntry({
      level: 'info',
      eventCode: LogEventCode.reservationTabOpened,
      message: 'Reservation tab opened',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      checkIn: site.checkIn,
      checkOut: site.checkOut,
      status: 'found',
    })
    return
  }

  if (trip.mode === 'autopay') {
    await updateTrip(trip.id, { status: 'reserving', lastMatch: matchedSite })
    await notify(
      `Site Available — Auto-paying`,
      `${matchedSite.parkName} › ${availableLabel}\n${site.checkIn} → ${site.checkOut}\nFound: ${foundAtLabel}`,
      bookingUrl,
      true,
    )
    chrome.tabs.create({ url: bookingUrl })
    await logEntry({
      level: 'info',
      eventCode: LogEventCode.reservationTabOpened,
      message: 'Reservation tab opened for auto-pay',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      checkIn: site.checkIn,
      checkOut: site.checkOut,
      status: 'found',
    })
  }
}

async function notify(title: string, message: string, url?: string, persist = false): Promise<void> {
  const id = `campsoon-${Date.now()}`
  await new Promise<void>(resolve => {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title,
      message,
      requireInteraction: persist,  // true = stays until dismissed (match found, reserve)
    }, createdId => {
      if (chrome.runtime.lastError) {
        console.error('[campsoon] Notification failed:', chrome.runtime.lastError.message)
        void logEntry({
          level: 'error',
          eventCode: LogEventCode.notificationError,
          message: 'Notification failed',
          error: chrome.runtime.lastError.message,
        })
      } else {
        console.log('[campsoon] Notification sent:', createdId)
      }
      resolve()
    })
  })
  if (url) {
    chrome.notifications.onClicked.addListener(function handler(notifId: string) {
      if (notifId === id) {
        chrome.tabs.create({ url })
        chrome.notifications.onClicked.removeListener(handler)
      }
    })
  }
}

chrome.runtime.onMessage.addListener((msg: {
  t?: number
  level?: DebugLogEntry['level']
  eventCode?: number
  event?: string
  message?: string
  tripId?: string
  parkName?: string
  siteName?: string
  checkIn?: string
  checkOut?: string
  metadata?: Record<string, unknown>
  confirmationNumber?: string
  bookingUrl?: string
  paidAt?: string
  error?: string
  attemptKey?: string
  resetActiveMatch?: boolean
  scanLease?: unknown
}) => {
  if (msg.t === RuntimeMessageCode.contentDebugLog) {
    void addDebugLog({
      level: msg.level ?? 'info',
      eventCode: msg.eventCode ?? LogEventCode.contentScriptLog,
      message: msg.message ?? 'Content script log',
      tripId: msg.tripId,
      parkName: msg.parkName,
      siteName: msg.siteName,
      checkIn: msg.checkIn,
      checkOut: msg.checkOut,
      metadata: msg.metadata,
    }, { forceServerSync: true }).then(scheduleContentLogFlush)
    return
  }
  if (msg.t === RuntimeMessageCode.scanNow) {
    if (msg.tripId && isScanLease(msg.scanLease)) activeScanLeases.set(msg.tripId, msg.scanLease)
    if (msg.tripId) stoppedTripIds.delete(msg.tripId)
    if (msg.tripId && msg.resetActiveMatch) clearActiveMatchesForTrip(msg.tripId)
    chrome.storage.local.remove('campOspreyTarget')
    runScanCycle(msg.tripId)
    return
  }
  if (msg.t === RuntimeMessageCode.stopScan && msg.tripId) {
    stoppedTripIds.add(msg.tripId)
    activeTripControllers.get(msg.tripId)?.abort()
    return
  }
  if (msg.t === RuntimeMessageCode.matchFailed && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    clearFailedActiveMatch(msg.tripId, msg.attemptKey)
    getTrips().then(trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      if (!trip) return
      const attempted = [...trip.attempted]
      // attemptKey is null when the failure was a timing issue — don't mark as attempted.
      if (msg.attemptKey && !attempted.includes(msg.attemptKey)) {
        attempted.push(msg.attemptKey)
      }
      void logEntry({
        level: 'warning',
        eventCode: LogEventCode.matchFailed,
        message: msg.attemptKey ? 'Match failed; marked attempted' : 'Match failed; retrying next scan',
        tripId: trip.id,
        tripName: trip.name,
        metadata: { attemptKey: msg.attemptKey ?? null },
      })
      void updateTrip(msg.tripId!, { status: 'scanning', lastMatch: null, attempted })
    })
    return
  }
  if (msg.t === RuntimeMessageCode.bookingReserved && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getTrips().then(trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      const reservedAt = new Date().toISOString()
      const match = trip?.lastMatch ? { ...trip.lastMatch, reservedAt } : undefined
      const reservedAtLabel = formatDateTime(reservedAt)
      void logEntry({
        level: 'info',
        eventCode: LogEventCode.bookingReserved,
        message: 'Site reserved',
        tripId: msg.tripId,
        tripName: trip?.name,
        parkName: match?.parkName,
        siteName: match?.siteName,
        checkIn: match?.checkIn,
        checkOut: match?.checkOut,
        reservedAt,
        bookingDate: reservedAt,
        status: 'reserved',
      })
      updateTrip(msg.tripId!, match ? { status: 'reserved', lastMatch: match } : { status: 'reserved' })
        .then(async () => {
          if (match) {
            const siteDetail = `${match.parkName} › ${match.sectionName ? `${match.sectionName} › ` : ''}Site ${match.siteName}`
            await notify(
              'Site Reserved',
              `${siteDetail}\n${match.checkIn} → ${match.checkOut}\nReserved: ${reservedAtLabel}\nComplete payment on BC Parks now.`,
              match.bookingUrl,
              true,
            )
          }
          if (!trip || !match) return
          try {
            await logEntry({
              level: 'info',
              eventCode: LogEventCode.serverResultReported,
              message: 'Reporting reservation result to server',
              tripId: msg.tripId!,
              tripName: trip.name,
              parkName: match.parkName,
              siteName: match.siteName,
              checkIn: match.checkIn,
              checkOut: match.checkOut,
              status: 'reserved',
            })
            const result = await notifyUserResult(msg.tripId!, {
              resultCode: ResultCode.reserved,
              matchedSite: match,
              scanLease: typeof msg.scanLease === 'string' ? msg.scanLease : undefined,
              tripSnapshot: {
                name: trip.name,
                parks: trip.parks,
                dateRanges: trip.dateRanges,
                filters: trip.filters,
                mode: trip.mode,
                status: 'reserved',
                attempted: trip.attempted,
                createdAt: trip.createdAt,
                updatedAt: trip.updatedAt,
                deletedAt: trip.deletedAt,
              },
            })
            await logEntry({
              level: result.emailSent ? 'info' : 'warning',
              eventCode: result.emailSent ? LogEventCode.serverEmailSent : LogEventCode.serverEmailNotSent,
              message: result.emailSent ? 'Reservation email sent' : 'Reservation email not sent',
              tripId: msg.tripId!,
              tripName: trip.name,
              parkName: match.parkName,
              siteName: match.siteName,
            })
          } catch (err) {
            await logEntry({
              level: 'error',
              eventCode: LogEventCode.serverEmailFailed,
              message: 'Reservation email failed',
              tripId: msg.tripId!,
              tripName: trip?.name,
              parkName: match.parkName,
              siteName: match.siteName,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })
    })
    return
  }
  if (msg.t === RuntimeMessageCode.bookingConfirmed && msg.tripId) {
    getTrips().then(async trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      const m = trip?.lastMatch
      const paidAt = msg.paidAt && !Number.isNaN(new Date(msg.paidAt).getTime())
        ? msg.paidAt
        : new Date().toISOString()
      const detail = m
        ? `${m.parkName} › ${m.sectionName} › Site ${m.siteName}\n${m.checkIn} → ${m.checkOut}`
        : ''
      const match = m ? { ...m, paidAt } : undefined
      const paymentEvent = trip && match
        ? await buildBookingPaymentEvent(
          trip,
          match,
          msg.confirmationNumber,
          paidAt,
          typeof msg.scanLease === 'string' ? msg.scanLease : undefined,
          msg.bookingUrl,
        )
        : null
      void logEntry({
        level: 'info',
        eventCode: LogEventCode.bookingPaid,
        message: 'Booking paid',
        tripId: msg.tripId,
        tripName: trip?.name,
        parkName: m?.parkName,
        siteName: m?.siteName,
        checkIn: m?.checkIn,
        checkOut: m?.checkOut,
        paidAt,
        bookingDate: paidAt,
        status: 'paid',
        metadata: { confirmationNumber: msg.confirmationNumber ?? 'unknown' },
      }, { forceServerSync: true })
      updateTrip(msg.tripId!, match ? { status: 'paid', lastMatch: match } : { status: 'paid' }).then(async () => {
        if (paymentEvent) {
          await enqueueBookingPaymentEvent(paymentEvent, trip?.name)
        } else {
          await logEntry({
            level: 'error',
            eventCode: LogEventCode.bookingPaymentEventMissingMetadata,
            message: 'Booking was paid, but matched site metadata was missing; cannot report point charge event',
            tripId: msg.tripId!,
            tripName: trip?.name,
            metadata: { confirmationNumber: msg.confirmationNumber ?? 'unknown' },
          }, { forceServerSync: true })
        }
        notify(
          'Booking Paid',
          `${detail}${detail ? '\n' : ''}Paid: ${formatDateTime(paidAt)}\nConfirmation: ${msg.confirmationNumber ?? 'unknown'}`,
          undefined,
          true,
        )
        if (paymentEvent) await flushPendingBookingPaymentEvents()
        if (!trip) return
        try {
          const result = await notifyUserResult(msg.tripId!, {
            resultCode: ResultCode.booked,
            matchedSite: match,
            scanLease: typeof msg.scanLease === 'string' ? msg.scanLease : undefined,
            tripSnapshot: {
              name: trip.name,
              parks: trip.parks,
              dateRanges: trip.dateRanges,
              filters: trip.filters,
              mode: trip.mode,
              status: 'paid',
              attempted: trip.attempted,
              createdAt: trip.createdAt,
              updatedAt: trip.updatedAt,
              deletedAt: trip.deletedAt,
            },
          })
          await logEntry({
            level: result.emailSent ? 'info' : 'warning',
            eventCode: result.emailSent ? LogEventCode.serverEmailSent : LogEventCode.serverEmailNotSent,
            message: result.emailSent ? 'Booking paid email sent' : 'Booking paid email not sent',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: match?.parkName,
            siteName: match?.siteName,
          })
        } catch (err) {
          await logEntry({
            level: 'error',
            eventCode: LogEventCode.serverResultFailed,
            message: 'Booking paid result reporting failed',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: match?.parkName,
            siteName: match?.siteName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    })
  }
  if (msg.t === RuntimeMessageCode.bookingFailed && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getTrips().then(trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      const m = trip?.lastMatch
      const detail = m ? `${m.parkName} › Site ${m.siteName}` : ''
      void logEntry({
        level: 'error',
        eventCode: LogEventCode.bookingFailed,
        message: 'Booking failed',
        tripId: msg.tripId,
        tripName: trip?.name,
        parkName: m?.parkName,
        siteName: m?.siteName,
        checkIn: m?.checkIn,
        checkOut: m?.checkOut,
        bookingDate: new Date().toISOString(),
        status: 'failed',
        error: msg.error ?? 'Unknown error',
      }, { forceServerSync: true })
      updateTrip(msg.tripId!, { status: 'failed' }).then(async () => {
        notify(
          '❌ Payment Failed',
          `${detail}${detail ? '\n' : ''}${msg.error ?? 'Unknown error — check BC Parks tab.'}`,
          'https://camping.bcparks.ca/cart',
          true,
        )
        if (!trip) return
        try {
          const result = await notifyUserResult(msg.tripId!, {
            resultCode: ResultCode.failed,
            matchedSite: m ?? undefined,
            error: msg.error ?? 'Unknown error',
            scanLease: typeof msg.scanLease === 'string' ? msg.scanLease : undefined,
            tripSnapshot: {
              name: trip.name,
              parks: trip.parks,
              dateRanges: trip.dateRanges,
              filters: trip.filters,
              mode: trip.mode,
              status: 'failed',
              attempted: trip.attempted,
              createdAt: trip.createdAt,
              updatedAt: trip.updatedAt,
              deletedAt: trip.deletedAt,
            },
          })
          await logEntry({
            level: result.emailSent ? 'info' : 'warning',
            eventCode: result.emailSent ? LogEventCode.serverEmailSent : LogEventCode.serverEmailNotSent,
            message: result.emailSent ? 'Booking failure email sent' : 'Booking failure email not sent',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: m?.parkName,
            siteName: m?.siteName,
          })
        } catch (err) {
          await logEntry({
            level: 'error',
            eventCode: LogEventCode.serverResultFailed,
            message: 'Booking failure result reporting failed',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: m?.parkName,
            siteName: m?.siteName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    })
  }
})

chrome.runtime.onMessageExternal.addListener((msg: { t?: number }, _sender, sendResponse) => {
  if (msg.t !== RuntimeMessageCode.openAccountPage) return false

  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#account') }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message })
      return
    }

    sendResponse({ ok: true })
  })

  return true
})
