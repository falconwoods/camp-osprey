import { getAuth, getClientId } from './storage'
import { ServerApiError, serverFetch, syncTripToServer, softDeleteTripOnServer } from './serverApi'
import type { Trip } from './types'

function notifyTripsChanged(): void {
  try {
    chrome.runtime.sendMessage({ type: 'TRIPS_CHANGED' })
  } catch {
    // Views also refresh on direct user actions; this only keeps open views fresh.
  }
}

function toTime(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' || value instanceof Date) {
    const time = new Date(value).getTime()
    if (!Number.isNaN(time)) return time
  }
  return fallback
}

function toNullableTime(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const time = toTime(value, Number.NaN)
  return Number.isNaN(time) ? null : time
}

export function normalizeTrip(value: unknown): Trip {
  const source = value as Partial<Trip> & { createdAt?: unknown; updatedAt?: unknown; deletedAt?: unknown }
  const createdAt = toTime(source.createdAt)
  const updatedAt = toTime(source.updatedAt, createdAt)
  return {
    id: String(source.id),
    clientId: source.clientId,
    name: String(source.name ?? ''),
    parks: Array.isArray(source.parks) ? source.parks : [],
    dateRanges: Array.isArray(source.dateRanges) ? source.dateRanges : [],
    filters: source.filters ?? { noWalkin: true, noDouble: true },
    mode: source.mode ?? 'hold',
    status: (source.status as string) === 'completed' ? 'paid' : source.status ?? 'idle',
    lastMatch: source.lastMatch ?? null,
    attempted: Array.isArray(source.attempted) ? source.attempted : [],
    createdAt,
    updatedAt,
    deletedAt: toNullableTime(source.deletedAt),
  } as Trip
}

export async function getTrips(): Promise<Trip[]> {
  const auth = await getAuth()
  if (!auth.token) return []
  const rows = await serverFetch<unknown[]>('/api/trips', { method: 'GET', auth: true })
  return rows.map(normalizeTrip).filter(trip => !trip.deletedAt)
}

export async function saveTrip(trip: Trip): Promise<Trip> {
  const auth = await getAuth()
  if (!auth.token) throw new ServerApiError(401, 'auth_required')
  const clientId = await getClientId()
  const saved = await syncTripToServer({ ...trip, clientId: trip.clientId ?? clientId })
  const normalized = normalizeTrip(saved)
  notifyTripsChanged()
  return normalized
}

export async function updateTrip(tripId: string, updates: Partial<Trip>): Promise<Trip> {
  const trips = await getTrips()
  const trip = trips.find(t => t.id === tripId)
  if (!trip) throw new Error(`Trip ${tripId} not found`)
  return saveTrip({ ...trip, ...updates, updatedAt: Date.now() })
}

export async function deleteTrip(trip: Trip): Promise<void> {
  const auth = await getAuth()
  if (!auth.token) throw new ServerApiError(401, 'auth_required')
  const deletedAt = Date.now()
  await softDeleteTripOnServer({ ...trip, deletedAt, updatedAt: deletedAt })
  notifyTripsChanged()
}
