import { isLoggedIn } from '../../background/login'
import { getStorage, saveTrips, updateTrip } from '../../storage'
import { requireServerAuthForStart } from '../../startAuthGate'
import { softDeleteTripOnServer, syncTripToServer } from '../../serverApi'
import { getGlobalWarnings, getTripWarnings, renderWarnings } from '../../warnings'
import type { Trip } from '../../types'
import { TripEditor } from './tripEditor'
import { tripListItemHTML } from './tripDisplay'

type TripsPageOptions = {
  openAuthDialog: () => Promise<void>
  renderHeaderAccount: () => Promise<void>
}

export class TripsPage {
  private readonly editor: TripEditor

  constructor(private readonly options: TripsPageOptions) {
    this.editor = new TripEditor({
      deleteTripById: tripId => this.deleteTripById(tripId),
      openAuthDialog: () => this.options.openAuthDialog(),
      renderTripList: () => this.renderList(),
      startTripNow: tripId => this.startTripNow(tripId),
      syncTripBestEffort: trip => void this.syncTripBestEffort(trip),
    })
  }

  bind(): void {
    this.editor.bind()
  }

  async renderList(): Promise<void> {
    const { trips, auth } = await getStorage()
    const loggedIn = await isLoggedIn()
    await this.options.renderHeaderAccount()

    const globalAlertsEl = document.getElementById('global-alerts')
    if (globalAlertsEl) {
      globalAlertsEl.innerHTML = renderWarnings(getGlobalWarnings(trips, loggedIn))
    }

    const list = document.getElementById('trip-list')!
    if (trips.length === 0) {
      list.innerHTML = '<p style="color:#64748b;font-size:12px;padding:8px 0">No trips yet.</p>'
      return
    }

    list.innerHTML = trips
      .map(trip => tripListItemHTML(trip, renderWarnings(getTripWarnings(trip))))
      .join('')

    list.querySelectorAll('[data-trip-card-id]').forEach(card => {
      card.addEventListener('click', e => {
        const target = e.target as HTMLElement
        if (target.closest('button, a, input, select, textarea, label')) return
        const trip = trips.find(t => t.id === (card as HTMLElement).dataset['tripCardId'])
        if (trip) void this.editor.open(trip)
      })
    })

    list.querySelectorAll('[data-edit-trip]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const trip = trips.find(t => t.id === (btn as HTMLElement).dataset['id'])
        if (trip) void this.editor.open(trip)
      })
    })

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = (btn as HTMLElement).dataset['id']!
        const action = (btn as HTMLElement).dataset['action']!

        if (action === 'start') {
          if (!(await requireServerAuthForStart(id, false))) {
            await this.options.openAuthDialog()
            return
          }
          await this.startTripNow(id)
        } else {
          await updateTrip(id, { status: 'paused' })
          const { trips: updatedTrips } = await getStorage()
          const updatedTrip = updatedTrips.find(t => t.id === id)
          if (updatedTrip) void this.syncTripBestEffort(updatedTrip)
          chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: id })
          chrome.storage.local.remove('campOspreyTarget')
        }
        await this.renderList()
      })
    })

    list.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = (btn as HTMLElement).dataset['id']!
        await this.deleteTripById(id)
      })
    })
  }

  async deleteTripById(id: string): Promise<void> {
    const { trips } = await getStorage()
    const trip = trips.find(t => t.id === id)
    const label = trip?.name ? `"${trip.name}"` : 'this trip'
    if (!trip || !confirm(`Delete ${label}?`)) return
    void softDeleteTripOnServer({ ...trip, deletedAt: Date.now(), updatedAt: Date.now() }).catch(err => {
      console.warn('Trip delete sync failed:', err)
    })
    await saveTrips(trips.filter(t => t.id !== id))
    this.editor.clearEditingTripIf(id)
    await this.renderList()
  }

  async startTripNow(id: string): Promise<boolean> {
    const { trips } = await getStorage()
    const trip = trips.find(t => t.id === id)
    if (trip && trip.mode !== 'notify' && !(await isLoggedIn())) {
      this.promptLogin()
      return false
    }
    chrome.storage.local.remove('campOspreyTarget')
    await updateTrip(id, { status: 'scanning', lastMatch: null, attempted: [] })
    const { trips: updatedTrips } = await getStorage()
    const updatedTrip = updatedTrips.find(t => t.id === id)
    if (updatedTrip) void this.syncTripBestEffort(updatedTrip)
    chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: id, resetActiveMatch: true })
    return true
  }

  private promptLogin(): void {
    const alertsEl = document.getElementById('global-alerts')
    if (alertsEl) {
      alertsEl.innerHTML = `<div class="alert-warn alert-has-action">
        <span class="alert-icon" aria-hidden="true">!</span>
        <span class="alert-copy">
          <strong>BC Parks sign-in needed</strong>
          <span>Not logged in to BC Parks. Hold and Auto-pay modes require a BC Parks account.</span>
        </span>
        <a class="alert-action" href="https://camping.bcparks.ca/login" target="_blank">Log in →</a>
      </div>`
    }
    chrome.tabs.create({ url: 'https://camping.bcparks.ca/login' })
  }

  private async syncTripBestEffort(trip: Trip): Promise<void> {
    try {
      await syncTripToServer(trip)
    } catch (err) {
      console.warn('Trip sync failed:', err)
    }
  }
}
