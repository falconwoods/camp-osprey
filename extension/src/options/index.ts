import { getStorage, saveTrips, savePayment, saveSettings } from '../storage'
import { BCParksProvider } from '../providers/bcparks'
import { expandDateRange } from '../dates'
import type { Trip, DateRange, Park } from '../types'

const provider = new BCParksProvider()
let editingTripId: string | null = null
let tripParks: Park[] = []
let tripDates: DateRange[] = []
let dateMode: 'specific' | 'recurring' = 'specific'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function upcomingWindows(range: DateRange) {
  const today = todayISO()
  return expandDateRange(range).filter(w => w.checkIn >= today)
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    const name = (tab as HTMLElement).dataset['tab']!
    document.getElementById('tab-trips')!.classList.toggle('hidden', name !== 'trips')
    document.getElementById('tab-payment')!.classList.toggle('hidden', name !== 'payment')
    document.getElementById('tab-settings')!.classList.toggle('hidden', name !== 'settings')
  })
})

// Trip list
async function renderTripList() {
  const { trips } = await getStorage()
  const list = document.getElementById('trip-list')!
  list.innerHTML = trips.length === 0
    ? '<p style="color:#64748b;font-size:12px;padding:8px 0">No trips yet.</p>'
    : trips.map(t => `
      <div class="trip-list-item" data-id="${t.id}">
        <div>
          <div style="font-weight:600">${t.name}</div>
          <div style="color:#64748b;font-size:11px">${t.parks.map(p => p.name).join(', ') || '—'} · ${t.status}</div>
        </div>
        <span style="color:#64748b">›</span>
      </div>`).join('')

  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const trip = trips.find(t => t.id === (el as HTMLElement).dataset['id'])
      if (trip) openEditor(trip)
    })
  })
}

function openEditor(trip?: Trip) {
  editingTripId = trip?.id ?? null
  tripParks = trip ? [...trip.parks] : []
  tripDates = trip ? [...trip.dateRanges] : []

  ;(document.getElementById('trip-name') as HTMLInputElement).value = trip?.name ?? ''
  ;(document.getElementById('trip-mode') as HTMLSelectElement).value = trip?.mode ?? 'notify'
  ;(document.getElementById('filter-walkin') as HTMLInputElement).checked = trip?.filters.noWalkin ?? false
  ;(document.getElementById('filter-double') as HTMLInputElement).checked = trip?.filters.noDouble ?? false

  renderParksList()
  renderDatesList()
  document.getElementById('trips-view')!.classList.add('hidden')
  document.getElementById('trip-editor')!.classList.remove('hidden')
}

document.getElementById('back-btn')!.addEventListener('click', () => {
  document.getElementById('trip-editor')!.classList.add('hidden')
  document.getElementById('trips-view')!.classList.remove('hidden')
  renderTripList()
})

document.getElementById('new-trip-btn')!.addEventListener('click', () => openEditor())

// Parks
function renderParksList() {
  const list = document.getElementById('parks-list')!
  list.innerHTML = tripParks.map((p, i) => `
    <div class="chip">
      <span>⠿ ${i + 1}. ${p.name}</span>
      <button class="chip-remove" data-idx="${i}">✕</button>
    </div>`).join('')

  list.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = parseInt((btn as HTMLElement).dataset['idx']!)
      tripParks.splice(idx, 1)
      renderParksList()
    })
  })
}

let searchTimeout: ReturnType<typeof setTimeout>
const parkSearch = document.getElementById('park-search') as HTMLInputElement
const parkResults = document.getElementById('park-results')!

parkSearch.addEventListener('input', () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(async () => {
    const query = parkSearch.value.trim()
    if (!query) { parkResults.style.display = 'none'; return }
    const parks = await provider.searchParks(query)
    parkResults.style.display = parks.length ? 'block' : 'none'
    parkResults.innerHTML = parks.slice(0, 8).map(p =>
      `<div class="search-result" data-id="${p.id}" data-name="${p.name}">${p.name}</div>`
    ).join('')
    parkResults.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset['id']!
        const name = (el as HTMLElement).dataset['name']!
        if (!tripParks.find(p => p.id === id)) {
          tripParks.push({ id, name })
          renderParksList()
        }
        parkSearch.value = ''
        parkResults.style.display = 'none'
      })
    })
  }, 250)
})

// Dates
function describeRange(r: DateRange): string {
  if (r.type === 'specific') return `${r.checkIn} → ${r.checkOut}`
  const upcoming = upcomingWindows(r)
  const total = expandDateRange(r).length
  const pastCount = total - upcoming.length
  const suffix = pastCount > 0 ? ` · ${upcoming.length} upcoming` : ` · ${upcoming.length} stays`
  return `Any ${DAY_NAMES[r.startDay]}–${DAY_NAMES[r.endDay]} · ${MONTH_NAMES[r.month]} ${r.year}${suffix}`
}

function renderDatesList() {
  const list = document.getElementById('dates-list')!
  list.innerHTML = tripDates.map((d, i) => `
    <div class="chip">
      <span>${describeRange(d)}</span>
      <button class="chip-remove" data-idx="${i}">✕</button>
    </div>`).join('')
  list.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset['idx']!)
      tripDates.splice(idx, 1)
      renderDatesList()
    })
  })
}

// Date mode toggle
document.querySelectorAll('.date-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    dateMode = (btn as HTMLElement).dataset['mode'] as 'specific' | 'recurring'
    document.querySelectorAll('.date-mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('specific-inputs')!.classList.toggle('hidden', dateMode !== 'specific')
    document.getElementById('recurring-inputs')!.classList.toggle('hidden', dateMode !== 'recurring')
  })
})

function updateRecurringPreview() {
  const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
  const endDay = parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value)
  const month = parseInt((document.getElementById('rec-month') as HTMLSelectElement).value)
  const year = parseInt((document.getElementById('rec-year') as HTMLSelectElement).value)
  const range: DateRange = { type: 'recurring', year, month, startDay, endDay }
  const upcoming = upcomingWindows(range)
  const total = expandDateRange(range).length
  const pastNote = total > upcoming.length ? ` (${total - upcoming.length} past, skipped)` : ''
  if (upcoming.length === 0) {
    document.getElementById('rec-preview')!.textContent = `→ No upcoming dates in this month`
    return
  }
  document.getElementById('rec-preview')!.textContent =
    `→ Scanner will try any of ${upcoming.length} ${DAY_NAMES[startDay]}–${DAY_NAMES[endDay]} stays in ${MONTH_NAMES[month]}${pastNote}`
}

;['rec-start-day', 'rec-end-day', 'rec-month', 'rec-year'].forEach(id => {
  document.getElementById(id)!.addEventListener('change', updateRecurringPreview)
})
updateRecurringPreview()

document.getElementById('add-date-btn')!.addEventListener('click', () => {
  if (dateMode === 'specific') {
    const checkIn = (document.getElementById('date-checkin') as HTMLInputElement).value
    const checkOut = (document.getElementById('date-checkout') as HTMLInputElement).value
    if (!checkIn || !checkOut) return
    tripDates.push({ type: 'specific', checkIn, checkOut })
  } else {
    const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
    const endDay = parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value)
    const month = parseInt((document.getElementById('rec-month') as HTMLSelectElement).value)
    const year = parseInt((document.getElementById('rec-year') as HTMLSelectElement).value)
    tripDates.push({ type: 'recurring', year, month, startDay, endDay })
  }
  renderDatesList()
})

// Save trip
document.getElementById('save-trip-btn')!.addEventListener('click', async () => {
  const name = (document.getElementById('trip-name') as HTMLInputElement).value.trim()
  if (!name) { alert('Trip name is required.'); return }
  const mode = (document.getElementById('trip-mode') as HTMLSelectElement).value as Trip['mode']
  const noWalkin = (document.getElementById('filter-walkin') as HTMLInputElement).checked
  const noDouble = (document.getElementById('filter-double') as HTMLInputElement).checked

  const { trips } = await getStorage()
  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId)
    if (idx !== -1) {
      trips[idx] = { ...trips[idx], name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'scanning' }
    }
  } else {
    trips.push({
      id: crypto.randomUUID(), name, parks: tripParks, dateRanges: tripDates,
      mode, filters: { noWalkin, noDouble }, status: 'scanning',
      lastMatch: null, attempted: [], createdAt: Date.now(),
    })
  }
  await saveTrips(trips)
  document.getElementById('back-btn')!.click()
})

document.getElementById('delete-trip-btn')!.addEventListener('click', async () => {
  if (!editingTripId || !confirm('Delete this trip?')) return
  const { trips } = await getStorage()
  await saveTrips(trips.filter(t => t.id !== editingTripId))
  document.getElementById('back-btn')!.click()
})

// Payment form
async function loadPaymentForm() {
  const { payment } = await getStorage()
  if (!payment) return
  ;(document.getElementById('card-number') as HTMLInputElement).value = payment.cardNumber
  ;(document.getElementById('card-holder') as HTMLInputElement).value = payment.cardHolder
  ;(document.getElementById('card-expiry') as HTMLInputElement).value = payment.cardExpiry
  ;(document.getElementById('card-cvv') as HTMLInputElement).value = payment.cardCvv
  ;(document.getElementById('party-size') as HTMLInputElement).value = String(payment.partySize)
}

document.getElementById('save-payment-btn')!.addEventListener('click', async () => {
  await savePayment({
    cardNumber: (document.getElementById('card-number') as HTMLInputElement).value,
    cardHolder: (document.getElementById('card-holder') as HTMLInputElement).value,
    cardExpiry: (document.getElementById('card-expiry') as HTMLInputElement).value,
    cardCvv: (document.getElementById('card-cvv') as HTMLInputElement).value,
    partySize: parseInt((document.getElementById('party-size') as HTMLInputElement).value) || 1,
  })
  alert('Payment info saved.')
})

// Settings form
async function loadSettingsForm() {
  const { settings } = await getStorage()
  ;(document.getElementById('poll-interval') as HTMLSelectElement).value = String(settings.pollIntervalSeconds)
}

document.getElementById('save-settings-btn')!.addEventListener('click', async () => {
  const val = parseInt((document.getElementById('poll-interval') as HTMLSelectElement).value) as 30 | 60 | 120
  await saveSettings({ pollIntervalSeconds: val })
  alert('Settings saved.')
})

// Init
renderTripList()
loadPaymentForm()
loadSettingsForm()
