import { getStorage, saveTrips, savePayment, saveSettings, updateTrip, clearDebugLog } from '../storage'
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

function statusTextHTML(status: Trip['status']): string {
  const map: Record<Trip['status'], { color: string; label: string }> = {
    scanning:  { color: '#22c55e', label: '● Scanning' },
    paused:    { color: '#f59e0b', label: '⏸ Paused' },
    idle:      { color: '#64748b', label: '— Idle' },
    completed: { color: '#94a3b8', label: '✓ Done' },
  }
  const s = map[status] ?? map.idle
  return `<span style="color:${s.color};font-size:11px;font-weight:500">${s.label}</span>`
}

function actionBtnHTML(trip: Trip): string {
  if (trip.status === 'scanning')
    return `<button class="trip-action-btn" data-id="${trip.id}" data-action="stop">⏹ Stop</button>`
  if (trip.status === 'paused' || trip.status === 'idle')
    return `<button class="trip-action-btn" data-id="${trip.id}" data-action="start">▶ Start</button>`
  return ''
}

// ── Tab switching ──────────────────────────────────────────────────────────

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

// ── Trip list ──────────────────────────────────────────────────────────────

async function renderTripList() {
  const { trips } = await getStorage()
  const list = document.getElementById('trip-list')!
  if (trips.length === 0) {
    list.innerHTML = '<p style="color:#64748b;font-size:12px;padding:8px 0">No trips yet.</p>'
    return
  }

  list.innerHTML = trips.map(t => {
    const parkNames = t.parks.map(p => p.name).join(', ') || '—'
    const dateCount = t.dateRanges.length
    const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }
    const matchHTML = t.lastMatch
      ? `<div class="match-info">Found: ${t.lastMatch.parkName} › ${t.lastMatch.sectionName} › Site ${t.lastMatch.siteName} · ${t.lastMatch.checkIn} → ${t.lastMatch.checkOut}
         ${t.lastMatch.bookingUrl ? `<a href="${t.lastMatch.bookingUrl}" target="_blank" style="color:#22c55e;margin-left:8px">Book →</a>` : ''}</div>`
      : ''

    return `<div class="trip-list-item ${t.status}" data-edit="${t.id}" style="cursor:pointer">
      <div class="trip-list-header">
        <span class="trip-list-name">${t.name} <span style="color:#475569;font-size:10px">› tap to edit</span></span>
        <div style="display:flex;align-items:center;gap:10px" onclick="event.stopPropagation()">
          ${statusTextHTML(t.status)}
          ${actionBtnHTML(t)}
        </div>
      </div>
      <div class="trip-list-meta">${parkNames} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[t.mode]}</div>
      ${matchHTML}
    </div>`
  }).join('')

  // Whole card → edit (except action button zone which stops propagation inline)
  list.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const trip = trips.find(t => t.id === (el as HTMLElement).dataset['edit'])
      if (trip) openEditor(trip)
    })
  })

  // Start/Stop buttons
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!
      await updateTrip(id, { status: action === 'start' ? 'scanning' : 'paused' })
      await renderTripList()
    })
  })
}

// Live refresh when service worker updates storage
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') {
    const tripsView = document.getElementById('trips-view')!
    const settingsTab = document.getElementById('tab-settings')!
    if (!tripsView.classList.contains('hidden')) renderTripList()
    if (!settingsTab.classList.contains('hidden')) refreshDebugLog()
  }
})

// ── Trip editor ────────────────────────────────────────────────────────────

async function openEditor(trip?: Trip) {
  editingTripId = trip?.id ?? null
  tripParks = trip ? [...trip.parks] : []
  tripDates = trip ? [...trip.dateRanges] : []

  let name = trip?.name ?? ''
  if (!trip) {
    const { trips } = await getStorage()
    name = `Trip ${trips.length + 1}`
  }
  ;(document.getElementById('trip-name') as HTMLInputElement).value = name
  ;(document.getElementById('trip-mode') as HTMLSelectElement).value = trip?.mode ?? 'notify'
  ;(document.getElementById('filter-walkin') as HTMLInputElement).checked = trip?.filters.noWalkin ?? false
  ;(document.getElementById('filter-double') as HTMLInputElement).checked = trip?.filters.noDouble ?? false

  // Status bar (only for existing trips)
  const statusBar = document.getElementById('editor-status-bar')!
  const statusBadge = document.getElementById('editor-status-badge')!
  if (trip) {
    statusBar.classList.remove('hidden')
    statusBadge.innerHTML = statusTextHTML(trip.status)
    if (trip.lastMatch) {
      const m = trip.lastMatch
      statusBadge.innerHTML += `&nbsp;&nbsp;<span style="color:#22c55e;font-size:11px">Match: ${m.parkName} › Site ${m.siteName} · ${m.checkIn} → ${m.checkOut}</span>`
    }
  } else {
    statusBar.classList.add('hidden')
  }

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

// ── Parks ──────────────────────────────────────────────────────────────────

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
      tripParks.splice(parseInt((btn as HTMLElement).dataset['idx']!), 1)
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
        if (!tripParks.find(p => p.id === id)) { tripParks.push({ id, name }); renderParksList() }
        parkSearch.value = ''
        parkResults.style.display = 'none'
      })
    })
  }, 250)
})

// ── Dates ──────────────────────────────────────────────────────────────────

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
      tripDates.splice(parseInt((btn as HTMLElement).dataset['idx']!), 1)
      renderDatesList()
    })
  })
}

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

function initFlexibleDefaults() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const yearSelect = document.getElementById('rec-year') as HTMLSelectElement
  yearSelect.innerHTML = [currentYear, currentYear + 1, currentYear + 2]
    .map(y => `<option value="${y}">${y}</option>`).join('')
  yearSelect.value = String(currentYear)
  ;(document.getElementById('rec-month') as HTMLSelectElement).value = String(now.getMonth() + 1)
}

initFlexibleDefaults()
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
    tripDates.push({
      type: 'recurring',
      year: parseInt((document.getElementById('rec-year') as HTMLSelectElement).value),
      month: parseInt((document.getElementById('rec-month') as HTMLSelectElement).value),
      startDay: parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value),
      endDay: parseInt((document.getElementById('rec-end-day') as HTMLSelectElement).value),
    })
  }
  renderDatesList()
})

// ── Save / Delete trip ─────────────────────────────────────────────────────

document.getElementById('save-trip-btn')!.addEventListener('click', async () => {
  const name = (document.getElementById('trip-name') as HTMLInputElement).value.trim()
  if (!name) { alert('Trip name is required.'); return }
  const mode = (document.getElementById('trip-mode') as HTMLSelectElement).value as Trip['mode']
  const noWalkin = (document.getElementById('filter-walkin') as HTMLInputElement).checked
  const noDouble = (document.getElementById('filter-double') as HTMLInputElement).checked
  const { trips } = await getStorage()
  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId)
    if (idx !== -1) trips[idx] = { ...trips[idx], name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'scanning', lastMatch: null, attempted: [] }
  } else {
    trips.push({ id: crypto.randomUUID(), name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'scanning', lastMatch: null, attempted: [], createdAt: Date.now() })
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

// ── Payment ────────────────────────────────────────────────────────────────

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

// ── Settings ───────────────────────────────────────────────────────────────

async function loadSettingsForm() {
  const { settings } = await getStorage()
  ;(document.getElementById('poll-interval') as HTMLSelectElement).value = String(settings.pollIntervalSeconds)
  const debugEl = document.getElementById('debug-mode') as HTMLInputElement
  debugEl.checked = settings.debugMode ?? false
  document.getElementById('debug-section')!.classList.toggle('hidden', !debugEl.checked)
}

document.getElementById('debug-mode')!.addEventListener('change', () => {
  const checked = (document.getElementById('debug-mode') as HTMLInputElement).checked
  document.getElementById('debug-section')!.classList.toggle('hidden', !checked)
})

document.getElementById('test-notif-btn')!.addEventListener('click', () => {
  const id = `campsniper-test-${Date.now()}`
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'CampSniper — Notifications working ✓',
    message: 'If you see this, notifications are set up correctly.',
    requireInteraction: false,
  }, createdId => {
    if (chrome.runtime.lastError) {
      alert(`Notification failed: ${chrome.runtime.lastError.message}\n\nCheck that Chrome has notification permission in macOS System Settings → Notifications → Google Chrome.`)
    } else {
      console.log('[CampSniper] Test notification sent:', createdId)
    }
  })
})

document.getElementById('save-settings-btn')!.addEventListener('click', async () => {
  const val = parseInt((document.getElementById('poll-interval') as HTMLSelectElement).value) as 30 | 60 | 120
  const debugMode = (document.getElementById('debug-mode') as HTMLInputElement).checked
  await saveSettings({ pollIntervalSeconds: val, debugMode })
  alert('Settings saved.')
})

async function refreshDebugLog() {
  const { debugLog, settings } = await getStorage()
  const section = document.getElementById('debug-section')!
  section.classList.toggle('hidden', !settings.debugMode)
  if (!settings.debugMode) return
  const box = document.getElementById('debug-log-box')!
  box.textContent = debugLog.length === 0
    ? 'No log entries yet — waiting for next scan cycle.'
    : [...debugLog].reverse().join('\n')
}

document.getElementById('clear-log-btn')!.addEventListener('click', async () => {
  await clearDebugLog()
  await refreshDebugLog()
})

// ── Init ───────────────────────────────────────────────────────────────────

renderTripList()
loadPaymentForm()
loadSettingsForm()
refreshDebugLog()
