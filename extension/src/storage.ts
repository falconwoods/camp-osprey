import type { AuthState, StorageData, Trip, PaymentConfig, Settings, DebugLogEntry } from './types'

export const MAX_DEBUG_LOG_ENTRIES = 100_000
let debugLogWriteQueue = Promise.resolve()

const DEFAULTS: StorageData = {
  trips: [],
  payment: null,
  settings: { pollIntervalSeconds: 60, debugMode: false, theme: 'auto' },
  debugLog: [],
  auth: { token: null, user: null, lastEmail: null },
}

function promisify<T>(fn: (callback: (result: T) => void) => void): Promise<T> {
  return new Promise(resolve => fn(resolve))
}

export async function getStorage(): Promise<StorageData> {
  const keys = Object.keys(DEFAULTS)
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get(keys, cb)
  )
  const data = { ...DEFAULTS, ...result } as StorageData
  data.trips = data.trips.map(trip => ({
    ...trip,
    status: (trip.status as string) === 'completed' ? 'paid' : trip.status,
  }))
  return data
}

export async function saveTrips(trips: Trip[]): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ trips }, cb))
}

export async function savePayment(payment: PaymentConfig | null): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ payment }, cb))
}

export async function saveSettings(settings: Settings): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ settings }, cb))
}

export function formatDateTime(date: Date | string | number = new Date()): string {
  return new Date(date).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function isDebugLogEntry(value: unknown): value is DebugLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<DebugLogEntry>
  return typeof entry.ts === 'string' &&
    (entry.level === 'debug' || entry.level === 'info' || entry.level === 'warning' || entry.level === 'error') &&
    typeof entry.event === 'string' &&
    typeof entry.message === 'string'
}

export async function getAuth(): Promise<AuthState> {
  const { auth } = await getStorage()
  return auth
}

export async function saveAuth(auth: AuthState): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ auth }, cb))
}

export async function clearAuthSession(): Promise<void> {
  const { auth } = await getStorage()
  await saveAuth({ token: null, user: null, lastEmail: auth.lastEmail })
}

const PENDING_START_KEY = 'campOspreyPendingStartTripId'

export async function getPendingStartTripId(): Promise<string | null> {
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get([PENDING_START_KEY], cb)
  )
  const value = result[PENDING_START_KEY]
  return typeof value === 'string' && value ? value : null
}

export async function setPendingStartTripId(tripId: string | null): Promise<void> {
  if (!tripId) {
    await clearPendingStartTripId()
    return
  }
  await promisify<void>(cb => chrome.storage.local.set({ [PENDING_START_KEY]: tripId }, cb))
}

export async function clearPendingStartTripId(): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.remove(PENDING_START_KEY, cb))
}

export async function addDebugLog(entry: Omit<DebugLogEntry, 'ts'> & { ts?: string }): Promise<void> {
  const write = async () => {
    const { debugLog } = await getStorage()
    const existing = Array.isArray(debugLog) ? debugLog.filter(isDebugLogEntry) : []
    const structuredEntry: DebugLogEntry = {
      ...entry,
      ts: entry.ts ?? new Date().toISOString(),
    }
    const newLog = [...existing, structuredEntry].slice(-MAX_DEBUG_LOG_ENTRIES)
    await promisify<void>(cb => chrome.storage.local.set({ debugLog: newLog }, cb))
  }
  const result = debugLogWriteQueue.then(write, write)
  debugLogWriteQueue = result.catch(() => undefined)
  await result
}

export async function clearDebugLog(): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ debugLog: [] }, cb))
}

export async function updateTrip(tripId: string, updates: Partial<Trip>): Promise<void> {
  const { trips } = await getStorage()
  const idx = trips.findIndex(t => t.id === tripId)
  if (idx === -1) throw new Error(`Trip ${tripId} not found`)
  trips[idx] = { ...trips[idx], ...updates }
  await saveTrips(trips)
}
