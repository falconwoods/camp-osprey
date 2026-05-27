import { getStorage, saveTrips, savePayment, saveSettings, updateTrip, clearDebugLog } from '../storage'
import { BCParksProvider } from '../providers/bcparks'
import { expandDateRange, isBookable } from '../dates'
import { applyTheme } from '../theme'
import { getTripWarnings, getGlobalWarnings, renderWarnings } from '../warnings'
import { isLoggedIn, watchLoginChanges } from '../background/login'
import { formatDebugLog } from '../debugLog'
import { authPanelHTML, bindAuthPanel } from '../authPanel'
import { requireServerAuthForStart } from '../startAuthGate'
import type { Trip, DateRange, Park, Theme } from '../types'

// Apply saved theme before anything renders
getStorage().then(({ settings }) => applyTheme(settings.theme ?? 'auto'))

const provider = new BCParksProvider()
let editingTripId: string | null = null
let tripParks: Park[] = []
let tripDates: DateRange[] = []
let dateMode: 'specific' | 'recurring' = 'specific'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function upcomingWindows(range: DateRange) {
  return expandDateRange(range).filter(w => isBookable(w.checkIn))
}

function statusTextHTML(status: Trip['status']): string {
  const map: Record<Trip['status'], { color: string; label: string }> = {
    scanning:  { color: '#22c55e', label: '● Scanning' },
    reserving: { color: '#3b82f6', label: '● Reserving' },
    reserved:  { color: '#22c55e', label: '✓ Reserved' },
    paid:      { color: '#22c55e', label: '✓ Paid' },
    paused:    { color: '#f59e0b', label: '⏸ Paused' },
    failed:    { color: '#ef4444', label: '! Failed' },
    idle:      { color: '#64748b', label: '— Idle' },
  }
  const s = map[status] ?? map.idle
  return `<span style="color:${s.color};font-size:11px;font-weight:500">${s.label}</span>`
}

function actionBtnHTML(trip: Trip): string {
  if (trip.status === 'scanning')
    return `<button class="trip-action-btn" data-id="${trip.id}" data-action="pause">⏸ Pause</button>`
  if (trip.status === 'reserving')
    return `<button class="trip-action-btn" disabled>Reserving...</button>`
  if (trip.status === 'reserved' || trip.status === 'paid')
    return `<button class="trip-action-btn" data-id="${trip.id}" data-action="start">↻ Scan Again</button>`
  if (trip.status === 'paused' || trip.status === 'idle' || trip.status === 'failed')
    return `<button class="trip-action-btn" data-id="${trip.id}" data-action="start">▶ Start</button>`
  return ''
}

function matchSummaryHTML(match: Trip['lastMatch']): string {
  if (!match) return ''
  const count = match.availableCount ?? 1
  const label = count > 1
    ? `${count} available sites`
    : `${match.sectionName} › Site ${match.siteName}`
  const eventAt = match.paidAt ?? match.reservedAt ?? match.foundAt
  const timeLabel = eventAt ? ` · ${new Date(eventAt).toLocaleString()}` : ''
  return `${match.parkName} › ${label} · ${match.checkIn} → ${match.checkOut}${timeLabel}`
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
  const { trips, auth } = await getStorage()
  const loggedIn = await isLoggedIn()
  const globalAlertsEl = document.getElementById('global-alerts')
  if (globalAlertsEl) {
    globalAlertsEl.innerHTML = authPanelHTML(auth, 'input', 'trip-action-btn') + renderWarnings(getGlobalWarnings(trips, loggedIn))
    bindAuthPanel(async pendingTripId => {
      if (pendingTripId) await startTripNow(pendingTripId)
      await renderTripList()
    }, renderTripList)
  }
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
      ? `<div class="match-info">Found: ${matchSummaryHTML(t.lastMatch)}
         ${t.lastMatch.bookingUrl ? `<a href="${t.lastMatch.bookingUrl}" target="_blank" style="color:#22c55e;margin-left:8px">Book →</a>` : ''}</div>`
      : ''

    const warnings = getTripWarnings(t)
    return `<div class="trip-list-item ${t.status}" data-edit="${t.id}" style="cursor:pointer">
      <div class="trip-list-header">
        <span class="trip-list-name">${t.name} <span style="color:var(--text-dim);font-size:10px">› tap to edit</span></span>
        <div class="trip-action-zone" style="display:flex;align-items:center;gap:10px">
          ${statusTextHTML(t.status)}
          ${actionBtnHTML(t)}
        </div>
      </div>
      <div class="trip-list-meta">${parkNames} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[t.mode]}</div>
      ${renderWarnings(warnings)}
      ${matchHTML}
    </div>`
  }).join('')

  // Action zone (status badge + Start/Pause) shouldn't bubble to the card-edit handler
  list.querySelectorAll('.trip-action-zone').forEach(el => {
    el.addEventListener('click', e => e.stopPropagation())
  })

  // Whole card → edit
  list.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const trip = trips.find(t => t.id === (el as HTMLElement).dataset['edit'])
      if (trip) openEditor(trip)
    })
  })

  // Start/Pause buttons
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!

      if (action === 'start') {
        if (!(await requireServerAuthForStart(id))) {
          await renderTripList()
          return
        }
        await startTripNow(id)
      } else {
        await updateTrip(id, { status: 'paused' })
        chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: id })
        chrome.storage.local.remove('campOspreyTarget')
      }
      await renderTripList()
    })
  })
}

async function startTripNow(id: string): Promise<boolean> {
  const { trips } = await getStorage()
  const trip = trips.find(t => t.id === id)
  if (trip && trip.mode !== 'notify' && !(await isLoggedIn())) {
    promptLogin()
    return false
  }
  chrome.storage.local.remove('campOspreyTarget')
  await updateTrip(id, { status: 'scanning', lastMatch: null, attempted: [] })
  chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: id, resetActiveMatch: true })
  return true
}

// Open BC Parks sign-in tab and tell user to come back
function promptLogin(): void {
  const alertsEl = document.getElementById('global-alerts')
  if (alertsEl) {
    alertsEl.innerHTML = `<div class="alert-warn" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span>⚠ Not logged in to BC Parks — required for Hold and Auto-pay modes.</span>
      <a href="https://camping.bcparks.ca/create-booking/sign-in" target="_blank"
         style="white-space:nowrap;text-decoration:underline;opacity:0.9;flex-shrink:0">Log in →</a>
    </div>`
  }
  chrome.tabs.create({ url: 'https://camping.bcparks.ca/create-booking/sign-in' })
}

// Auto-refresh global alerts when BC Parks login state changes
watchLoginChanges(() => renderTripList())

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
  ;(document.getElementById('trip-mode') as HTMLSelectElement).value = trip?.mode ?? 'hold'
  ;(document.getElementById('filter-walkin') as HTMLInputElement).checked = trip?.filters.noWalkin ?? true
  ;(document.getElementById('filter-double') as HTMLInputElement).checked = trip?.filters.noDouble ?? true

  // Status bar (only for existing trips)
  const statusBar = document.getElementById('editor-status-bar')!
  const statusBadge = document.getElementById('editor-status-badge')!
  if (trip) {
    statusBar.classList.remove('hidden')
    statusBadge.innerHTML = statusTextHTML(trip.status)
    if (trip.lastMatch) {
      const m = trip.lastMatch
      statusBadge.innerHTML += `&nbsp;&nbsp;<span style="color:#22c55e;font-size:11px">Match: ${matchSummaryHTML(m)}</span>`
    }
  } else {
    statusBar.classList.add('hidden')
  }

  renderParksList()
  renderDatesList()

  // Restore last-used date mode for this trip (falls back to 'specific' for new trips)
  const savedMode = localStorage.getItem(trip ? `datemode_${trip.id}` : 'datemode_new') as 'specific' | 'recurring' | null
  applyDateMode(savedMode ?? 'specific')

  document.getElementById('trips-view')!.classList.add('hidden')
  document.getElementById('trip-editor')!.classList.remove('hidden')
}

function applyDateMode(mode: 'specific' | 'recurring'): void {
  dateMode = mode
  document.querySelectorAll('.date-mode-btn').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset['mode'] === mode)
  })
  document.getElementById('specific-inputs')!.classList.toggle('hidden', mode !== 'specific')
  document.getElementById('recurring-inputs')!.classList.toggle('hidden', mode !== 'recurring')
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
  if (r.type === 'specific') {
    const ok = isBookable(r.checkIn)
    return `${r.checkIn} → ${r.checkOut}${ok ? '' : ' ⚠ past deadline'}`
  }
  const bookable = upcomingWindows(r)
  const total = expandDateRange(r).length
  const skipped = total - bookable.length
  const suffix = skipped > 0 ? ` · ${bookable.length} bookable` : ` · ${bookable.length} stays`
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
    // Persist per-trip so the user's preferred mode is restored next time
    const key = editingTripId ? `datemode_${editingTripId}` : 'datemode_new'
    localStorage.setItem(key, dateMode)
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
  const skipped = total - upcoming.length
  const skipNote = skipped > 0 ? ` (${skipped} past booking deadline, skipped)` : ''
  if (upcoming.length === 0) {
    document.getElementById('rec-preview')!.textContent = `→ All dates past BC Parks 8 PM / 2-day booking deadline`
    return
  }
  document.getElementById('rec-preview')!.textContent =
    `→ Scanner will try any of ${upcoming.length} bookable ${DAY_NAMES[startDay]}–${DAY_NAMES[endDay]} stays in ${MONTH_NAMES[month]}${skipNote}`
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

const FULL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function updateEndDayOptions(): void {
  const startDay = parseInt((document.getElementById('rec-start-day') as HTMLSelectElement).value)
  const endSelect = document.getElementById('rec-end-day') as HTMLSelectElement
  const prevEnd = parseInt(endSelect.value)

  // Only show days strictly after the start day
  endSelect.innerHTML = FULL_DAY_NAMES
    .map((name, i) => i > startDay ? `<option value="${i}">${name}</option>` : null)
    .filter(Boolean)
    .join('')

  // Keep previous selection if still valid, else pick the day after start
  endSelect.value = prevEnd > startDay ? String(prevEnd) : String(startDay + 1)
  updateRecurringPreview()
}

initFlexibleDefaults()
document.getElementById('rec-start-day')!.addEventListener('change', updateEndDayOptions)
;['rec-end-day', 'rec-month', 'rec-year'].forEach(id => {
  document.getElementById(id)!.addEventListener('change', updateRecurringPreview)
})
updateEndDayOptions()  // initialise end-day options based on default start-day

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

// ── Field validation helpers ───────────────────────────────────────────────

function fieldError(errorId: string, sectionId: string, message: string): void {
  const el = document.getElementById(errorId)!
  el.textContent = '⚠ ' + message
  el.classList.add('show')
  document.getElementById(sectionId)?.classList.add('section-invalid')
}

function clearFieldErrors(): void {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = ''
    el.classList.remove('show')
  })
  document.querySelectorAll('.section-invalid').forEach(el => el.classList.remove('section-invalid'))
  document.querySelectorAll('.input.invalid').forEach(el => el.classList.remove('invalid'))
}

// Clear individual field error when user starts fixing it
document.getElementById('trip-name')!.addEventListener('input', () => {
  document.getElementById('error-name')!.classList.remove('show')
  document.getElementById('section-name')?.classList.remove('section-invalid')
  ;(document.getElementById('trip-name') as HTMLInputElement).classList.remove('invalid')
})

// ── Save / Delete trip ─────────────────────────────────────────────────────

document.getElementById('save-trip-btn')!.addEventListener('click', async () => {
  clearFieldErrors()

  const name = (document.getElementById('trip-name') as HTMLInputElement).value.trim()
  const mode = (document.getElementById('trip-mode') as HTMLSelectElement).value as Trip['mode']
  const noWalkin = (document.getElementById('filter-walkin') as HTMLInputElement).checked
  const noDouble = (document.getElementById('filter-double') as HTMLInputElement).checked

  let hasErrors = false

  if (!name) {
    fieldError('error-name', 'section-name', 'Trip name is required.')
    ;(document.getElementById('trip-name') as HTMLInputElement).classList.add('invalid')
    ;(document.getElementById('trip-name') as HTMLInputElement).focus()
    hasErrors = true
  }

  if (tripParks.length === 0) {
    fieldError('error-parks', 'section-parks', 'Add at least one park to scan.')
    hasErrors = true
  }

  if (tripDates.length === 0) {
    fieldError('error-dates', 'section-dates', 'Add at least one date range — configure dates above and click "+ Add This Range".')
    hasErrors = true
  }

  if (hasErrors) return

  const { trips } = await getStorage()
  const savedTripId = editingTripId ?? crypto.randomUUID()
  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId)
    if (idx !== -1) trips[idx] = { ...trips[idx], name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'idle' }
  } else {
    // Transfer the date mode saved under 'datemode_new' to the real trip ID
    const savedMode = localStorage.getItem('datemode_new')
    if (savedMode) localStorage.setItem(`datemode_${savedTripId}`, savedMode)
    trips.push({ id: savedTripId, name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'idle', lastMatch: null, attempted: [], createdAt: Date.now() })
  }
  await saveTrips(trips)

  if (!(await requireServerAuthForStart(savedTripId))) {
    document.getElementById('back-btn')!.click()
    return
  }

  if (!(await startTripNow(savedTripId))) return
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
  ;(document.getElementById('billing-address') as HTMLInputElement).value = payment.billingAddress ?? ''
  ;(document.getElementById('billing-postal') as HTMLInputElement).value = payment.billingPostal ?? ''
  ;(document.getElementById('party-size') as HTMLInputElement).value = String(payment.partySize)
}

document.getElementById('save-payment-btn')!.addEventListener('click', async () => {
  await savePayment({
    cardNumber: (document.getElementById('card-number') as HTMLInputElement).value,
    cardHolder: (document.getElementById('card-holder') as HTMLInputElement).value,
    cardExpiry: (document.getElementById('card-expiry') as HTMLInputElement).value,
    cardCvv: (document.getElementById('card-cvv') as HTMLInputElement).value,
    billingAddress: (document.getElementById('billing-address') as HTMLInputElement).value,
    billingPostal: (document.getElementById('billing-postal') as HTMLInputElement).value,
    partySize: parseInt((document.getElementById('party-size') as HTMLInputElement).value) || 1,
  })
  alert('Payment info saved.')
})

// ── Settings ───────────────────────────────────────────────────────────────

let selectedTheme: Theme = 'auto'

function updateThemeBtns(theme: Theme) {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['themeChoice'] === theme)
  })
}

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedTheme = (btn as HTMLElement).dataset['themeChoice'] as Theme
    applyTheme(selectedTheme)
    updateThemeBtns(selectedTheme)
  })
})

async function loadSettingsForm() {
  const { settings } = await getStorage()
  ;(document.getElementById('poll-interval') as HTMLSelectElement).value = String(settings.pollIntervalSeconds)
  const debugEl = document.getElementById('debug-mode') as HTMLInputElement
  debugEl.checked = settings.debugMode ?? false
  document.getElementById('debug-section')!.classList.toggle('hidden', !debugEl.checked)
  selectedTheme = settings.theme ?? 'auto'
  updateThemeBtns(selectedTheme)
}

document.getElementById('debug-mode')!.addEventListener('change', () => {
  const checked = (document.getElementById('debug-mode') as HTMLInputElement).checked
  document.getElementById('debug-section')!.classList.toggle('hidden', !checked)
})

document.getElementById('test-notif-btn')!.addEventListener('click', () => {
  const id = `camposprey-test-${Date.now()}`
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'CampOsprey — Notifications working ✓',
    message: 'If you see this, notifications are set up correctly.',
    requireInteraction: false,
  }, createdId => {
    if (chrome.runtime.lastError) {
      alert(`Notification failed: ${chrome.runtime.lastError.message}\n\nCheck that Chrome has notification permission in macOS System Settings → Notifications → Google Chrome.`)
    } else {
      console.log('[CampOsprey] Test notification sent:', createdId)
    }
  })
})

document.getElementById('save-settings-btn')!.addEventListener('click', async () => {
  const val = parseInt((document.getElementById('poll-interval') as HTMLSelectElement).value) as 30 | 60 | 120
  const debugMode = (document.getElementById('debug-mode') as HTMLInputElement).checked
  await saveSettings({ pollIntervalSeconds: val, debugMode, theme: selectedTheme })
  alert('Settings saved.')
})

async function refreshDebugLog() {
  const { debugLog, settings } = await getStorage()
  const section = document.getElementById('debug-section')!
  section.classList.toggle('hidden', !settings.debugMode)
  if (!settings.debugMode) return
  const box = document.getElementById('debug-log-box')!
  box.textContent = formatDebugLog(debugLog)
  box.scrollTop = box.scrollHeight
}

document.getElementById('clear-log-btn')!.addEventListener('click', async () => {
  await clearDebugLog()
  await refreshDebugLog()
})

document.getElementById('copy-log-btn')!.addEventListener('click', async () => {
  const { debugLog } = await getStorage()
  const text = formatDebugLog(debugLog)
  await navigator.clipboard.writeText(text)
  const btn = document.getElementById('copy-log-btn')!
  const original = btn.textContent
  btn.textContent = 'Copied'
  window.setTimeout(() => { btn.textContent = original }, 1200)
})

// ── Init ───────────────────────────────────────────────────────────────────

renderTripList()
loadPaymentForm()
loadSettingsForm()
refreshDebugLog()
