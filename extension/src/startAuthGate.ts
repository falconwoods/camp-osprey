import { validateAuth } from './auth'

let pendingStartTripId: string | null = null
const listeners = new Set<() => void>()

export function onAuthGateChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  listeners.forEach(listener => listener())
}

export function openAuthGateForTrip(tripId: string | null): void {
  pendingStartTripId = tripId
  emit()
}

export function consumePendingStartTripId(): string | null {
  const tripId = pendingStartTripId
  pendingStartTripId = null
  emit()
  return tripId
}

export async function requireServerAuthForStart(tripId: string): Promise<boolean> {
  const ok = await validateAuth()
  if (ok) return true
  openAuthGateForTrip(tripId)
  return false
}
