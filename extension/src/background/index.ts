import { BCParksProvider } from '../providers/bcparks'
import { getStorage, updateTrip, addDebugLog, formatDateTime } from '../storage'
import { isLoggedIn, watchLoginChanges } from './login'
import { scanTrip, buildBookingUrl } from './scanner'
import type { AvailableSite, MatchedSite, Trip } from '../types'
import { validateAuth } from '../auth'
import { sendTripResult } from '../serverApi'

const ALARM_NAME = 'scan'
const provider = new BCParksProvider()
let scanInProgress = false
let pendingScanAll = false
const pendingScanTripIds = new Set<string>()
const stoppedTripIds = new Set<string>()
const activeTripControllers = new Map<string, AbortController>()
const activeMatchKeys = new Set<string>()

// Log full raw daily API response for every site that passes availability check
provider.onAvailabilityRaw = (siteId, siteName, daily) => {
  addDebugLog(`    raw ${siteName} (id=${siteId}): ${JSON.stringify(daily)}`)
}

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm(60)
})

// Restore alarm on service worker restart
chrome.storage.local.get('settings', result => {
  const interval = (result as Record<string, { pollIntervalSeconds?: number }>)['settings']?.pollIntervalSeconds ?? 60
  setupAlarm(interval)
})

async function setupAlarm(intervalSeconds: number): Promise<void> {
  await new Promise<void>(resolve => chrome.alarms.clear(ALARM_NAME, () => resolve()))
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalSeconds / 60 })
}

chrome.alarms.onAlarm.addListener(async (alarm: chrome.alarms.Alarm) => {
  if (alarm.name !== ALARM_NAME) return
  await runScanCycle()
})

watchLoginChanges(async loggedIn => {
  if (!loggedIn) return
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
    if (settings.debugMode) await addDebugLog('Scan skipped — previous scan still running')
    return
  }

  scanInProgress = true
  try {
    const { trips, settings } = await getStorage()
    await setupAlarm(settings.pollIntervalSeconds)
    const targetSet = targetTripIds
      ? new Set(Array.isArray(targetTripIds) ? targetTripIds : [targetTripIds])
      : null

    const scanningTrips = trips.filter(t =>
      t.status === 'scanning' && (!targetSet || targetSet.has(t.id))
    )
    const debug = settings.debugMode

    await addDebugLog(`${'─'.repeat(48)}\nAlarm fired — ${scanningTrips.length} trip(s) scanning`)

    for (const trip of scanningTrips) {
      const serverLoggedIn = await validateAuth()
      if (!serverLoggedIn) {
        if (debug) await addDebugLog(`"${trip.name}" — not signed in to server, skipping scan`)
        await notify(
          'Sign In Required',
          `Sign in to start "${trip.name}" and keep booking emails connected to your account.`
        )
        continue
      }

      const loggedIn = await isLoggedIn()
      const needsLogin = trip.mode !== 'notify' && !loggedIn
      if (needsLogin) {
        if (debug) await addDebugLog(`"${trip.name}" — not logged in, skipping hold/autopay`)
        await notify(
          'CampOsprey — Login Required',
          `Log in to BC Parks to use ${trip.mode} mode for "${trip.name}"`
        )
        continue
      }

      if (debug) {
        const parkNames = trip.parks.map(p => p.name).join(', ')
        await addDebugLog(`Scanning "${trip.name}" (${trip.parks.length} park(s): ${parkNames}; ${trip.dateRanges.length} date range(s))`)
      }

      try {
        const controller = new AbortController()
        activeTripControllers.set(trip.id, controller)
        const site = await scanTrip(trip, async (id, ci, co, filters) => {
          const parkName = trip.parks.find(p => p.id === id)?.name ?? id
          if (debug) await addDebugLog(`  Checking ${parkName} | ${ci} → ${co}`)
          const results = await provider.getAvailability(id, ci, co, filters, controller.signal)
          if (results.length > 0) {
            const secW = Math.max(...results.map(s => (s.sectionName || 'no section').length))
            const siteW = Math.max(...results.map(s => s.siteName.length))
            const lines = results.map(s => {
              const sec  = (s.sectionName || 'no section').padEnd(secW)
              const site = s.siteName.padEnd(siteW)
              const flags = [s.isWalkin && 'walkin', s.isDouble && 'double'].filter(Boolean).join(' ')
              return `    • ${sec}  ${site}  id=${s.resourceId}${flags ? `  [${flags}]` : ''}`
            })
            await addDebugLog(`  API: ${results.length} available at ${parkName} ${ci}→${co}\n${lines.join('\n')}`)
          } else if (debug) {
            await addDebugLog(`  API: 0 available at ${parkName} ${ci}→${co}`)
          }
          return results
        }, () => !stoppedTripIds.has(trip.id) && !controller.signal.aborted)
        if (site) {
          if (debug) await addDebugLog(`Match found: ${site.campgroundName} › Site ${site.siteName}`)
          await handleMatch(trip, site)
        } else if (stoppedTripIds.has(trip.id) || controller.signal.aborted) {
          if (debug) await addDebugLog(`"${trip.name}" — scan stopped`)
        } else {
          if (debug) await addDebugLog(`"${trip.name}" — no availability this cycle`)
        }
      } catch (err) {
        if (stoppedTripIds.has(trip.id)) {
          if (debug) await addDebugLog(`"${trip.name}" — scan stopped`)
        } else {
          if (debug) await addDebugLog(`Error scanning "${trip.name}": ${err}`)
          console.error(`Scan error for trip ${trip.id}:`, err)
        }
      } finally {
        activeTripControllers.delete(trip.id)
      }
    }
  } finally {
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

async function handleMatch(trip: Trip, site: AvailableSite): Promise<void> {
  const key = activeMatchKey(trip.id, site)
  if (activeMatchKeys.has(key) || isSameMatch(trip.lastMatch, site)) {
    await addDebugLog(`"${trip.name}" — already handling active match for ${site.campgroundName || site.campgroundId} › Site ${site.siteName} ${site.checkIn}→${site.checkOut}; suppressing duplicate tab/notification`)
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

  await addDebugLog(`Match found: ${matchedSite.parkName} › Site ${matchedSite.siteName} (${availableLabel}) ${site.checkIn}→${site.checkOut}; found at ${foundAtLabel}`)

  if (trip.mode === 'notify') {
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
    await addDebugLog(`Reservation tab opened: ${matchedSite.parkName} › Site ${matchedSite.siteName} ${site.checkIn}→${site.checkOut}`)
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
    await addDebugLog(`Reservation tab opened for auto-pay: ${matchedSite.parkName} › Site ${matchedSite.siteName} ${site.checkIn}→${site.checkOut}`)
  }
}

async function notify(title: string, message: string, url?: string, persist = false): Promise<void> {
  const id = `camposprey-${Date.now()}`
  await new Promise<void>(resolve => {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title,
      message,
      requireInteraction: persist,  // true = stays until dismissed (match found, hold)
    }, createdId => {
      if (chrome.runtime.lastError) {
        console.error('[CampOsprey] Notification failed:', chrome.runtime.lastError.message)
        addDebugLog(`Notification error: ${chrome.runtime.lastError.message}`)
      } else {
        console.log('[CampOsprey] Notification sent:', createdId)
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
  tripId?: string
  confirmationNumber?: string
  error?: string
  attemptKey?: string
  resetActiveMatch?: boolean
}) => {
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
    getStorage().then(({ trips }) => {
      const trip = trips.find(t => t.id === msg.tripId)
      if (!trip) return
      const attempted = [...trip.attempted]
      // attemptKey is null when the failure was a timing issue — don't mark as attempted
      if (msg.attemptKey && !attempted.includes(msg.attemptKey)) {
        attempted.push(msg.attemptKey)
      }
      addDebugLog(`Match failed for "${trip.name}"${msg.attemptKey ? `; marked attempted ${msg.attemptKey}` : '; keeping match locked to avoid duplicate reservation tabs'}`)
      updateTrip(msg.tripId!, { status: 'scanning', lastMatch: msg.attemptKey ? null : trip.lastMatch, attempted })
    })
    return
  }
  if (msg.type === 'BOOKING_RESERVED' && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getStorage().then(({ trips }) => {
      const trip = trips.find(t => t.id === msg.tripId)
      const reservedAt = new Date().toISOString()
      const match = trip?.lastMatch ? { ...trip.lastMatch, reservedAt } : undefined
      const reservedAtLabel = formatDateTime(reservedAt)
      addDebugLog(`Reservation held${trip ? ` for "${trip.name}"` : ''} at ${reservedAtLabel}`)
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
          if (!match) return
          try {
            await addDebugLog(`Reporting reservation result to server${trip ? ` for "${trip.name}"` : ''}: ${match.parkName} › Site ${match.siteName} ${match.checkIn}→${match.checkOut}`)
            const result = await sendTripResult(msg.tripId!, {
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
              },
            })
            await addDebugLog(`Reservation email ${result.emailSent ? 'sent' : 'not sent'}${trip ? ` for "${trip.name}"` : ''}`)
          } catch (err) {
            await addDebugLog(`Reservation email failed${trip ? ` for "${trip.name}"` : ''}: ${err}`)
          }
        })
    })
    return
  }
  if (msg.type === 'BOOKING_CONFIRMED' && msg.tripId) {
    getStorage().then(({ trips }) => {
      const trip = trips.find(t => t.id === msg.tripId)
      const m = trip?.lastMatch
      const paidAt = new Date().toISOString()
      const detail = m
        ? `${m.parkName} › ${m.sectionName} › Site ${m.siteName}\n${m.checkIn} → ${m.checkOut}`
        : ''
      const match = m ? { ...m, paidAt } : undefined
      addDebugLog(`Booking paid${trip ? ` for "${trip.name}"` : ''} at ${formatDateTime(paidAt)}; confirmation ${msg.confirmationNumber ?? 'unknown'}`)
      updateTrip(msg.tripId!, match ? { status: 'paid', lastMatch: match } : { status: 'paid' }).then(() => {
        notify(
          'Booking Paid',
          `${detail}${detail ? '\n' : ''}Paid: ${formatDateTime(paidAt)}\nConfirmation: ${msg.confirmationNumber ?? 'unknown'}`,
          undefined,
          true,
        )
      })
    })
  }
  if (msg.type === 'BOOKING_FAILED' && msg.tripId) {
    chrome.storage.local.remove('campOspreyTarget')
    getStorage().then(({ trips }) => {
      const trip = trips.find(t => t.id === msg.tripId)
      const m = trip?.lastMatch
      const detail = m ? `${m.parkName} › Site ${m.siteName}` : ''
      addDebugLog(`Booking failed${trip ? ` for "${trip.name}"` : ''}: ${msg.error ?? 'Unknown error'}`)
      updateTrip(msg.tripId!, { status: 'failed' }).then(() => {
        notify(
          '❌ Payment Failed',
          `${detail}${detail ? '\n' : ''}${msg.error ?? 'Unknown error — check BC Parks tab.'}`,
          'https://camping.bcparks.ca/cart',
          true,
        )
      })
    })
  }
})
