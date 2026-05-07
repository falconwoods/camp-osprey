import type { StorageData, Trip, PaymentConfig, Settings } from './types'

const DEFAULTS: StorageData = {
  trips: [],
  payment: null,
  settings: { pollIntervalSeconds: 60 },
}

function promisify<T>(fn: (callback: (result: T) => void) => void): Promise<T> {
  return new Promise(resolve => fn(resolve))
}

export async function getStorage(): Promise<StorageData> {
  const keys = Object.keys(DEFAULTS)
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get(keys, cb)
  )
  return { ...DEFAULTS, ...result } as StorageData
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

export async function updateTrip(tripId: string, updates: Partial<Trip>): Promise<void> {
  const { trips } = await getStorage()
  const idx = trips.findIndex(t => t.id === tripId)
  if (idx === -1) throw new Error(`Trip ${tripId} not found`)
  trips[idx] = { ...trips[idx], ...updates }
  await saveTrips(trips)
}
