import { Settings, Plus } from 'lucide-react'
import { useExtensionState } from './chromeState'
import { TripCard } from './TripCard'
import { pauseTrip, startTripNow } from './tripActions'
import { getGlobalWarnings } from '../warnings'
import { getExtensionUpdateUrl } from '../extensionConfig'
import { Button } from '../components/ui/button'
import { AppAlert } from '../components/AppAlert'
import { useConfirmDialog } from '../components/ConfirmDialog'
import type { Trip } from '../types'
import { APP_CONFIG } from '../config'
import { ExtensionUpdateAlert, OptionalUpdateDetails, RequiredUpdateDetails } from './ExtensionUpdateAlert'

export function PopupApp() {
  const state = useExtensionState()
  const confirmation = useConfirmDialog()
  const bookingPointCostLabel = APP_CONFIG.points.successfulBookingPointCost.toLocaleString()

  async function start(trip: Trip) {
    const result = await startTripNow(trip.id)
    if (!result.ok && result.reason === 'extension_update_required') {
      await promptForExtensionUpdate()
      return
    }
    if (!result.ok && result.reason === 'active_trip') {
      const maxActiveTrips = state.storage?.extensionConfig?.userLimits?.maxActiveTrips ?? 5
      await confirmation.confirm({
        title: 'Active trip limit reached',
        message: maxActiveTrips === 1
          ? 'Pause your current active trip before starting another one.'
          : `You can run up to ${maxActiveTrips} active trips at the same time. Pause one to start another.`,
        confirmLabel: 'OK',
        cancelLabel: null,
      })
    }
    if (!result.ok && result.reason === 'payment') {
      const confirmed = await confirmation.confirm({
        title: 'Auto-pay requires Park Payment',
        message: 'Add your Park Payment details before starting an Auto-pay trip.',
        confirmLabel: 'Set up Park Payment',
      })
      if (confirmed) chrome.tabs.create({ url: chrome.runtime.getURL('options.html#payment') })
    }
    if (!result.ok && result.reason === 'points') {
      const bookingPointCostLabel = result.points?.requiredPoints.toLocaleString() ?? APP_CONFIG.points.successfulBookingPointCost.toLocaleString()
      const pointsMessage = result.points
        ? (
          <>
            <p>You currently have {result.points.activeBookingTripCount} active booking Trips, using {result.points.occupiedPoints.toLocaleString()} points of your {result.points.balance.toLocaleString()} available points.</p>
            <p>Starting this Trip requires another {bookingPointCostLabel} points.</p>
            <p>Stop an active booking Trip or add more points to start this one.</p>
          </>
        )
        : (
          <>
            <p>Each active booking Trip needs {bookingPointCostLabel} available points. Your points are only charged after a successful booking.</p>
            <p>Stop another active Trip or add points to start this one.</p>
          </>
        )
      const confirmed = await confirmation.confirm({
        title: 'More points needed to start this Trip',
        message: pointsMessage,
        confirmLabel: 'Add points',
      })
      if (confirmed) chrome.tabs.create({ url: chrome.runtime.getURL('options.html#account') })
    }
    await state.refresh()
  }

  async function promptForExtensionUpdate() {
    const config = state.storage?.extensionConfig ?? null
    const confirmed = await confirmation.confirm({
      title: 'Update required',
      message: <RequiredUpdateDetails config={config} />,
      confirmLabel: 'Download update',
      cancelLabel: 'Close',
    })
    if (confirmed) chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
  }

  async function promptForOptionalExtensionUpdate() {
    const config = state.storage?.extensionConfig ?? null
    const confirmed = await confirmation.confirm({
      title: config?.releaseNote?.title ?? 'Update available',
      message: <OptionalUpdateDetails config={config} />,
      confirmLabel: 'Download update',
      cancelLabel: 'Close',
    })
    if (confirmed) chrome.tabs.create({ url: getExtensionUpdateUrl(config) })
  }

  async function pause(trip: Trip) {
    await pauseTrip(trip.id)
    await state.refresh()
  }

  if (state.loading || !state.storage) return <div className="popup-shell loading-view">Loading...</div>

  const warnings = getGlobalWarnings(state.trips, state.providerLoggedIn, state.storage.payment)

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="brand-row">
          <img src="/icons/icon128.png" alt="" />
          <div><strong>campsoon</strong><span>{state.auth?.user?.email ?? 'Sign in required'}</span></div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => chrome.runtime.openOptionsPage()} title="Settings"><Settings size={17} /></Button>
      </header>
      <main className="popup-content stack">
        <ExtensionUpdateAlert
          config={state.storage.extensionConfig}
          onRequiredUpdate={promptForExtensionUpdate}
          onOptionalUpdate={promptForOptionalExtensionUpdate}
        />
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
          <TripCard key={trip.id} trip={trip} compact onStart={start} onPause={pause} bookingWindowWarnings={state.bookingWindowWarnings[trip.id]} />
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
      {confirmation.dialog}
    </div>
  )
}
