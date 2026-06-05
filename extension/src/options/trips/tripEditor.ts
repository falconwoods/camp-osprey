import { BCParksProvider } from '../../providers/bcparks'
import { bindAsyncButton } from '../../shared/components/button'
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

function dateRangesEqual(a: DateRange, b: DateRange): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'specific') return a.checkIn === b.checkIn && a.checkOut === b.checkOut
  return a.year === b.year && a.month === b.month && a.startDay === b.startDay && a.endDay === b.endDay
}

export class TripEditor {
  private readonly provider = new BCParksProvider()
  private editingTripId: string | null = null
  private tripParks: Park[] = []
  private tripDates: DateRange[] = []
  private dateMode: 'specific' | 'recurring' = 'specific'
  private searchTimeout: ReturnType<typeof setTimeout> | null = null
  private draggedParkIndex: number | null = null

  constructor(private readonly options: TripEditorOptions) {}

  bind(): void {
    document.getElementById('back-btn')!.addEventListener('click', () => {
      document.getElementById('trip-editor')!.classList.add('hidden')
      document.getElementById('trips-view')!.classList.remove('hidden')
      document.body.classList.remove('trip-editor-open')
      void this.options.renderTripList()
    })

    document.getElementById('new-trip-btn')!.addEventListener('click', () => void this.open())
    document.getElementById('new-trip-header-btn')?.addEventListener('click', () => void this.open())
    this.bindParkSearch()
    this.bindDateControls()
    bindTripNameErrorReset()
    bindAsyncButton(document.getElementById('save-trip-btn') as HTMLButtonElement, 'Saving...', () => this.saveOnly())
    bindAsyncButton(document.getElementById('start-trip-btn') as HTMLButtonElement, 'Starting...', () => this.saveAndStart())
    document.getElementById('delete-trip-btn')!.addEventListener('click', () => void this.deleteCurrentTrip())
    document.getElementById('trip-mode')?.addEventListener('change', () => this.updateModeHelp())
    document.getElementById('trip-mode-help')?.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest('[data-open-payment-settings]')
      if (!target) return
      event.preventDefault()
      this.openPaymentSettings()
    })
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
    this.updateModeHelp()
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
    document.body.classList.add('trip-editor-open')
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

  private updateModeHelp(): void {
    const modeSelect = document.getElementById('trip-mode') as HTMLSelectElement | null
    const help = document.getElementById('trip-mode-help')
    if (!modeSelect || !help) return

    help.classList.remove('mode-help-warning')
    modeSelect.classList.remove('invalid')

    const mode = modeSelect.value as Trip['mode']
    const copy: Record<Trip['mode'], { label: string; details: [string, string] }> = {
      notify: {
        label: 'Notify-only',
        details: [
          'Sends a notification when a matching site is found.',
          'Free: no points are deducted.',
        ],
      },
      hold: {
        label: 'Auto-reserve',
        details: [
          'Holds a matching reservation for you to complete payment manually.',
          '500 points are deducted only after you successfully pay the held reservation.',
        ],
      },
      autopay: {
        label: 'Auto-pay',
        details: [
          'Holds the reservation and completes payment automatically.',
          '500 points are deducted only after reservation and payment both succeed.',
        ],
      },
    }
    const content = copy[mode] ?? copy.hold
    const paymentSetup = mode === 'autopay'
      ? `<div class="mode-help-action"><span>Auto-pay requires payment info in Settings &gt; Park Payment.</span><button type="button" data-open-payment-settings>Set up Park Payment</button></div>`
      : ''
    help.innerHTML = `<strong>${content.label}</strong><ul><li>${content.details[0]}</li><li>${content.details[1]}</li></ul>${paymentSetup}`
  }

  private openPaymentSettings(): void {
    document.getElementById('trip-editor')?.classList.add('hidden')
    document.getElementById('trips-view')?.classList.remove('hidden')
    document.body.classList.remove('trip-editor-open')

    const paymentTab = document.querySelector<HTMLElement>('.settings-nav-item[data-tab="payment"]')
    if (paymentTab) {
      paymentTab.click()
      return
    }
    location.hash = 'payment'
  }

  private renderParksList(): void {
    const list = document.getElementById('parks-list')!
    list.innerHTML = this.tripParks.map((park, i) => `
      <div class="chip park-chip" draggable="true" data-idx="${i}">
        <span class="park-drag-handle" aria-hidden="true">⠿</span>
        <span class="park-priority">${i + 1}.</span>
        <span class="park-name">${escapeHtml(park.name)}</span>
        <button class="chip-remove" data-idx="${i}" type="button" aria-label="Remove ${escapeHtml(park.name)}">✕</button>
      </div>`).join('')

    list.querySelectorAll<HTMLElement>('.park-chip').forEach(chip => {
      chip.addEventListener('dragstart', event => {
        this.draggedParkIndex = parseInt(chip.dataset['idx']!)
        chip.classList.add('dragging')
        event.dataTransfer?.setData('text/plain', chip.dataset['idx']!)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      })
      chip.addEventListener('dragover', event => {
        event.preventDefault()
        const targetIndex = parseInt(chip.dataset['idx']!)
        chip.classList.toggle('drag-over', this.draggedParkIndex !== null && this.draggedParkIndex !== targetIndex)
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      })
      chip.addEventListener('dragleave', () => {
        chip.classList.remove('drag-over')
      })
      chip.addEventListener('drop', event => {
        event.preventDefault()
        const from = this.draggedParkIndex
        const to = parseInt(chip.dataset['idx']!)
        this.draggedParkIndex = null
        if (from === null || from === to) {
          this.renderParksList()
          return
        }
        const [park] = this.tripParks.splice(from, 1)
        this.tripParks.splice(to, 0, park)
        this.renderParksList()
      })
      chip.addEventListener('dragend', () => {
        this.draggedParkIndex = null
        this.renderParksList()
      })
    })

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
    const addParkButton = document.getElementById('park-add-btn') as HTMLButtonElement
    const addPark = (park: Park): void => {
      if (!this.tripParks.find(existing => existing.id === park.id)) {
        this.tripParks.push(park)
        this.renderParksList()
      }
      parkSearch.value = ''
      parkResults.style.display = 'none'
    }
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
            addPark({ id, name })
          })
        })
      }, 250)
    })
    addParkButton.addEventListener('click', async () => {
      const query = parkSearch.value.trim()
      if (!query) {
        parkSearch.focus()
        return
      }
      const parks = await this.provider.searchParks(query)
      const exactMatch = parks.find(park => park.name.toLowerCase() === query.toLowerCase())
      const park = exactMatch ?? parks[0]
      if (!park) return
      addPark(park)
    })
  }

  private renderDatesList(): void {
    const list = document.getElementById('dates-list')!
    list.innerHTML = this.tripDates.map((dateRange, i) => `
      <div class="range-summary">
        <span>${escapeHtml(describeRange(dateRange))}</span>
        <button class="chip-remove" data-idx="${i}" type="button" aria-label="Remove date range">✕</button>
      </div>`).join('')
    list.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tripDates.splice(parseInt((btn as HTMLElement).dataset['idx']!), 1)
        this.renderDatesList()
      })
    })
  }

  private addDateRange(range: DateRange): void {
    const error = document.getElementById('error-dates')!
    if (this.tripDates.some(existing => dateRangesEqual(existing, range))) {
      error.textContent = 'Date range already added.'
      error.classList.add('show')
      document.getElementById('section-dates')?.classList.add('section-invalid')
      return
    }

    error.textContent = ''
    error.classList.remove('show')
    document.getElementById('section-dates')?.classList.remove('section-invalid')
    this.tripDates.push(range)
    this.renderDatesList()
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
        this.addDateRange({ type: 'specific', checkIn, checkOut })
      } else {
        this.addDateRange({
          type: 'recurring',
          year: parseInt((document.getElementById('rec-year') as HTMLSelectElement).value),
          month: parseInt((document.getElementById('rec-month') as HTMLSelectElement).value),
          startDay: parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value),
          endDay: parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value),
        })
      }
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

  private async saveOnly(): Promise<void> {
    const result = await saveTripFromEditor({
      editingTripId: this.editingTripId,
      tripParks: this.tripParks,
      tripDates: this.tripDates,
      requireAutoPayPayment: false,
    })
    if (!result) return
    if (result.savedTrip) this.options.syncTripBestEffort(result.savedTrip)
    document.getElementById('back-btn')!.click()
  }

  private async saveAndStart(): Promise<void> {
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
