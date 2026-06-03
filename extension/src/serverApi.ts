import { getAuth, getClientId, saveAuth } from './storage'
import { BACKEND_BASE_URL } from './config'
import type { ClientInfo, DebugLogEntry, MatchedSite, Trip } from './types'

export class ServerApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export function getServerBaseUrl(): string {
  return BACKEND_BASE_URL
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

export interface TripResultPayload {
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

export async function sendTripResult(
  tripId: string,
  payload: TripResultPayload,
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
