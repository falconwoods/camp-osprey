import { validateAuth } from './auth'
import {
  clearPendingStartTripId as clearStoredPendingStartTripId,
  getPendingStartTripId as getStoredPendingStartTripId,
  setPendingStartTripId,
} from './storage'

const listeners = new Set<() => void>()

export function onAuthGateChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  listeners.forEach(listener => listener())
}

export function openOptionsAccount(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#account') })
}

export async function openAuthGateForTrip(tripId: string | null): Promise<void> {
  await setPendingStartTripId(tripId)
  emit()
  openOptionsAccount()
}

export async function getPendingStartTripId(): Promise<string | null> {
  return getStoredPendingStartTripId()
}

export async function clearPendingStartTripId(): Promise<void> {
  await clearStoredPendingStartTripId()
  emit()
}

export async function consumePendingStartTripId(): Promise<string | null> {
  const tripId = await getStoredPendingStartTripId()
  await clearPendingStartTripId()
  return tripId
}

export async function requireServerAuthForStart(tripId: string): Promise<boolean> {
  const ok = await validateAuth()
  if (ok) return true
  await openAuthGateForTrip(tripId)
  return false
}
