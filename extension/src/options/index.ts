import { getAuth, getClientId, getPendingStartTripId, getStorage, saveTrips, updateTrip } from '../storage'
import { BCParksProvider } from '../providers/bcparks'
import { expandDateRange, isBookable } from '../dates'
import { applyTheme } from '../theme'
import { getTripWarnings, getGlobalWarnings, renderWarnings } from '../warnings'
import { isLoggedIn, watchLoginChanges } from '../background/login'
import { renderAuthPanelHTML, bindAccountPanel } from '../accountPanel'
import { clearPendingStartTripId, consumePendingStartTripId, requireServerAuthForStart } from '../startAuthGate'
import { softDeleteTripOnServer, syncTripToServer } from '../serverApi'
import { AccountPage } from './settings/accountPage'
import { LogsPage } from './settings/logsPage'
import { PaymentPage } from './settings/paymentPage'
import { SettingsPage } from './settings/settingsPage'
import { escapeHtml, icon, type IconName } from './settings/shared'
import type { Trip, DateRange, Park } from '../types'

// Apply saved theme before anything renders
getStorage().then(({ settings }) => applyTheme(settings.theme ?? 'auto'))

const provider = new BCParksProvider()
let editingTripId: string | null = null
let tripParks: Park[] = []
let tripDates: DateRange[] = []
let dateMode: 'specific' | 'recurring' = 'specific'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

async function syncTripBestEffort(trip: Trip): Promise<void> {
  try {
    await syncTripToServer(trip)
  } catch (err) {
    console.warn('Trip sync failed:', err)
  }
}

function upcomingWindows(range: DateRange) {
  return expandDateRange(range).filter(w => isBookable(w.checkIn))
}

function statusTextHTML(status: Trip['status']): string {
  const map: Record<Trip['status'], { className: string; label: string; iconName?: IconName }> = {
    scanning:  { className: 'status-scanning', label: 'Scanning' },
    reserving: { className: 'status-reserving', label: 'Reserving' },
    reserved:  { className: 'status-reserved', label: 'Reserved', iconName: 'check' },
    paid:      { className: 'status-paid', label: 'Paid', iconName: 'check' },
    paused:    { className: 'status-paused', label: 'Paused', iconName: 'pause' },
    failed:    { className: 'status-failed', label: 'Failed' },
    idle:      { className: 'status-idle', label: 'Idle' },
  }
  const s = map[status] ?? map.idle
  const statusIcon = s.iconName ? icon(s.iconName) : '<span class="status-dot"></span>'
  return `<span class="status-badge ${s.className}">${statusIcon}${s.label}</span>`
}

function actionBtnHTML(trip: Trip): string {
  if (trip.status === 'scanning')
    return `<button class="trip-action-btn" type="button" data-id="${trip.id}" data-action="pause">${icon('pause')} Pause</button>`
  if (trip.status === 'reserving')
    return `<button class="trip-action-btn" type="button" disabled>Reserving...</button>`
  if (trip.status === 'reserved' || trip.status === 'paid')
    return `<button class="trip-action-btn" type="button" data-id="${trip.id}" data-action="start">${icon('refresh')} Scan Again</button>`
  if (trip.status === 'paused' || trip.status === 'idle' || trip.status === 'failed')
    return `<button class="trip-action-btn" type="button" data-id="${trip.id}" data-action="start">${icon('play')} Start</button>`
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

type OptionsTab = 'trips' | 'settings' | 'account' | 'payment' | 'logs'
const OPTIONS_TABS: OptionsTab[] = ['trips', 'settings', 'account', 'payment', 'logs']
let debugModeEnabled = false
let activeTab: OptionsTab = tabFromHash()
let authDialogOpen = false

const accountPage = new AccountPage({
  openAuthDialog,
  renderHeaderAccount,
  renderTripList,
  startTripNow,
})
const logsPage = new LogsPage()
const paymentPage = new PaymentPage({ openAuthDialog })
const settingsPage = new SettingsPage({ onDebugModeChange: updateLogsTabVisibility })

function selectTab(name: OptionsTab): void {
  if (name === 'logs' && !debugModeEnabled) name = 'trips'
  activeTab = name
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === name)
  })
  document.getElementById('tab-trips')!.classList.toggle('hidden', name !== 'trips')
  document.getElementById('tab-settings')!.classList.toggle('hidden', !['settings', 'account', 'payment', 'logs'].includes(name))
  document.getElementById('tab-settings-general')!.classList.toggle('hidden', name !== 'settings')
  document.getElementById('tab-account')!.classList.toggle('hidden', name !== 'account')
  document.getElementById('tab-payment')!.classList.toggle('hidden', name !== 'payment')
  document.getElementById('tab-logs')!.classList.toggle('hidden', name !== 'logs')
  if (name === 'logs') void refreshDebugLog()
}

function tabFromHash(): OptionsTab {
  const hashTab = location.hash.replace('#', '') as OptionsTab
  if (!OPTIONS_TABS.includes(hashTab)) return 'trips'
  if (hashTab === 'logs' && !debugModeEnabled) return 'trips'
  return hashTab
}

async function showAccountTab(): Promise<void> {
  if (location.hash !== '#account') {
    history.pushState(null, '', '#account')
  }
  selectTab('account')
  await renderAccount()
}

async function showPaymentTab(): Promise<void> {
  if (location.hash !== '#payment') {
    history.pushState(null, '', '#payment')
  }
  selectTab('payment')
  await renderPayment()
}

async function routeFromHash(): Promise<void> {
  if (location.hash === '#auth') {
    selectTab('trips')
    await openAuthDialog()
    return
  }
  const tab = tabFromHash()
  selectTab(tab)
  if (tab === 'account') await renderAccount()
  if (tab === 'payment') await renderPayment()
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = (tab as HTMLElement).dataset['tab'] as OptionsTab
    if (name === 'logs' && !debugModeEnabled) return
    if (name === 'account') {
      void showAccountTab()
      return
    }
    if (name === 'payment') {
      void showPaymentTab()
      return
    }
    location.hash = name
    selectTab(name)
  })
})

window.addEventListener('hashchange', () => {
  void routeFromHash()
})

// ── Trip list ──────────────────────────────────────────────────────────────

function accountCtaHTML(authEmail: string | null): string {
  if (authEmail) {
    return `<div class="account-cta account-cta-signed-in">
      <span class="account-check">${icon('check')}</span>
      <span>Signed in as ${escapeHtml(authEmail)}</span>
      <button class="icon-only-btn" type="button" id="open-account-btn" aria-label="Open account">${icon('chevronDown')}</button>
    </div>`
  }
  return `<div class="account-cta account-cta-warning">
    <span class="account-lock">${icon('lock')}</span>
    <span class="account-cta-copy"><strong>Sign in to start trips</strong><br>Get booking emails and keep trips connected to your account.</span>
    <button class="trip-action-btn account-sign-in-btn" type="button" id="open-account-btn">Sign in</button>
  </div>`
}

async function bindAccountCta(): Promise<void> {
  document.getElementById('open-account-btn')?.addEventListener('click', () => {
    void (async () => {
      const auth = await getAuth()
      if (auth.user) await showAccountTab()
      else await openAuthDialog()
    })()
  })
}

async function renderHeaderAccount(authEmail?: string | null): Promise<void> {
  const headerAccountEl = document.getElementById('header-account')
  if (!headerAccountEl) return
  const email = authEmail !== undefined ? authEmail : (await getAuth()).user?.email ?? null
  headerAccountEl.innerHTML = accountCtaHTML(email)
  await bindAccountCta()
}

async function renderAccount(): Promise<void> {
  await accountPage.render()
}

async function renderPayment(): Promise<void> {
  await paymentPage.render()
}

async function refreshDebugLog(): Promise<void> {
  await logsPage.refresh()
}

function scheduleDebugLogRefresh(): void {
  logsPage.scheduleRefresh()
}

function authDialogRoot(): HTMLElement {
  let root = document.getElementById('auth-dialog-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'auth-dialog-root'
    document.body.appendChild(root)
  }
  return root
}

function closeAuthDialog(): void {
  authDialogOpen = false
  document.body.classList.remove('auth-dialog-open')
  authDialogRoot().innerHTML = ''
}

async function openAuthDialog(): Promise<void> {
  const root = authDialogRoot()
  const auth = await getAuth()
  if (auth.user) {
    closeAuthDialog()
    await showAccountTab()
    return
  }
  const pendingTripId = await getPendingStartTripId()
  authDialogOpen = true
  document.body.classList.add('auth-dialog-open')
  root.innerHTML = `<div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
    <button class="auth-dialog-close" id="auth-dialog-close" type="button" aria-label="Close sign in dialog">×</button>
    ${renderAuthPanelHTML(auth, pendingTripId)}
  </div>`
  const title = document.querySelector<HTMLElement>('#auth-dialog-root .auth-title')
  if (title) title.id = 'auth-dialog-title'
  document.getElementById('auth-dialog-close')?.addEventListener('click', async () => {
    await clearPendingStartTripId()
    closeAuthDialog()
    await renderAccount()
  })
  bindAccountPanel(async () => {
    closeAuthDialog()
    const tripId = await consumePendingStartTripId()
    if (tripId) await startTripNow(tripId)
    await renderAccount()
    await renderTripList()
    if (activeTab === 'payment') await renderPayment()
  }, async () => {
    await renderAccount()
    await renderHeaderAccount()
  })
  ;(document.getElementById('auth-email') as HTMLInputElement | null)?.focus()
}

async function renderTripList() {
  const { trips, auth } = await getStorage()
  const loggedIn = await isLoggedIn()
  const authEmail = auth.user?.email ?? null
  await renderHeaderAccount(authEmail)
  const globalAlertsEl = document.getElementById('global-alerts')
  if (globalAlertsEl) {
    globalAlertsEl.innerHTML = renderWarnings(getGlobalWarnings(trips, loggedIn))
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
    return `<div class="trip-list-item ${t.status}">
      <div class="trip-list-header">
        <div>
          <span class="trip-list-name">${escapeHtml(t.name)}</span>
          <div class="trip-list-meta">${escapeHtml(parkNames)} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[t.mode]}</div>
        </div>
        <div class="trip-action-zone">
          ${actionBtnHTML(t)}
          <button class="trip-action-btn" type="button" data-id="${t.id}" data-edit-trip="true">${icon('edit')} Edit</button>
          <button class="trip-action-btn trip-delete-btn" type="button" data-id="${t.id}" data-delete="true">${icon('trash')} Delete</button>
        </div>
      </div>
      <div>${statusTextHTML(t.status)}</div>
      ${renderWarnings(warnings)}
      ${matchHTML}
    </div>`
  }).join('')

  list.querySelectorAll('[data-edit-trip]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const trip = trips.find(t => t.id === (btn as HTMLElement).dataset['id'])
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
        if (!(await requireServerAuthForStart(id, false))) {
          await openAuthDialog()
          return
        }
        await startTripNow(id)
      } else {
        await updateTrip(id, { status: 'paused' })
        const { trips: updatedTrips } = await getStorage()
        const updatedTrip = updatedTrips.find(t => t.id === id)
        if (updatedTrip) void syncTripBestEffort(updatedTrip)
        chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: id })
        chrome.storage.local.remove('campOspreyTarget')
      }
      await renderTripList()
    })
  })

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (btn as HTMLElement).dataset['id']!
      await deleteTripById(id)
    })
  })
}

async function deleteTripById(id: string): Promise<void> {
  const { trips } = await getStorage()
  const trip = trips.find(t => t.id === id)
  const label = trip?.name ? `"${trip.name}"` : 'this trip'
  if (!trip || !confirm(`Delete ${label}?`)) return
  void softDeleteTripOnServer({ ...trip, deletedAt: Date.now(), updatedAt: Date.now() }).catch(err => {
    console.warn('Trip delete sync failed:', err)
  })
  await saveTrips(trips.filter(t => t.id !== id))
  if (editingTripId === id) editingTripId = null
  await renderTripList()
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
  const { trips: updatedTrips } = await getStorage()
  const updatedTrip = updatedTrips.find(t => t.id === id)
  if (updatedTrip) void syncTripBestEffort(updatedTrip)
  chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: id, resetActiveMatch: true })
  return true
}

// Open BC Parks sign-in tab and tell user to come back
function promptLogin(): void {
  const alertsEl = document.getElementById('global-alerts')
  if (alertsEl) {
    alertsEl.innerHTML = `<div class="alert-warn" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span>⚠ Not logged in to BC Parks — required for Hold and Auto-pay modes.</span>
      <a href="https://camping.bcparks.ca/login" target="_blank"
         style="white-space:nowrap;text-decoration:underline;opacity:0.9;flex-shrink:0">Log in →</a>
    </div>`
  }
  chrome.tabs.create({ url: 'https://camping.bcparks.ca/login' })
}

// Auto-refresh global alerts when BC Parks login state changes
watchLoginChanges(() => {
  if (activeTab === 'trips') void renderTripList()
})

// Live refresh when service worker updates storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (activeTab === 'trips' && ('trips' in changes || 'auth' in changes)) void renderTripList()
    if (activeTab === 'account' && 'auth' in changes) void renderAccount()
    if (activeTab === 'logs' && 'debugLog' in changes) scheduleDebugLogRefresh()
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
  document.getElementById('editor-trip-title')!.textContent = name

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
      <span>⠿ &nbsp; ${i + 1}.&nbsp; ${escapeHtml(p.name)}</span>
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
      <span>${escapeHtml(describeRange(d))}</span>
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
  const clientId = await getClientId()
  const now = Date.now()
  const savedTripId = editingTripId ?? crypto.randomUUID()
  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId)
    if (idx !== -1) trips[idx] = { ...trips[idx], clientId: trips[idx].clientId ?? clientId, name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'idle', updatedAt: now, deletedAt: null }
  } else {
    // Transfer the date mode saved under 'datemode_new' to the real trip ID
    const savedMode = localStorage.getItem('datemode_new')
    if (savedMode) localStorage.setItem(`datemode_${savedTripId}`, savedMode)
    trips.push({ id: savedTripId, clientId, name, parks: tripParks, dateRanges: tripDates, mode, filters: { noWalkin, noDouble }, status: 'idle', lastMatch: null, attempted: [], createdAt: now, updatedAt: now, deletedAt: null })
  }
  await saveTrips(trips)

  if (!(await requireServerAuthForStart(savedTripId, false))) {
    document.getElementById('back-btn')!.click()
    await openAuthDialog()
    return
  }

  const savedTrip = trips.find(t => t.id === savedTripId)
  if (savedTrip) void syncTripBestEffort(savedTrip)

  if (!(await startTripNow(savedTripId))) return
  document.getElementById('back-btn')!.click()
})

document.getElementById('delete-trip-btn')!.addEventListener('click', async () => {
  if (!editingTripId) return
  const deletedTripId = editingTripId
  await deleteTripById(deletedTripId)
  if (editingTripId !== deletedTripId) document.getElementById('back-btn')!.click()
})

// ── Settings pages ─────────────────────────────────────────────────────────

function updateLogsTabVisibility(enabled: boolean): void {
  debugModeEnabled = enabled
  document.querySelectorAll<HTMLElement>('[data-tab="logs"]').forEach(tab => {
    tab.classList.toggle('hidden', !enabled)
  })
  if (!enabled && activeTab === 'logs') {
    location.hash = 'trips'
    selectTab('trips')
  }
}

async function loadSettingsForm(): Promise<void> {
  await settingsPage.loadForm()
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  settingsPage.bind()
  logsPage.bind()
  await loadSettingsForm()
  await routeFromHash()
  await renderTripList()
}

void init()
