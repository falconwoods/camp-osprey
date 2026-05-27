import { getAuth } from './storage'
import type { MatchedSite, Trip } from './types'

const DEFAULT_BASE_URL = 'http://localhost:4000'

export class ServerApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export function getServerBaseUrl(): string {
  return DEFAULT_BASE_URL
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
  tripSnapshot?: Pick<Trip, 'name' | 'parks' | 'dateRanges' | 'filters' | 'mode' | 'status' | 'attempted'>
}

export async function sendTripResult(
  tripId: string,
  payload: TripResultPayload,
): Promise<{ ok: true; emailSent: boolean }> {
  return serverFetch(`/api/trips/${encodeURIComponent(tripId)}/result`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(payload),
  })
}
