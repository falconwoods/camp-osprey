import { getAuth, getClientId, saveAuth } from './storage'
import { BACKEND_BASE_URL, EXTENSION_CHANNEL } from './config'
import type { ClientInfo, DebugLogEntry, ExtensionRemoteConfig, MatchedSite, Trip } from './types'

export class ServerApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export function getServerBaseUrl(): string {
  return BACKEND_BASE_URL
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve({})
      return
    }
    chrome.storage.local.get(keys, result => resolve(result as Record<string, unknown>))
  })
}

async function debugServerFetch<T>(path: string): Promise<T | null> {
  if (import.meta.env.MODE !== 'development') return null
  const result = await storageGet(['campOspreyDebugServerResponses'])
  const responses = result.campOspreyDebugServerResponses
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) return null
  const map = responses as Record<string, unknown>
  const response = map[path] ?? map.default
  return response === undefined ? null : response as T
}

export async function serverFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  if (options.auth) {
    const { token } = await getAuth()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const debugResponse = await debugServerFetch<T>(path)
  if (debugResponse) return debugResponse

  const response = await fetch(`${getServerBaseUrl()}${path}`, {
    ...options,
    headers,
  })

  const refreshedToken = options.auth ? response.headers.get('set-auth-token') : null
  if (refreshedToken) {
    const auth = await getAuth()
    if (auth.token && auth.token !== refreshedToken) {
      await saveAuth({ ...auth, token: refreshedToken })
    }
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ServerApiError(response.status, String(data.error ?? 'server_error'))
  }
  return data as T
}

export interface NotifyUserResultPayload {
  outcome: 'found' | 'hold_placed' | 'booked' | 'failed'
  matchedSite?: MatchedSite
  error?: string
  sendEmail?: boolean
  tripSnapshot?: Pick<Trip, 'name' | 'parks' | 'dateRanges' | 'filters' | 'mode' | 'status' | 'attempted' | 'createdAt' | 'updatedAt' | 'deletedAt'>
}

function tripSyncPayload(trip: Trip, clientId: string) {
  return {
    id: trip.id,
    clientId: trip.clientId ?? clientId,
    name: trip.name,
    parks: trip.parks,
    dateRanges: trip.dateRanges,
    filters: trip.filters,
    mode: trip.mode,
    status: trip.status,
    lastMatch: trip.lastMatch,
    attempted: trip.attempted,
    createdAt: new Date(trip.createdAt).toISOString(),
    updatedAt: new Date(trip.updatedAt ?? trip.createdAt).toISOString(),
    deletedAt: trip.deletedAt ? new Date(trip.deletedAt).toISOString() : null,
  }
}

function getPlatformInfo(): Promise<chrome.runtime.PlatformInfo | null> {
  return new Promise(resolve => {
    try {
      if (!chrome.runtime.getPlatformInfo) {
        resolve(null)
        return
      }
      chrome.runtime.getPlatformInfo(info => resolve(info))
    } catch {
      resolve(null)
    }
  })
}

export async function getClientInfo(): Promise<ClientInfo> {
  const platform = await getPlatformInfo()
  return {
    extensionVersion: chrome.runtime.getManifest?.().version,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    platformOs: platform?.os,
    platformArch: platform?.arch,
    platformNaclArch: platform?.nacl_arch,
  }
}

export async function getExtensionRemoteConfig(clientId: string): Promise<ExtensionRemoteConfig> {
  const clientInfo = await getClientInfo()
  return serverFetch<ExtensionRemoteConfig>('/api/extension/config', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({
      channel: EXTENSION_CHANNEL,
      clientId,
      extensionId: chrome.runtime.id,
      browser: 'chrome',
      locale: chrome.i18n?.getUILanguage?.() ?? navigator.language,
      clientInfo,
    }),
  })
}

export async function notifyUserResult(
  tripId: string,
  payload: NotifyUserResultPayload,
): Promise<{ ok: true; emailSent: boolean }> {
  const [clientId, clientInfo] = await Promise.all([getClientId(), getClientInfo()])
  return serverFetch(`/api/trips/${encodeURIComponent(tripId)}/result`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ ...payload, clientId, clientInfo }),
  })
}

export async function syncTripToServer(trip: Trip): Promise<Trip> {
  const auth = await getAuth()
  if (!auth.token) return trip
  const clientId = await getClientId()
  return serverFetch<Trip>(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(tripSyncPayload(trip, clientId)),
  })
}

export async function softDeleteTripOnServer(trip: Trip): Promise<{ ok: true }> {
  const auth = await getAuth()
  if (!auth.token) return { ok: true }
  const clientId = await getClientId()
  return serverFetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: 'DELETE',
    auth: true,
    body: JSON.stringify({
      clientId: trip.clientId ?? clientId,
      deletedAt: new Date(trip.deletedAt ?? Date.now()).toISOString(),
    }),
  })
}

export async function sendExtensionLogs(
  entries: DebugLogEntry[],
): Promise<{ ok: true; accepted: number }> {
  const clientId = await getClientId()
  const clientInfo = await getClientInfo()
  return serverFetch('/api/extension-logs', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ clientId, clientInfo, entries }),
  })
}

export interface PointsSummary {
  balance: number
  packages: Array<{ id: string; name: string; points: number; priceLabel: string; recommended: boolean }>
  successfulBookingPointCost: number
  recentTransactions: Array<{
    id: number
    type: string
    pointsDelta: number
    balanceAfter: number
    sourceType: string
    sourceId: string
    details?: string
    createdAt: string
  }>
}

export async function getPointsSummary(): Promise<PointsSummary> {
  const summary = await serverFetch<PointsSummary>('/api/points', { method: 'GET', auth: true })
  const auth = await getAuth()
  if (auth.user) {
    await saveAuth({ ...auth, pointsBalance: summary.balance })
  }
  return summary
}

export async function createPointCheckout(
  packageId: string,
  returnUrl?: string,
  extensionId?: string,
): Promise<{ checkoutUrl: string; stripeSessionId: string }> {
  return serverFetch('/api/stripe/checkout', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ packageId, returnUrl, extensionId }),
  })
}

export interface BookingPaymentEventPayload {
  tripId?: string
  clientEventId?: string
  idempotencyKey?: string
  provider: 'bc_parks'
  confirmationNumber?: string
  providerReservationId?: string
  providerTransactionId?: string
  parkName: string
  campgroundName?: string
  sectionName?: string
  siteName: string
  resourceId?: string
  checkIn: string
  checkOut: string
  paidAt?: string
  bookingUrl?: string
  amountPaid?: number
  currency?: string
  rawProviderSnapshot?: unknown
}

export async function sendBookingPaymentEvent(
  payload: BookingPaymentEventPayload,
): Promise<{
  ok: true
  bookingPaymentEventId: number
  chargeStatus: 'charged' | 'failed_insufficient_points' | 'duplicate_ignored'
  pointTransactionId: number | null
  balanceAfter: number | null
  duplicate: boolean
}> {
  const [clientId, clientInfo] = await Promise.all([getClientId(), getClientInfo()])
  const result = await serverFetch<{
    ok: true
    bookingPaymentEventId: number
    chargeStatus: 'charged' | 'failed_insufficient_points' | 'duplicate_ignored'
    pointTransactionId: number | null
    balanceAfter: number | null
    duplicate: boolean
  }>('/api/booking-payment-events', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ ...payload, clientId, clientInfo }),
  })
  if (typeof result.balanceAfter === 'number') {
    const auth = await getAuth()
    if (auth.user) await saveAuth({ ...auth, pointsBalance: result.balanceAfter })
  }
  return result
}
