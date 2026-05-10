import { getStorage, updateTrip } from '../storage'
import { isLoggedIn } from '../background/login'
import { applyTheme } from '../theme'
import { getTripWarnings, getGlobalWarnings, renderWarnings } from '../warnings'
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
    scanning: 'badge-scanning', paused: 'badge-paused', idle: 'badge-idle', completed: 'badge-completed',
  }
  return map[status] ?? 'badge-idle'
}

function badgeLabel(status: Trip['status']): string {
  const map: Record<Trip['status'], string> = {
    scanning: '● Scanning', paused: '⏸ Paused', idle: '— Idle', completed: '✓ Done',
  }
  return map[status] ?? status
}

function renderMatch(match: MatchedSite, mode: Trip['mode'], status: Trip['status']): string {
  const isBooked = status === 'completed'
  const label = isBooked ? '✓ Booked' : 'Found'
  const color = isBooked ? '#22c55e' : '#f59e0b'
  const borderColor = isBooked ? '#22c55e44' : '#f59e0b44'
  const bg = isBooked ? '#22c55e15' : '#f59e0b11'

  return `<div style="background:${bg};border:1px solid ${borderColor};border-radius:5px;padding:6px 8px;margin-top:6px;font-size:10px;color:${color}">
    ${label}: ${match.parkName} › ${match.sectionName || '—'} › Site ${match.siteName}<br>
    ${match.checkIn} → ${match.checkOut}
  </div>
  ${!isBooked && match.bookingUrl
    ? `<a href="${match.bookingUrl}" target="_blank"><button class="btn btn-reserve" style="margin-top:4px">Reserve Now →</button></a>`
    : ''}`
}

function renderTrip(trip: Trip): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }
  const warnings = getTripWarnings(trip)

  const actionBtn = trip.status === 'scanning'
    ? `<button class="btn btn-stop" data-id="${trip.id}" data-action="stop">⏹ Stop</button>`
    : (trip.status === 'paused' || trip.status === 'idle')
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

async function render() {
  const { trips } = await getStorage()
  const loggedIn = await isLoggedIn()
  const container = document.getElementById('trips-container')!
  const globalAlertsEl = document.getElementById('global-alerts')!

  globalAlertsEl.innerHTML = renderWarnings(getGlobalWarnings(trips, loggedIn))

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty">No trips yet. Add one to start scanning.</div>'
  } else {
    container.innerHTML = trips.map(renderTrip).join('')
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!
      await updateTrip(id, action === 'start'
        ? { status: 'scanning', lastMatch: null, attempted: [] }
        : { status: 'paused' })
      if (action === 'start') chrome.runtime.sendMessage({ type: 'SCAN_NOW' })
      if (action === 'stop') chrome.storage.local.remove('campOspreyTarget')
      await render()
    })
  })
}

// Re-render whenever storage changes (catches service worker updates)
chrome.storage.onChanged.addListener(() => render())

render()
