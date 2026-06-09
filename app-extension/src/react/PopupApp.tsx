import { Settings, Plus } from 'lucide-react'
import { useExtensionState } from './chromeState'
import { TripCard } from './TripCard'
import { pauseTrip, startTripNow } from './tripActions'
import { getGlobalWarnings } from '../warnings'
import { Button } from '../components/ui/button'
import { AppAlert } from '../components/AppAlert'
import type { Trip } from '../types'
import { ExtensionUpdateAlert } from './ExtensionUpdateAlert'

export function PopupApp() {
  const state = useExtensionState()

  async function start(trip: Trip) {
    const result = await startTripNow(trip.id)
    if (!result.ok && result.reason === 'extension_update_required') return
    if (!result.ok && result.reason === 'payment') chrome.runtime.openOptionsPage()
    await state.refresh()
  }

  async function pause(trip: Trip) {
    await pauseTrip(trip.id)
    await state.refresh()
  }

  if (state.loading || !state.storage) return <div className="popup-shell loading-view">Loading...</div>

  const warnings = getGlobalWarnings(state.trips, state.bcParksLoggedIn, state.storage.payment)

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="brand-row">
          <img src="/icons/icon48.png" alt="" />
          <div><strong>campsoon</strong><span>{state.auth?.user?.email ?? 'Sign in required'}</span></div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => chrome.runtime.openOptionsPage()} title="Settings"><Settings size={17} /></Button>
      </header>
      <main className="popup-content stack">
        <ExtensionUpdateAlert config={state.storage.extensionConfig} />
        {warnings.map((warning, index) => (
          <AppAlert
            key={index}
            variant={warning.level === 'error' ? 'error' : 'warning'}
            title={warning.title ?? 'Heads up'}
            message={warning.message}
            action={warning.action ? {
              label: warning.action.label,
              onClick: () => warning.action!.url.startsWith('#') ? chrome.runtime.openOptionsPage() : chrome.tabs.create({ url: warning.action!.url }),
            } : undefined}
          />
        ))}
        {state.trips.length ? state.trips.map(trip => (
          <TripCard key={trip.id} trip={trip} compact onStart={start} onPause={pause} />
        )) : (
          <div className="empty-state">
            <h2>No trips yet.</h2>
            <p className="muted">Add a trip to start scanning.</p>
          </div>
        )}
      </main>
      <footer className="popup-footer">
        <Button onClick={() => chrome.runtime.openOptionsPage()}><Plus size={16} /> Manage Trip</Button>
      </footer>
    </div>
  )
}
