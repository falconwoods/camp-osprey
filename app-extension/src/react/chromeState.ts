import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuth, getDebugLog, getStorage } from '../storage'
import { isLoggedIn } from '../background/login'
import { getTrips, TRIPS_CACHE_KEY } from '../tripStore'
import { applyTheme } from '../theme'
import type { AuthState, DebugLogEntry, StorageData, Trip } from '../types'

export interface ExtensionState {
  storage: StorageData | null
  auth: AuthState | null
  trips: Trip[]
  debugLog: DebugLogEntry[]
  bcParksLoggedIn: boolean
  loading: boolean
  tripsLoaded: boolean
}

export function useExtensionState(options: { syncTripsOnLoad?: boolean } = {}): ExtensionState & { refresh: (options?: { syncTrips?: boolean; includeTrips?: boolean }) => Promise<void> } {
  const hasLoadedRef = useRef(false)
  const tripsRef = useRef<Trip[]>([])
  const tripsLoadedRef = useRef(false)
  const [state, setState] = useState<ExtensionState>({
    storage: null,
    auth: null,
    trips: [],
    debugLog: [],
    bcParksLoggedIn: false,
    loading: true,
    tripsLoaded: false,
  })

  const refresh = useCallback(async (refreshOptions: { syncTrips?: boolean; includeTrips?: boolean } = {}) => {
    const syncTrips = refreshOptions.syncTrips ?? !hasLoadedRef.current
    const includeTrips = refreshOptions.includeTrips ?? true
    const loadTrips = async (): Promise<{ trips: Trip[]; loaded: boolean }> => {
      if (!includeTrips) return { trips: tripsRef.current, loaded: tripsLoadedRef.current }
      try {
        return { trips: await getTrips({ refresh: syncTrips }), loaded: true }
      } catch {
        return { trips: tripsRef.current, loaded: true }
      }
    }
    const [storage, auth, tripsResult, debugLog, bcParksLoggedIn] = await Promise.all([
      getStorage(),
      getAuth(),
      loadTrips(),
      getDebugLog().catch(() => []),
      isLoggedIn().catch(() => false),
    ])
    applyTheme(storage.settings.theme ?? 'auto')
    tripsRef.current = tripsResult.trips
    tripsLoadedRef.current = tripsResult.loaded
    setState({ storage, auth, trips: tripsResult.trips, debugLog, bcParksLoggedIn, loading: false, tripsLoaded: tripsLoadedRef.current })
    hasLoadedRef.current = true
  }, [])

  useEffect(() => {
    void refresh({ syncTrips: options.syncTripsOnLoad ?? true, includeTrips: options.syncTripsOnLoad ?? true })
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).every(key => key === TRIPS_CACHE_KEY)) return
      void refresh({ syncTrips: false, includeTrips: false })
    }
    const messageListener = (msg: { type?: string }) => {
      if (msg.type === 'TRIPS_CHANGED') void refresh({ syncTrips: false })
    }
    chrome.storage.onChanged.addListener(storageListener)
    chrome.runtime.onMessage.addListener(messageListener)
    return () => {
      chrome.storage.onChanged.removeListener(storageListener)
      chrome.runtime.onMessage.removeListener(messageListener)
    }
  }, [refresh])

  return { ...state, refresh }
}
