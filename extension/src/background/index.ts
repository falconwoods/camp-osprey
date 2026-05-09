import { BCParksProvider } from '../providers/bcparks'
import { getStorage, updateTrip, addDebugLog } from '../storage'
import { isLoggedIn, watchLoginChanges } from './login'
import { scanTrip, makeAttemptedKey, buildBookingUrl } from './scanner'
import type { AvailableSite, Trip } from '../types'

const ALARM_NAME = 'scan'
const provider = new BCParksProvider()

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

async function runScanCycle(): Promise<void> {
  const { trips, payment, settings } = await getStorage()
  await setupAlarm(settings.pollIntervalSeconds)

  const scanningTrips = trips.filter(t => t.status === 'scanning')
  const debug = settings.debugMode

  if (debug) await addDebugLog(`Alarm fired — ${scanningTrips.length} trip(s) scanning`)

  for (const trip of scanningTrips) {
    const loggedIn = await isLoggedIn()
    const needsLogin = trip.mode !== 'notify' && !loggedIn
    if (needsLogin) {
      if (debug) await addDebugLog(`"${trip.name}" — not logged in, skipping hold/autopay`)
      await notify(
        'CampSniper — Login Required',
        `Log in to BC Parks to use ${trip.mode} mode for "${trip.name}"`
      )
      continue
    }

    if (debug) await addDebugLog(`Scanning "${trip.name}" (${trip.parks.length} park(s), ${trip.dateRanges.length} date range(s))`)

    try {
      const site = await scanTrip(trip, async (id, ci, co, filters) => {
        if (debug) await addDebugLog(`  Checking park ${id} | ${ci} → ${co}`)
        const results = await provider.getAvailability(id, ci, co, filters)
        if (debug) await addDebugLog(`  → ${results.length} site(s) available`)
        return results
      })
      if (site) {
        if (debug) await addDebugLog(`Match found: ${site.campgroundName} › Site ${site.siteName}`)
        await handleMatch(trip, site, payment?.partySize ?? 1)
      } else {
        if (debug) await addDebugLog(`"${trip.name}" — no availability this cycle`)
      }
    } catch (err) {
      if (debug) await addDebugLog(`Error scanning "${trip.name}": ${err}`)
      console.error(`Scan error for trip ${trip.id}:`, err)
    }
  }
}

async function handleMatch(trip: Trip, site: AvailableSite, partySize: number): Promise<void> {
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const nightStr = `${nights} night${nights !== 1 ? 's' : ''}`
  const bookingUrl = buildBookingUrl(site)

  const matchedSite = {
    parkName: site.campgroundName || site.campgroundId,
    siteName: site.siteName,
    sectionName: site.sectionName,
    checkIn: site.checkIn,
    checkOut: site.checkOut,
    bookingUrl,
    resourceId: site.resourceId,
  }

  if (trip.mode === 'notify') {
    await notify(
      `Campsite Available — ${matchedSite.parkName}`,
      `${matchedSite.sectionName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut} (${nightStr})`,
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
      campSnaperTarget: {
        resourceId: site.resourceId,
        siteName: site.siteName,
        sectionName: site.sectionName,
        parkName: site.campgroundName || site.campgroundId,
        tripId: trip.id,
        mode: trip.mode,
        // Pass filter settings so content script can enforce them from the BC Parks UI
        noDouble: trip.filters.noDouble,
        noWalkin: trip.filters.noWalkin,
        setAt: Date.now(),
      },
    }, resolve)
  )

  if (trip.mode === 'hold') {
    await notify(
      `Site Available — Reserve Now`,
      `${matchedSite.parkName} › ${matchedSite.sectionName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut}\nBC Parks is opening — click Reserve in your browser.`,
      bookingUrl,
      true,
    )
    chrome.tabs.create({ url: bookingUrl })
    await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
    return
  }

  if (trip.mode === 'autopay') {
    await notify(
      `Site Available — Auto-paying`,
      `${matchedSite.parkName} › ${matchedSite.sectionName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut}`,
      bookingUrl,
      true,
    )
    chrome.tabs.create({ url: bookingUrl })
    await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
  }
}

async function notify(title: string, message: string, url?: string, persist = false): Promise<void> {
  const id = `campsniper-${Date.now()}`
  await new Promise<void>(resolve => {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title,
      message,
      requireInteraction: persist,  // true = stays until dismissed (match found, hold)
    }, createdId => {
      if (chrome.runtime.lastError) {
        console.error('[CampSniper] Notification failed:', chrome.runtime.lastError.message)
        addDebugLog(`Notification error: ${chrome.runtime.lastError.message}`)
      } else {
        console.log('[CampSniper] Notification sent:', createdId)
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

chrome.runtime.onMessage.addListener((msg: { type: string; tripId?: string; confirmationNumber?: string; error?: string }) => {
  if (msg.type === 'SCAN_NOW') {
    // Triggered when user clicks Start — run a cycle immediately, don't wait for next alarm
    runScanCycle()
    return
  }
  if (msg.type === 'BOOKING_CONFIRMED' && msg.tripId) {
    updateTrip(msg.tripId, { status: 'completed' }).then(() => {
      notify('Booking Confirmed!', `Confirmation: ${msg.confirmationNumber ?? 'unknown'}`)
    })
  }
  if (msg.type === 'BOOKING_FAILED' && msg.tripId) {
    updateTrip(msg.tripId, { status: 'paused' }).then(() => {
      notify('Payment Failed', msg.error ?? 'Unknown error — check BC Parks tab.')
    })
  }
})
