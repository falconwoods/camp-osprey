import { BCParksProvider } from '../providers/bcparks'
import { getStorage, addDebugLog, formatDateTime } from '../storage'
import { isLoggedIn, watchLoginChanges } from './login'
import { scanTrip, buildBookingUrl } from './scanner'
import type { AvailableSite, DebugLogEntry, MatchedSite, Trip } from '../types'
import { validateAuth } from '../auth'
import { notifyUserResult, sendBookingPaymentEvent } from '../serverApi'
import type { BookingPaymentEventPayload } from '../serverApi'
import { flushPendingServerLogs } from '../logSync'
import { getTrips, updateTrip } from '../tripStore'

const ALARM_NAME = 'scan'
const LOG_SYNC_ALARM_NAME = 'log-sync'
const PENDING_BOOKING_PAYMENT_EVENTS_KEY = 'pendingBookingPaymentEvents'
const provider = new BCParksProvider()
let scanInProgress = false
let bookingPaymentFlushInProgress = false
let pendingScanAll = false
const pendingScanTripIds = new Set<string>()
const stoppedTripIds = new Set<string>()
const activeTripControllers = new Map<string, AbortController>()
const activeMatchKeys = new Set<string>()
const authNotificationKeys = new Set<string>()
const AUTH_NOTIFICATION_SUPPRESSIONS_KEY = 'campOspreyAuthNotificationSuppressions'
type AuthNotificationKind = 'server' | 'bcparks'
let contentLogFlushTimer: ReturnType<typeof setTimeout> | null = null

type ConfirmedBookingPaymentPayload = BookingPaymentEventPayload & { idempotencyKey: string }

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

function isConfirmedBookingPaymentPayload(value: unknown): value is ConfirmedBookingPaymentPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<ConfirmedBookingPaymentPayload>
  return payload.provider === 'bc_parks'
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

function bookingPaymentIdempotencyKey(
  trip: Trip,
  match: MatchedSite,
  confirmationNumber: string | undefined,
  paidAt: string,
): string {
  const normalizedConfirmation = confirmationNumber?.trim()
  return normalizedConfirmation && normalizedConfirmation !== 'unknown'
    ? `bc_parks:confirmation:${normalizedConfirmation}`
    : `bc_parks:booking:${trip.id}:${match.resourceId}:${match.checkIn}:${match.checkOut}:${paidAt}`
}

function buildBookingPaymentEvent(
  trip: Trip,
  match: MatchedSite,
  confirmationNumber: string | undefined,
  paidAt: string,
  bookingUrl?: string,
): ConfirmedBookingPaymentPayload {
  const normalizedConfirmation = confirmationNumber?.trim() || undefined
  return {
    tripId: trip.id,
    clientEventId: `booking-confirmed:${trip.id}:${paidAt}`,
    idempotencyKey: bookingPaymentIdempotencyKey(trip, match, normalizedConfirmation, paidAt),
    provider: 'bc_parks',
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
      source: 'bcparks_confirmation_dom',
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
          event: 'booking_payment_event_reported',
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
          event: 'booking_payment_event_report_failed',
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
    event: 'availability_raw',
    message: 'Raw availability response',
    siteName,
    metadata: { siteId, daily },
  })
}

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm(60)
  setupLogSyncAlarm()
})

// Restore alarm on service worker restart
chrome.storage.local.get('settings', result => {
  const interval = (result as Record<string, { pollIntervalSeconds?: number }>)['settings']?.pollIntervalSeconds ?? 60
  setupAlarm(interval)
  setupLogSyncAlarm()
  void flushPendingBookingPaymentEvents()
})

async function setupAlarm(intervalSeconds: number): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(ALARM_NAME, () => resolve()))
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalSeconds / 60 })
}

async function setupLogSyncAlarm(): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(LOG_SYNC_ALARM_NAME, () => resolve()))
  chrome.alarms.create(LOG_SYNC_ALARM_NAME, { periodInMinutes: 1 })
}

chrome.alarms.onAlarm.addListener(async (alarm: chrome.alarms.Alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runScanCycle()
  } else if (alarm.name === LOG_SYNC_ALARM_NAME) {
    await flushPendingBookingPaymentEvents()
    await flushPendingServerLogs()
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
    if (settings.debugMode) await logEntry({
      level: 'debug',
      event: 'scan_skipped',
      message: 'Previous scan still running',
    })
    return
  }

  scanInProgress = true
  try {
    const { settings } = await getStorage()
    const trips = await getTrips()
    await setupAlarm(settings.pollIntervalSeconds)
    const targetSet = targetTripIds
      ? new Set(Array.isArray(targetTripIds) ? targetTripIds : [targetTripIds])
      : null

    const scanningTrips = trips.filter(t =>
      t.status === 'scanning' && (!targetSet || targetSet.has(t.id))
    )
    const debug = settings.debugMode

    await logEntry({
      level: 'debug',
      event: 'scan_cycle_started',
      message: 'Alarm fired',
      metadata: { scanningTripCount: scanningTrips.length },
    })

    for (const trip of scanningTrips) {
      const serverLoggedIn = await validateAuth()
      if (!serverLoggedIn) {
        await logEntry({
          level: 'debug',
          event: 'server_auth_missing',
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

      const loggedIn = await isLoggedIn()
      const needsLogin = trip.mode !== 'alert' && !loggedIn
      if (needsLogin) {
        await logEntry({
          level: 'warning',
          event: 'bcparks_login_missing',
          message: 'Not logged in to BC Parks; skipping hold or auto-pay',
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
          event: 'trip_scan_started',
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
        const site = await scanTrip(trip, async (id, ci, co, filters) => {
          const parkName = trip.parks.find(p => p.id === id)?.name ?? id
          if (debug) await logEntry({
            level: 'debug',
            event: 'park_checked',
            message: 'Checking park date window',
            tripId: trip.id,
            tripName: trip.name,
            parkName,
            checkIn: ci,
            checkOut: co,
          })
          const results = await provider.getAvailability(id, ci, co, filters, controller.signal)
          if (results.length > 0) {
            await logEntry({
              level: 'info',
              event: 'availability_result',
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
              event: 'availability_result',
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
        }, () => !stoppedTripIds.has(trip.id) && !controller.signal.aborted)
        if (site) {
          await handleMatch(trip, site, settings.emailOnSiteFound ?? false)
        } else if (stoppedTripIds.has(trip.id) || controller.signal.aborted) {
          if (debug) await logEntry({
            level: 'debug',
            event: 'trip_scan_stopped',
            message: 'Trip scan stopped',
            tripId: trip.id,
            tripName: trip.name,
          })
        } else {
          if (debug) await logEntry({
            level: 'debug',
            event: 'trip_scan_empty',
            message: 'No availability this cycle',
            tripId: trip.id,
            tripName: trip.name,
          })
        }
      } catch (err) {
        if (stoppedTripIds.has(trip.id)) {
          if (debug) await logEntry({
            level: 'debug',
            event: 'trip_scan_stopped',
            message: 'Trip scan stopped',
            tripId: trip.id,
            tripName: trip.name,
          })
        } else {
          await logEntry({
            level: 'error',
            event: 'trip_scan_error',
            message: 'Error scanning trip',
            tripId: trip.id,
            tripName: trip.name,
            error: err instanceof Error ? err.message : String(err),
          })
          console.error(`Scan error for trip ${trip.id}:`, err)
        }
      } finally {
        activeTripControllers.delete(trip.id)
      }
    }
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

function isSameMatch(match: MatchedSite | null, site: AvailableSite): boolean {
  return !!match &&
    match.resourceId === site.resourceId &&
    match.checkIn === site.checkIn &&
    match.checkOut === site.checkOut
}

async function reportFoundResult(trip: Trip, matchedSite: MatchedSite, sendEmail: boolean): Promise<void> {
  try {
    await logEntry({
      level: 'info',
      event: 'server_result_reported',
      message: 'Reporting found site result to server',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      checkIn: matchedSite.checkIn,
      checkOut: matchedSite.checkOut,
      status: 'found',
    })
    const result = await notifyUserResult(trip.id, {
      outcome: 'found',
      matchedSite,
      sendEmail,
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
    await logEntry({
      level: result.emailSent ? 'info' : 'warning',
      event: result.emailSent ? 'server_email_sent' : 'server_email_not_sent',
      message: result.emailSent ? 'Site found email sent' : 'Site found email not sent',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
    })
  } catch (err) {
    await logEntry({
      level: 'error',
      event: 'server_result_failed',
      message: 'Site found result reporting failed',
      tripId: trip.id,
      tripName: trip.name,
      parkName: matchedSite.parkName,
      siteName: matchedSite.siteName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleMatch(trip: Trip, site: AvailableSite, emailOnSiteFound: boolean): Promise<void> {
  const key = activeMatchKey(trip.id, site)
  if (activeMatchKeys.has(key) || isSameMatch(trip.lastMatch, site)) {
    await logEntry({
      level: 'warning',
      event: 'active_match_suppressed',
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
    event: 'site_found',
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

  await reportFoundResult(trip, matchedSite, emailOnSiteFound)

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

  // For hold and autopay: open BC Parks booking tab so the reservation
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
        setAt: Date.now(),
      },
    }, resolve)
  )

  if (trip.mode === 'hold') {
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
      event: 'reservation_tab_opened',
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
      event: 'reservation_tab_opened',
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
      requireInteraction: persist,  // true = stays until dismissed (match found, hold)
    }, createdId => {
      if (chrome.runtime.lastError) {
        console.error('[campsoon] Notification failed:', chrome.runtime.lastError.message)
        void logEntry({
          level: 'error',
          event: 'notification_error',
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
  type: string
  level?: DebugLogEntry['level']
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
	}) => {
  if (msg.type === 'CONTENT_DEBUG_LOG') {
    void addDebugLog({
      level: msg.level ?? 'info',
      event: msg.event ?? 'content_script_log',
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
  if (msg.type === 'SCAN_NOW') {
    if (msg.tripId) stoppedTripIds.delete(msg.tripId)
    if (msg.tripId && msg.resetActiveMatch) clearActiveMatchesForTrip(msg.tripId)
    chrome.storage.local.remove('campOspreyTarget')
    runScanCycle(msg.tripId)
    return
  }
  if (msg.type === 'STOP_SCAN' && msg.tripId) {
    stoppedTripIds.add(msg.tripId)
    activeTripControllers.get(msg.tripId)?.abort()
    return
  }
  if (msg.type === 'MATCH_FAILED' && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
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
        event: 'match_failed',
        message: msg.attemptKey ? 'Match failed; marked attempted' : 'Match failed; retrying next scan',
        tripId: trip.id,
        tripName: trip.name,
        metadata: { attemptKey: msg.attemptKey ?? null },
      })
      void updateTrip(msg.tripId!, { status: 'scanning', lastMatch: null, attempted })
    })
    return
  }
  if (msg.type === 'BOOKING_RESERVED' && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getTrips().then(trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      const reservedAt = new Date().toISOString()
      const match = trip?.lastMatch ? { ...trip.lastMatch, reservedAt } : undefined
      const reservedAtLabel = formatDateTime(reservedAt)
      void logEntry({
        level: 'info',
        event: 'booking_reserved',
        message: 'Reservation held',
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
              event: 'server_result_reported',
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
              outcome: 'hold_placed',
              matchedSite: match,
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
              event: result.emailSent ? 'server_email_sent' : 'server_email_not_sent',
              message: result.emailSent ? 'Reservation email sent' : 'Reservation email not sent',
              tripId: msg.tripId!,
              tripName: trip.name,
              parkName: match.parkName,
              siteName: match.siteName,
            })
          } catch (err) {
            await logEntry({
              level: 'error',
              event: 'server_email_failed',
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
  if (msg.type === 'BOOKING_CONFIRMED' && msg.tripId) {
    getTrips().then(trips => {
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
        ? buildBookingPaymentEvent(trip, match, msg.confirmationNumber, paidAt, msg.bookingUrl)
        : null
      void logEntry({
        level: 'info',
        event: 'booking_paid',
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
            event: 'booking_payment_event_missing_metadata',
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
            outcome: 'booked',
            matchedSite: match,
            sendEmail: true,
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
            event: result.emailSent ? 'server_email_sent' : 'server_email_not_sent',
            message: result.emailSent ? 'Booking paid email sent' : 'Booking paid email not sent',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: match?.parkName,
            siteName: match?.siteName,
          })
        } catch (err) {
          await logEntry({
            level: 'error',
            event: 'server_result_failed',
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
  if (msg.type === 'BOOKING_FAILED' && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getTrips().then(trips => {
      const trip = trips.find(t => t.id === msg.tripId)
      const m = trip?.lastMatch
      const detail = m ? `${m.parkName} › Site ${m.siteName}` : ''
      void logEntry({
        level: 'error',
        event: 'booking_failed',
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
            outcome: 'failed',
            matchedSite: m ?? undefined,
            error: msg.error ?? 'Unknown error',
            sendEmail: true,
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
            event: result.emailSent ? 'server_email_sent' : 'server_email_not_sent',
            message: result.emailSent ? 'Booking failure email sent' : 'Booking failure email not sent',
            tripId: msg.tripId!,
            tripName: trip.name,
            parkName: m?.parkName,
            siteName: m?.siteName,
          })
        } catch (err) {
          await logEntry({
            level: 'error',
            event: 'server_result_failed',
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

chrome.runtime.onMessageExternal.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg.type !== 'OPEN_ACCOUNT_PAGE') return false

  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#account') }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message })
      return
    }

    sendResponse({ ok: true })
  })

  return true
})
