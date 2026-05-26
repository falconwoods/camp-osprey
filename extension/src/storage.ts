import type { AuthState, StorageData, Trip, PaymentConfig, Settings } from './types'

const MAX_DEBUG_LOG_ENTRIES = 500
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

export async function addDebugLog(entry: string): Promise<void> {
  const write = async () => {
    const { debugLog } = await getStorage()
    const timestamp = new Date().toLocaleTimeString()
    const newLog = [...debugLog, `${timestamp} — ${entry}`].slice(-MAX_DEBUG_LOG_ENTRIES)
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
