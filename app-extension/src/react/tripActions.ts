import { isLoggedIn } from '../background/login'
import { validateAuth } from '../auth'
import { openAuthGateForTrip, requireServerAuthForStart } from '../startAuthGate'
import { getClientId, getStorage } from '../storage'
import { deleteTrip, getTrips, saveTrip, updateTrip } from '../tripStore'
import type { DateRange, Park, PaymentConfig, Trip } from '../types'
import { getCachedExtensionConfig, isForceUpdateRequired, refreshExtensionConfig } from '../extensionConfig'
import { requestScanLease } from '../serverApi'
import { RuntimeMessageCode } from '../protocol'
import { decryptParkPayment, hasSavedParkPayment } from '../paymentCrypto'

export function isValidParkPayment(payment: PaymentConfig | null): payment is PaymentConfig {
  return hasSavedParkPayment(payment)
}

async function canUseParkPayment(): Promise<boolean> {
  const { payment } = await getStorage()
  if (!isValidParkPayment(payment)) return false
  try {
    const decrypted = await decryptParkPayment(payment)
    return [
      decrypted.cardNumber,
      decrypted.cardHolder,
      decrypted.cardExpiry,
      decrypted.cardCvv,
      decrypted.billingAddress,
      decrypted.billingPostal,
    ].every(value => typeof value === 'string' && value.trim())
  } catch {
    return false
  }
}

export async function startTripNow(tripId: string, openAuth = true): Promise<{ ok: true } | { ok: false; reason: string }> {
  const extensionConfig = await getCachedExtensionConfig() ?? await refreshExtensionConfig().catch(() => null)
  if (isForceUpdateRequired(extensionConfig)) return { ok: false, reason: 'extension_update_required' }
  if (!(await requireServerAuthForStart(tripId, openAuth))) return { ok: false, reason: 'server_auth' }
  const trips = await getTrips()
  const trip = trips.find(item => item.id === tripId)
  if (trip && trip.mode !== 'alert' && !(await isLoggedIn())) {
    chrome.tabs.create({ url: 'https://camping.bcparks.ca/login' })
    return { ok: false, reason: 'bcparks_auth' }
  }
  if (trip?.mode === 'autopay' && !(await canUseParkPayment())) {
    return { ok: false, reason: 'payment' }
  }
  const scanLease = await requestScanLease(tripId)
  chrome.storage.local.remove('campOspreyTarget')
  await updateTrip(tripId, { status: 'scanning', lastMatch: null, attempted: [] })
  chrome.runtime.sendMessage({ t: RuntimeMessageCode.scanNow, tripId, resetActiveMatch: true, scanLease })
  return { ok: true }
}

export async function pauseTrip(tripId: string): Promise<void> {
  await updateTrip(tripId, { status: 'paused' })
  chrome.runtime.sendMessage({ t: RuntimeMessageCode.stopScan, tripId })
  chrome.storage.local.remove('campOspreyTarget')
}

export async function removeTrip(trip: Trip): Promise<void> {
  await deleteTrip(trip)
}

export async function saveTripDraft(input: {
  existing?: Trip | null
  name: string
  mode: Trip['mode']
  filters: Trip['filters']
  parks: Park[]
  dateRanges: DateRange[]
}): Promise<Trip> {
  const now = Date.now()
  const clientId = await getClientId()
  const trip: Trip = input.existing
    ? {
      ...input.existing,
      clientId: input.existing.clientId ?? clientId,
      name: input.name,
      mode: input.mode,
      filters: input.filters,
      parks: input.parks,
      dateRanges: input.dateRanges,
      status: 'idle',
      updatedAt: now,
      deletedAt: null,
    }
    : {
      id: crypto.randomUUID(),
      clientId,
      name: input.name,
      mode: input.mode,
      filters: input.filters,
      parks: input.parks,
      dateRanges: input.dateRanges,
      status: 'idle',
      lastMatch: null,
      attempted: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
  return saveTrip(trip)
}

export async function ensureSignedInForTripSave(openAuth = true): Promise<boolean> {
  if (await validateAuth()) return true
  await openAuthGateForTrip(null, openAuth)
  return false
}
