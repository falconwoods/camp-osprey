import { getStorage, updateTrip } from '../storage'
import { isLoggedIn } from '../background/login'
import type { Trip, MatchedSite } from '../types'

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

function renderMatch(match: MatchedSite): string {
  return `<div class="match-banner">
    Found: ${match.parkName} › ${match.sectionName} › Site ${match.siteName}<br>
    ${match.checkIn} → ${match.checkOut}
  </div>
  <a href="${match.bookingUrl}" target="_blank"><button class="btn btn-reserve">Reserve Now →</button></a>`
}

function renderTrip(trip: Trip): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }

  const actionBtn = trip.status === 'scanning'
    ? `<button class="btn btn-stop" data-id="${trip.id}" data-action="stop">⏹ Stop</button>`
    : trip.status === 'paused'
    ? `<button class="btn btn-resume" data-id="${trip.id}" data-action="start">▶ Resume</button>`
    : trip.status === 'idle'
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
    ${trip.lastMatch ? renderMatch(trip.lastMatch) : ''}
    ${actionBtn}
  </div>`
}

async function render() {
  const { trips } = await getStorage()
  const loggedIn = await isLoggedIn()
  const container = document.getElementById('trips-container')!
  const warn = document.getElementById('login-warn')!

  const needsLogin = trips.some(t => t.status === 'scanning' && t.mode !== 'notify')
  warn.style.display = !loggedIn && needsLogin ? 'block' : 'none'

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty">No trips yet. Add one to start scanning.</div>'
  } else {
    container.innerHTML = trips.map(renderTrip).join('')
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset['id']!
      const action = (btn as HTMLElement).dataset['action']!
      await updateTrip(id, { status: action === 'start' ? 'scanning' : 'paused' })
      await render()
    })
  })
}

render()
