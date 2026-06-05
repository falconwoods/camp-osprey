import { expandDateRange, isBookable } from '../../dates'
import type { DateRange, Trip } from '../../types'
import { escapeHtml, icon, type IconName } from '../settings/shared'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export function upcomingWindows(range: DateRange) {
  return expandDateRange(range).filter(w => isBookable(w.checkIn))
}

export function statusTextHTML(status: Trip['status']): string {
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

export function actionBtnHTML(trip: Trip): string {
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

export function matchSummaryHTML(match: Trip['lastMatch']): string {
  if (!match) return ''
  const count = match.availableCount ?? 1
  const label = count > 1
    ? `${count} available sites`
    : `${match.sectionName} › Site ${match.siteName}`
  const eventAt = match.paidAt ?? match.reservedAt ?? match.foundAt
  const timeLabel = eventAt ? ` · ${new Date(eventAt).toLocaleString()}` : ''
  return `${match.parkName} › ${label} · ${match.checkIn} → ${match.checkOut}${timeLabel}`
}

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return DATE_FORMATTER.format(new Date(year, month - 1, day))
}

function formatTimeLabel(value: string | number): string {
  return TIME_FORMATTER.format(new Date(value))
}

function bookingActionLabel(match: Trip['lastMatch'], mode: Trip['mode']): string {
  if (match?.paidAt) return 'View booking details'
  if (match?.reservedAt) return mode === 'hold' ? 'Go to payment' : 'View checkout'
  if (mode === 'hold') return 'Open reservation'
  if (mode === 'autopay') return 'Open checkout'
  return 'Book this site'
}

function matchStateLabel(match: Trip['lastMatch']): string {
  if (!match) return ''
  if (match.paidAt) return 'Site paid'
  if (match.reservedAt) return 'Site reserved'
  const count = match.availableCount ?? 1
  return count > 1 ? 'Sites found' : 'Site found'
}

function eventTimeLabel(match: Trip['lastMatch']): string {
  if (!match) return ''
  if (match.paidAt) return `Paid at ${formatTimeLabel(match.paidAt)}`
  if (match.reservedAt) return `Reserved at ${formatTimeLabel(match.reservedAt)}`
  if (match.foundAt) return `Found at ${formatTimeLabel(match.foundAt)}`
  return ''
}

function matchCardHTML(match: Trip['lastMatch'], mode: Trip['mode']): string {
  if (!match) return ''
  const count = match.availableCount ?? 1
  const stateLabel = matchStateLabel(match)
  const siteLabel = count > 1
    ? `${count} available sites`
    : `${match.sectionName} › Site ${match.siteName}`
  const eventLabel = eventTimeLabel(match)
  const bookHTML = match.bookingUrl
    ? `<a class="trip-book-btn" href="${escapeHtml(match.bookingUrl)}" target="_blank" rel="noopener noreferrer">${bookingActionLabel(match, mode)} ${icon('arrowRight')}</a>`
    : ''

  return `<div class="trip-match-card">
    <div class="trip-match-icon">${icon('check')}</div>
    <div class="trip-match-content">
      <div class="trip-match-state">${stateLabel}</div>
      <div class="trip-match-title">${escapeHtml(match.parkName)} › ${escapeHtml(siteLabel)}</div>
      <div class="trip-match-meta">
        ${icon('calendar')}
        <span>${escapeHtml(formatDateLabel(match.checkIn))}</span>
        <span>→</span>
        <span>${escapeHtml(formatDateLabel(match.checkOut))}</span>
        ${eventLabel ? '<span>•</span>' : ''}
        ${eventLabel ? `<span>${escapeHtml(eventLabel)}</span>` : ''}
      </div>
    </div>
    ${bookHTML}
  </div>`
}

function scanningCardHTML(): string {
  return `<div class="trip-scan-card">
    <span class="trip-spinner" aria-hidden="true"></span>
    <span>Looking for available campsites...</span>
  </div>`
}

export function describeRange(range: DateRange): string {
  if (range.type === 'specific') {
    const ok = isBookable(range.checkIn)
    return `${range.checkIn} → ${range.checkOut}${ok ? '' : ' ⚠ past deadline'}`
  }
  const bookable = upcomingWindows(range)
  const total = expandDateRange(range).length
  const skipped = total - bookable.length
  const suffix = skipped > 0 ? ` · ${bookable.length} bookable` : ` · ${bookable.length} stays`
  return `Any ${DAY_NAMES[range.startDay]}–${DAY_NAMES[range.endDay]} · ${MONTH_NAMES[range.month]} ${range.year}${suffix}`
}

export function recurringPreviewText(range: Extract<DateRange, { type: 'recurring' }>): string {
  const upcoming = upcomingWindows(range)
  const total = expandDateRange(range).length
  const skipped = total - upcoming.length
  const skipNote = skipped > 0 ? ` (${skipped} past booking deadline, skipped)` : ''
  if (upcoming.length === 0) {
    return '→ All dates past BC Parks 8 PM / 2-day booking deadline'
  }
  return `→ Scanner will try any of ${upcoming.length} bookable ${DAY_NAMES[range.startDay]}–${DAY_NAMES[range.endDay]} stays in ${MONTH_NAMES[range.month]}${skipNote}`
}

export function tripListItemHTML(trip: Trip, warningsHTML = ''): string {
  const parkNames = trip.parks.map(p => p.name).join(', ') || '—'
  const dateCount = trip.dateRanges.length
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Auto-reserve', autopay: 'Auto-pay' }
  const resultHTML = trip.lastMatch ? matchCardHTML(trip.lastMatch, trip.mode) : ''
  const activityHTML = !trip.lastMatch && (trip.status === 'scanning' || trip.status === 'reserving') ? scanningCardHTML() : ''

  return `<div class="trip-list-item ${trip.status}" data-trip-card-id="${trip.id}">
    <div class="trip-list-header">
      <div>
        <span class="trip-list-name">${escapeHtml(trip.name)}</span>
        <div class="trip-list-meta">${escapeHtml(parkNames)} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[trip.mode]}</div>
      </div>
      ${statusTextHTML(trip.status)}
    </div>
    ${warningsHTML}
    ${resultHTML}
    ${activityHTML}
    <div class="trip-action-zone">
      ${actionBtnHTML(trip)}
      <button class="trip-action-btn" type="button" data-id="${trip.id}" data-edit-trip="true">${icon('edit')} Edit</button>
      <button class="trip-action-btn trip-delete-btn" type="button" data-id="${trip.id}" data-delete="true">${icon('trash')} Delete</button>
    </div>
  </div>`
}

export function tripListSkeletonHTML(count = 3): string {
  return Array.from({ length: count }, () => `<div class="trip-list-item trip-list-skeleton" aria-hidden="true">
    <div class="trip-list-header">
      <div class="trip-skeleton-main">
        <span class="trip-skeleton-line trip-skeleton-title"></span>
        <span class="trip-skeleton-line trip-skeleton-meta"></span>
      </div>
      <span class="trip-skeleton-line trip-skeleton-status"></span>
    </div>
    <div class="trip-action-zone">
      <span class="trip-skeleton-line trip-skeleton-button"></span>
      <span class="trip-skeleton-line trip-skeleton-button"></span>
      <span class="trip-skeleton-line trip-skeleton-button"></span>
    </div>
  </div>`).join('')
}
