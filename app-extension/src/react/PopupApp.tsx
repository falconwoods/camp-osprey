import { Settings, Plus } from 'lucide-react'
import { useExtensionState } from './chromeState'
import { TripCard } from './TripCard'
import { pauseTrip, startTripNow } from './tripActions'
import { getGlobalWarnings } from '../warnings'
import { Button } from '../components/ui/button'
import type { Trip } from '../types'

export function PopupApp() {
  const state = useExtensionState()

  async function start(trip: Trip) {
    const result = await startTripNow(trip.id)
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
        {warnings.map((warning, index) => (
          <div className={`alert-inline ${warning.level}`} key={index}>
            <div><strong>{warning.title ?? 'Heads up'}</strong><span>{warning.message}</span></div>
            {warning.action ? (
              <Button size="sm" variant="secondary" onClick={() => warning.action!.url.startsWith('#') ? chrome.runtime.openOptionsPage() : chrome.tabs.create({ url: warning.action!.url })}>
                {warning.action.label}
              </Button>
            ) : null}
          </div>
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
