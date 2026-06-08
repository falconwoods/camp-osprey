import { getAuth, getClientId } from './storage'
import { ServerApiError, serverFetch, syncTripToServer, softDeleteTripOnServer } from './serverApi'
import type { Trip } from './types'

const TRIPS_CACHE_KEY = 'campsoonTripsCache'

interface TripsCache {
  authToken: string
  trips: Trip[]
  fetchedAt: number
}

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

function normalizeMode(value: unknown): Trip['mode'] {
  if (value === 'notify' || value === 'alert') return 'alert'
  if (value === 'autopay') return 'autopay'
  return 'hold'
}

function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result as Record<string, unknown>)))
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set(items, () => resolve()))
}

function storageRemove(keys: string | string[]): Promise<void> {
  return new Promise(resolve => chrome.storage.local.remove(keys, () => resolve()))
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
    mode: normalizeMode(source.mode),
    status: (source.status as string) === 'completed' ? 'paid' : source.status ?? 'idle',
    lastMatch: source.lastMatch ?? null,
    attempted: Array.isArray(source.attempted) ? source.attempted : [],
    createdAt,
    updatedAt,
    deletedAt: toNullableTime(source.deletedAt),
  } as Trip
}

async function readTripsCache(authToken: string): Promise<Trip[] | null> {
  const result = await storageGet([TRIPS_CACHE_KEY])
  const cache = result[TRIPS_CACHE_KEY] as Partial<TripsCache> | undefined
  if (!cache || cache.authToken !== authToken || !Array.isArray(cache.trips)) return null
  return cache.trips.map(normalizeTrip).filter(trip => !trip.deletedAt)
}

async function writeTripsCache(authToken: string, trips: Trip[]): Promise<void> {
  await storageSet({
    [TRIPS_CACHE_KEY]: {
      authToken,
      trips,
      fetchedAt: Date.now(),
    } satisfies TripsCache,
  })
}

async function updateTripsCache(authToken: string, update: (trips: Trip[]) => Trip[]): Promise<void> {
  const trips = await readTripsCache(authToken)
  if (!trips) return
  await writeTripsCache(authToken, update(trips))
}

export async function getTrips(options: { refresh?: boolean } = {}): Promise<Trip[]> {
  const auth = await getAuth()
  if (!auth.token) {
    await storageRemove(TRIPS_CACHE_KEY)
    return []
  }

  if (!options.refresh) {
    const cached = await readTripsCache(auth.token)
    if (cached) return cached
  }

  const rows = await serverFetch<unknown[]>('/api/trips', { method: 'GET', auth: true })
  const trips = rows.map(normalizeTrip).filter(trip => !trip.deletedAt)
  const refreshedAuth = await getAuth()
  await writeTripsCache(refreshedAuth.token ?? auth.token, trips)
  return trips
}

export async function saveTrip(trip: Trip): Promise<Trip> {
  const auth = await getAuth()
  if (!auth.token) throw new ServerApiError(401, 'auth_required')
  const clientId = await getClientId()
  const saved = await syncTripToServer({ ...trip, clientId: trip.clientId ?? clientId })
  const normalized = normalizeTrip(saved)
  const refreshedAuth = await getAuth()
  await updateTripsCache(refreshedAuth.token ?? auth.token, trips => {
    const next = trips.filter(item => item.id !== normalized.id)
    return normalized.deletedAt ? next : [...next, normalized]
  })
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
  const refreshedAuth = await getAuth()
  await updateTripsCache(refreshedAuth.token ?? auth.token, trips => trips.filter(item => item.id !== trip.id))
  notifyTripsChanged()
}
