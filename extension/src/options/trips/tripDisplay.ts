import { expandDateRange, isBookable } from '../../dates'
import type { DateRange, Trip } from '../../types'
import { escapeHtml, icon, type IconName } from '../settings/shared'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
  const modeLabel: Record<Trip['mode'], string> = { notify: 'Notify', hold: 'Hold', autopay: 'Auto-pay' }
  const matchHTML = trip.lastMatch
    ? `<div class="match-info">Found: ${matchSummaryHTML(trip.lastMatch)}
       ${trip.lastMatch.bookingUrl ? `<a href="${trip.lastMatch.bookingUrl}" target="_blank" style="color:#22c55e;margin-left:8px">Book →</a>` : ''}</div>`
    : ''

  return `<div class="trip-list-item ${trip.status}">
    <div class="trip-list-header">
      <div>
        <span class="trip-list-name">${escapeHtml(trip.name)}</span>
        <div class="trip-list-meta">${escapeHtml(parkNames)} · ${dateCount} date range${dateCount !== 1 ? 's' : ''} · ${modeLabel[trip.mode]}</div>
      </div>
      <div class="trip-action-zone">
        ${actionBtnHTML(trip)}
        <button class="trip-action-btn" type="button" data-id="${trip.id}" data-edit-trip="true">${icon('edit')} Edit</button>
        <button class="trip-action-btn trip-delete-btn" type="button" data-id="${trip.id}" data-delete="true">${icon('trash')} Delete</button>
      </div>
    </div>
    <div>${statusTextHTML(trip.status)}</div>
    ${warningsHTML}
    ${matchHTML}
  </div>`
}
