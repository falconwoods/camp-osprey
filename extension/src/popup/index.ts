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
document.getElementById('add-trip-btn')!.textContent = 'Manage Trip'

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
    scanning: 'Scanning',
    reserving: 'Reserving',
    reserved: 'Reserved',
    paid: 'Paid',
    paused: 'Paused',
    failed: '! Failed',
    idle: 'Idle',
  }
  return map[status] ?? status
}

function icon(name: 'check' | 'dots' | 'pause' | 'refresh' | 'play' | 'clock' | 'alert'): string {
  const attrs = 'class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  const paths: Record<typeof name, string> = {
    check: '<path d="m20 6-11 11-5-5"/>',
    dots: '<path d="M12 12h.01"/><path d="M19 12h.01"/><path d="M5 12h.01"/>',
    pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.25"/><path d="M3 12A9 9 0 0 1 18.5 5.75"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="m10.3 3.86-8.1 14A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.7-3.14l-8.1-14a2 2 0 0 0-3.4 0Z"/>',
  }
  return `<svg ${attrs}>${paths[name]}</svg>`
}

function statusIcon(status: Trip['status']): string {
  if (status === 'scanning') return '<span class="status-dot"></span>'
  if (status === 'reserved' || status === 'paid') return icon('check')
  return ''
}

function reserveActionHTML(match: MatchedSite, status: Trip['status']): string {
  if (status === 'paid' || !match.bookingUrl) return ''
  const label = status === 'reserved' ? 'Finish Checkout →' : 'Reserve Now →'
  return `<a href="${match.bookingUrl}" target="_blank"><button class="btn btn-reserve">${label}</button></a>`
}

function shortDateRange(match: MatchedSite): string {
  const checkIn = new Date(`${match.checkIn}T00:00:00`)
  const checkOut = new Date(`${match.checkOut}T00:00:00`)
  const sameYear = checkIn.getFullYear() === checkOut.getFullYear()
  const sameMonth = checkIn.getMonth() === checkOut.getMonth()
  const start = checkIn.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const end = sameMonth
    ? checkOut.toLocaleDateString(undefined, { day: 'numeric', year: 'numeric' })
    : checkOut.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start}-${end}`
}

function shortEventTime(value: string | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function renderMatch(match: MatchedSite, status: Trip['status']): string {
  const isPaid = status === 'paid'
  const isReserved = status === 'reserved'
  const label = isPaid ? 'Paid' : isReserved ? 'Reserved' : 'Found'
  const count = match.availableCount ?? 1
  const matchText = count > 1
    ? `${match.parkName} › ${count} available sites`
    : `${match.parkName} › ${match.sectionName || '—'} › Site ${match.siteName}`
  const eventTime = isPaid ? match.paidAt : isReserved ? match.reservedAt : match.foundAt
  const timeLine = eventTime ? ` · ${label} ${shortEventTime(eventTime)}` : ''

  return `<div class="match-panel ${isPaid || isReserved ? 'match-booked' : 'match-found'}">
    <p class="match-title">${matchText}</p>
    <p class="match-subtitle">${shortDateRange(match)}${timeLine}</p>
  </div>`
}

function statePanelHTML(trip: Trip, actionBtn: string): string {
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }
  const copy: Partial<Record<Trip['status'], { title: string; subtitle: string }>> = {
    scanning: {
      title: 'Search running',
      subtitle: modeLabel[trip.mode] === 'Hold' ? 'Will hold the first match' : modeLabel[trip.mode] === 'Auto-pay' ? 'Will book and pay if possible' : 'Will notify when a site opens',
    },
    reserving: {
      title: 'Reservation in progress',
      subtitle: 'Checking out on BC Parks',
    },
    paused: {
      title: 'Search paused',
      subtitle: 'Resume when you want to scan again',
    },
    failed: {
      title: 'Action needed',
      subtitle: 'Last booking attempt failed',
    },
    idle: {
      title: 'Ready to scan',
      subtitle: `${modeLabel[trip.mode]} mode`,
    },
  }
  const state = copy[trip.status]
  if (!state) return ''
  return `<div class="state-panel ${trip.status}">
    <div>
      <div class="state-title">${state.title}</div>
      <div class="state-subtitle">${state.subtitle}</div>
    </div>
    ${actionBtn}
  </div>`
}

function renderTrip(trip: Trip): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const warnings = getTripWarnings(trip)

  const actionBtn = trip.status === 'scanning'
    ? `<button class="btn btn-stop" data-id="${trip.id}" data-action="pause">${icon('pause')} Pause</button>`
    : trip.status === 'reserving'
    ? `<button class="btn btn-stop" disabled>Reserving...</button>`
    : (trip.status === 'reserved' || trip.status === 'paid')
    ? `<button class="btn btn-start" data-id="${trip.id}" data-action="start">${icon('refresh')} Scan</button>`
    : (trip.status === 'paused' || trip.status === 'idle' || trip.status === 'failed')
    ? `<button class="btn btn-start" data-id="${trip.id}" data-action="start">${icon('play')} Start</button>`
    : ''

  const reserveAction = trip.lastMatch ? reserveActionHTML(trip.lastMatch, trip.status) : ''

  return `<div class="trip-card ${trip.status}">
    <div class="trip-row">
      <div class="trip-main">
        <div class="trip-title-line">
          <div class="trip-name">${trip.name}</div>
          <span class="badge ${badgeClass(trip.status)}">${statusIcon(trip.status)}${badgeLabel(trip.status)}</span>
        </div>
        <div class="trip-summary">${parkNames} · ${dateCount} date range${dateCount !== 1 ? 's' : ''}</div>
      </div>
      <button class="trip-more" type="button" tabindex="-1">${icon('dots')}</button>
    </div>
    ${renderWarnings(warnings)}
    ${statePanelHTML(trip, actionBtn)}
    ${trip.lastMatch ? renderMatch(trip.lastMatch, trip.status) : ''}
    ${!['scanning', 'reserving', 'paused', 'idle', 'failed'].includes(trip.status) && (reserveAction || actionBtn) ? `<div class="trip-actions">${reserveAction}${actionBtn}</div>` : ''}
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
    return `<div class="account-cta">
      <span class="account-email">Signed in as ${escapeHtml(authEmail)}</span>
      <button class="btn btn-start" id="open-account-btn">Account</button>
    </div>`
  }
  return `<div class="account-cta">
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
  const headerEmailEl = document.getElementById('header-email')!

  headerEmailEl.textContent = auth.user?.email ?? 'Sign in required'
  globalAlertsEl.innerHTML = (auth.user?.email ? '' : accountCtaHTML(null)) + renderWarnings(getGlobalWarnings(trips, loggedIn))
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
