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

  try {
    await provider.holdSite(site, partySize)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('ResourceUnavailable')) {
      await updateTrip(trip.id, { attempted: [...trip.attempted, makeAttemptedKey(site)] })
      return
    }
    // Site was found but hold failed — save lastMatch so user can book manually
    await notify(
      `Hold Failed — Book Manually`,
      `${matchedSite.parkName} › Site ${matchedSite.siteName} (${site.checkIn} → ${site.checkOut})\nError: ${msg}`,
      bookingUrl,
      true,
    )
    await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
    return
  }

  const checkoutUrl = 'https://camping.bcparks.ca/create-booking/reservationmessages'

  if (trip.mode === 'hold') {
    await notify(
      'Site Held — Complete Payment Now',
      `${matchedSite.parkName} › Site ${matchedSite.siteName}\n${site.checkIn} → ${site.checkOut}\nHeld 15 min — open BC Parks to pay.`,
      checkoutUrl,
      true,
    )
    chrome.tabs.create({ url: checkoutUrl })
    await updateTrip(trip.id, { status: 'paused', lastMatch: matchedSite })
    return
  }

  if (trip.mode === 'autopay') {
    await new Promise<void>(resolve => chrome.storage.session.set({ autopayTripId: trip.id }, resolve))
    chrome.tabs.create({ url: checkoutUrl })
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
