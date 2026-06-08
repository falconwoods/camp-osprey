import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuth, getDebugLog, getStorage } from '../storage'
import { isLoggedIn } from '../background/login'
import { getTrips } from '../tripStore'
import { applyTheme } from '../theme'
import type { AuthState, DebugLogEntry, StorageData, Trip } from '../types'

export interface ExtensionState {
  storage: StorageData | null
  auth: AuthState | null
  trips: Trip[]
  debugLog: DebugLogEntry[]
  bcParksLoggedIn: boolean
  loading: boolean
}

export function useExtensionState(): ExtensionState & { refresh: () => Promise<void> } {
  const hasLoadedRef = useRef(false)
  const [state, setState] = useState<ExtensionState>({
    storage: null,
    auth: null,
    trips: [],
    debugLog: [],
    bcParksLoggedIn: false,
    loading: true,
  })

  const refresh = useCallback(async (options: { syncTrips?: boolean } = {}) => {
    const syncTrips = options.syncTrips ?? !hasLoadedRef.current
    const [storage, auth, trips, debugLog, bcParksLoggedIn] = await Promise.all([
      getStorage(),
      getAuth(),
      getTrips({ refresh: syncTrips }).catch(() => []),
      getDebugLog().catch(() => []),
      isLoggedIn().catch(() => false),
    ])
    applyTheme(storage.settings.theme ?? 'auto')
    setState({ storage, auth, trips, debugLog, bcParksLoggedIn, loading: false })
    hasLoadedRef.current = true
  }, [])

  useEffect(() => {
    void refresh({ syncTrips: true })
    const storageListener = () => void refresh({ syncTrips: false })
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
