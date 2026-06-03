import { BCParksProvider } from '../../providers/bcparks'
import { getStorage } from '../../storage'
import { requireServerAuthForStart } from '../../startAuthGate'
import type { DateRange, Park, Trip } from '../../types'
import { escapeHtml } from '../settings/shared'
import { describeRange, matchSummaryHTML, recurringPreviewText, statusTextHTML } from './tripDisplay'
import { bindTripNameErrorReset, saveTripFromEditor } from './tripSave'

type TripEditorOptions = {
  deleteTripById: (tripId: string) => Promise<void>
  openAuthDialog: () => Promise<void>
  renderTripList: () => Promise<void>
  startTripNow: (tripId: string) => Promise<boolean>
  syncTripBestEffort: (trip: Trip) => void
}

export class TripEditor {
  private readonly provider = new BCParksProvider()
  private editingTripId: string | null = null
  private tripParks: Park[] = []
  private tripDates: DateRange[] = []
  private dateMode: 'specific' | 'recurring' = 'specific'
  private searchTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: TripEditorOptions) {}

  bind(): void {
    document.getElementById('back-btn')!.addEventListener('click', () => {
      document.getElementById('trip-editor')!.classList.add('hidden')
      document.getElementById('trips-view')!.classList.remove('hidden')
      void this.options.renderTripList()
    })

    document.getElementById('new-trip-btn')!.addEventListener('click', () => void this.open())
    this.bindParkSearch()
    this.bindDateControls()
    bindTripNameErrorReset()
    document.getElementById('save-trip-btn')!.addEventListener('click', () => void this.save())
    document.getElementById('delete-trip-btn')!.addEventListener('click', () => void this.deleteCurrentTrip())
  }

  async open(trip?: Trip): Promise<void> {
    this.editingTripId = trip?.id ?? null
    this.tripParks = trip ? [...trip.parks] : []
    this.tripDates = trip ? [...trip.dateRanges] : []

    let name = trip?.name ?? ''
    if (!trip) {
      const { trips } = await getStorage()
      name = `Trip ${trips.length + 1}`
    }
    ;(document.getElementById('trip-name') as HTMLInputElement).value = name
    ;(document.getElementById('trip-mode') as HTMLSelectElement).value = trip?.mode ?? 'hold'
    ;(document.getElementById('filter-walkin') as HTMLInputElement).checked = trip?.filters.noWalkin ?? true
    ;(document.getElementById('filter-double') as HTMLInputElement).checked = trip?.filters.noDouble ?? true
    document.getElementById('editor-trip-title')!.textContent = name

    const statusBar = document.getElementById('editor-status-bar')!
    const statusBadge = document.getElementById('editor-status-badge')!
    if (trip) {
      statusBar.classList.remove('hidden')
      statusBadge.innerHTML = statusTextHTML(trip.status)
      if (trip.lastMatch) {
        statusBadge.innerHTML += `&nbsp;&nbsp;<span style="color:#22c55e;font-size:11px">Match: ${matchSummaryHTML(trip.lastMatch)}</span>`
      }
    } else {
      statusBar.classList.add('hidden')
    }

    this.renderParksList()
    this.renderDatesList()

    const savedMode = localStorage.getItem(trip ? `datemode_${trip.id}` : 'datemode_new') as 'specific' | 'recurring' | null
    this.applyDateMode(savedMode ?? 'specific')

    document.getElementById('trips-view')!.classList.add('hidden')
    document.getElementById('trip-editor')!.classList.remove('hidden')
  }

  clearEditingTripIf(tripId: string): void {
    if (this.editingTripId === tripId) this.editingTripId = null
  }

  private applyDateMode(mode: 'specific' | 'recurring'): void {
    this.dateMode = mode
    document.querySelectorAll('.date-mode-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset['mode'] === mode)
    })
    document.getElementById('specific-inputs')!.classList.toggle('hidden', mode !== 'specific')
    document.getElementById('recurring-inputs')!.classList.toggle('hidden', mode !== 'recurring')
  }

  private renderParksList(): void {
    const list = document.getElementById('parks-list')!
    list.innerHTML = this.tripParks.map((park, i) => `
      <div class="chip">
        <span>⠿ &nbsp; ${i + 1}.&nbsp; ${escapeHtml(park.name)}</span>
        <button class="chip-remove" data-idx="${i}">✕</button>
      </div>`).join('')
    list.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        this.tripParks.splice(parseInt((btn as HTMLElement).dataset['idx']!), 1)
        this.renderParksList()
      })
    })
  }

  private bindParkSearch(): void {
    const parkSearch = document.getElementById('park-search') as HTMLInputElement
    const parkResults = document.getElementById('park-results')!
    parkSearch.addEventListener('input', () => {
      if (this.searchTimeout) clearTimeout(this.searchTimeout)
      this.searchTimeout = setTimeout(async () => {
        const query = parkSearch.value.trim()
        if (!query) { parkResults.style.display = 'none'; return }
        const parks = await this.provider.searchParks(query)
        parkResults.style.display = parks.length ? 'block' : 'none'
        parkResults.innerHTML = parks.slice(0, 8).map(park =>
          `<div class="search-result" data-id="${park.id}" data-name="${park.name}">${park.name}</div>`
        ).join('')
        parkResults.querySelectorAll('[data-id]').forEach(el => {
          el.addEventListener('click', () => {
            const id = (el as HTMLElement).dataset['id']!
            const name = (el as HTMLElement).dataset['name']!
            if (!this.tripParks.find(park => park.id === id)) {
              this.tripParks.push({ id, name })
              this.renderParksList()
            }
            parkSearch.value = ''
            parkResults.style.display = 'none'
          })
        })
      }, 250)
    })
  }

  private renderDatesList(): void {
    const list = document.getElementById('dates-list')!
    list.innerHTML = this.tripDates.map((dateRange, i) => `
      <div class="chip">
        <span>${escapeHtml(describeRange(dateRange))}</span>
        <button class="chip-remove" data-idx="${i}">✕</button>
      </div>`).join('')
    list.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tripDates.splice(parseInt((btn as HTMLElement).dataset['idx']!), 1)
        this.renderDatesList()
      })
    })
  }

  private bindDateControls(): void {
    document.querySelectorAll('.date-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dateMode = (btn as HTMLElement).dataset['mode'] as 'specific' | 'recurring'
        document.querySelectorAll('.date-mode-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        document.getElementById('specific-inputs')!.classList.toggle('hidden', this.dateMode !== 'specific')
        document.getElementById('recurring-inputs')!.classList.toggle('hidden', this.dateMode !== 'recurring')
        const key = this.editingTripId ? `datemode_${this.editingTripId}` : 'datemode_new'
        localStorage.setItem(key, this.dateMode)
      })
    })

    this.initFlexibleDefaults()
    document.getElementById('rec-start-day')!.addEventListener('change', () => this.updateEndDayOptions())
    ;['rec-end-day', 'rec-month', 'rec-year'].forEach(id => {
      document.getElementById(id)!.addEventListener('change', () => this.updateRecurringPreview())
    })
    this.updateEndDayOptions()

    document.getElementById('add-date-btn')!.addEventListener('click', () => {
      if (this.dateMode === 'specific') {
        const checkIn = (document.getElementById('date-checkin') as HTMLInputElement).value
        const checkOut = (document.getElementById('date-checkout') as HTMLInputElement).value
        if (!checkIn || !checkOut) return
        this.tripDates.push({ type: 'specific', checkIn, checkOut })
      } else {
        this.tripDates.push({
          type: 'recurring',
          year: parseInt((document.getElementById('rec-year') as HTMLSelectElement).value),
          month: parseInt((document.getElementById('rec-month') as HTMLSelectElement).value),
          startDay: parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value),
          endDay: parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value),
        })
      }
      this.renderDatesList()
    })
  }

  private updateRecurringPreview(): void {
    const range: Extract<DateRange, { type: 'recurring' }> = {
      type: 'recurring',
      year: parseInt((document.getElementById('rec-year') as HTMLSelectElement).value),
      month: parseInt((document.getElementById('rec-month') as HTMLSelectElement).value),
      startDay: parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value),
      endDay: parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value),
    }
    document.getElementById('rec-preview')!.textContent = recurringPreviewText(range)
  }

  private initFlexibleDefaults(): void {
    const now = new Date()
    const currentYear = now.getFullYear()
    const yearSelect = document.getElementById('rec-year') as HTMLSelectElement
    yearSelect.innerHTML = [currentYear, currentYear + 1, currentYear + 2]
      .map(year => `<option value="${year}">${year}</option>`).join('')
    yearSelect.value = String(currentYear)
    ;(document.getElementById('rec-month') as HTMLSelectElement).value = String(now.getMonth() + 1)
  }

  private updateEndDayOptions(): void {
    const fullDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
    const endSelect = document.getElementById('rec-end-day') as HTMLSelectElement
    const prevEnd = parseInt(endSelect.value)
    endSelect.innerHTML = fullDayNames
      .map((name, i) => i > startDay ? `<option value="${i}">${name}</option>` : null)
      .filter(Boolean)
      .join('')
    endSelect.value = prevEnd > startDay ? String(prevEnd) : String(startDay + 1)
    this.updateRecurringPreview()
  }

  private async save(): Promise<void> {
    const result = await saveTripFromEditor({
      editingTripId: this.editingTripId,
      tripParks: this.tripParks,
      tripDates: this.tripDates,
    })
    if (!result) return

    if (!(await requireServerAuthForStart(result.savedTripId, false))) {
      document.getElementById('back-btn')!.click()
      await this.options.openAuthDialog()
      return
    }

    if (result.savedTrip) this.options.syncTripBestEffort(result.savedTrip)
    if (!(await this.options.startTripNow(result.savedTripId))) return
    document.getElementById('back-btn')!.click()
  }

  private async deleteCurrentTrip(): Promise<void> {
    if (!this.editingTripId) return
    const deletedTripId = this.editingTripId
    await this.options.deleteTripById(deletedTripId)
    if (this.editingTripId !== deletedTripId) document.getElementById('back-btn')!.click()
  }
}
