import { getAuth, getStorage, updateTrip } from '../storage'
import { isLoggedIn } from '../background/login'
import { applyTheme } from '../theme'
import { getTripWarnings, getGlobalWarnings, renderWarnings } from '../warnings'
import { openOptionsAccount, requireServerAuthForStart } from '../startAuthGate'
import type { Trip, MatchedSite } from '../types'

// Apply saved theme immediately before render
getStorage().then(({ settings }) => applyTheme(settings.theme ?? 'auto'))

document.getElementById('settings-link')!.addEventListener('click', e => {
  e.preventDefault()
  chrome.runtime.openOptionsPage()
})

document.getElementById('add-trip-btn')!.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

function badgeClass(status: Trip['status']): string {
  const map: Record<Trip['status'], string> = {
    scanning: 'badge-scanning',
    reserving: 'badge-reserving',
    reserved: 'badge-reserved',
    paid: 'badge-paid',
    paused: 'badge-paused',
    failed: 'badge-failed',
    idle: 'badge-idle',
  }
  return map[status] ?? 'badge-idle'
}

function badgeLabel(status: Trip['status']): string {
  const map: Record<Trip['status'], string> = {
    scanning: '● Scanning',
    reserving: '● Reserving',
    reserved: '✓ Reserved',
    paid: '✓ Paid',
    paused: '⏸ Paused',
    failed: '! Failed',
    idle: '— Idle',
  }
  return map[status] ?? status
}

function renderMatch(match: MatchedSite, mode: Trip['mode'], status: Trip['status']): string {
  const isPaid = status === 'paid'
  const isReserved = status === 'reserved'
  const label = isPaid ? 'Paid' : isReserved ? 'Reserved' : 'Found'
  const color = isPaid || isReserved ? '#22c55e' : '#f59e0b'
  const borderColor = isPaid || isReserved ? '#22c55e44' : '#f59e0b44'
  const bg = isPaid || isReserved ? '#22c55e15' : '#f59e0b11'
  const count = match.availableCount ?? 1
  const matchText = count > 1
    ? `${match.parkName} › ${count} available sites`
    : `${match.parkName} › ${match.sectionName || '—'} › Site ${match.siteName}`
  const eventTime = isPaid ? match.paidAt : isReserved ? match.reservedAt : match.foundAt
  const timeLine = eventTime ? `<br>${label} at ${new Date(eventTime).toLocaleString()}` : ''

  return `<div style="background:${bg};border:1px solid ${borderColor};border-radius:5px;padding:6px 8px;margin-top:6px;font-size:10px;color:${color}">
    ${label}: ${matchText}<br>
    ${match.checkIn} → ${match.checkOut}${timeLine}
  </div>
  ${!isPaid && match.bookingUrl
    ? `<a href="${match.bookingUrl}" target="_blank"><button class="btn btn-reserve" style="margin-top:4px">Reserve Now →</button></a>`
    : ''}`
}

function renderTrip(trip: Trip): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }
  const warnings = getTripWarnings(trip)

  const actionBtn = trip.status === 'scanning'
    ? `<button class="btn btn-stop" data-id="${trip.id}" data-action="pause">⏸ Pause</button>`
    : trip.status === 'reserving'
    ? `<button class="btn btn-stop" disabled>Reserving...</button>`
    : (trip.status === 'reserved' || trip.status === 'paid')
    ? `<button class="btn btn-start" data-id="${trip.id}" data-action="start">↻ Scan Again</button>`
    : (trip.status === 'paused' || trip.status === 'idle' || trip.status === 'failed')
    ? `<button class="btn btn-start" data-id="${trip.id}" data-action="start">▶ Start</button>`
    : ''

  return `<div class="trip-card ${trip.status}">
    <div class="trip-row">
      <span class="trip-name">${trip.name}</span>
      <span class="badge ${badgeClass(trip.status)}">${badgeLabel(trip.status)}</span>
    </div>
    <div class="trip-summary">
      ${parkNames} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[trip.mode]}
    </div>
    ${renderWarnings(warnings)}
    ${trip.lastMatch ? renderMatch(trip.lastMatch, trip.mode, trip.status) : ''}
    ${actionBtn}
  </div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function accountCtaHTML(authEmail: string | null): string {
  if (authEmail) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span>Signed in as ${escapeHtml(authEmail)}</span>
      <button class="btn btn-start" id="open-account-btn">Account</button>
    </div>`
  }
  return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
    <span><strong>Sign in to start trips</strong><br>Get booking emails for your trips.</span>
    <button class="btn btn-start" id="open-account-btn">Sign in</button>
  </div>`
}

async function render() {
  const { trips } = await getStorage()
  const auth = await getAuth()
  const loggedIn = await isLoggedIn()
  const container = document.getElementById('trips-container')!
  const globalAlertsEl = document.getElementById('global-alerts')!

  globalAlertsEl.innerHTML = accountCtaHTML(auth.user?.email ?? null) + renderWarnings(getGlobalWarnings(trips, loggedIn))
  document.getElementById('open-account-btn')?.addEventListener('click', openOptionsAccount)

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty">No trips yet. Add one to start scanning.</div>'
  } else {
    container.innerHTML = trips.map(renderTrip).join('')
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!
      if (action === 'start' && !(await requireServerAuthForStart(id))) {
        await render()
        return
      }
      await updateTrip(id, action === 'start'
        ? { status: 'scanning', lastMatch: null, attempted: [] }
        : { status: 'paused' })
      if (action === 'start') {
        chrome.storage.local.remove('campOspreyTarget')
        chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: id, resetActiveMatch: true })
      }
      if (action === 'pause') {
        chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: id })
        chrome.storage.local.remove('campOspreyTarget')
      }
      await render()
    })
  })
}

// Re-render whenever storage changes (catches service worker updates)
chrome.storage.onChanged.addListener(() => render())

render()
