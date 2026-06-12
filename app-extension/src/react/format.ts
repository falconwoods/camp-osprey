import type { DateRange, MatchedSite, Trip } from '../types'

export function statusLabel(status: Trip['status']): string {
  return {
    idle: 'Idle',
    scanning: 'Scanning',
    reserving: 'Reserving',
    reserved: 'Reserved',
    paid: 'Paid',
    paused: 'Paused',
    failed: 'Failed',
  }[status]
}

export function modeLabel(mode: Trip['mode']): string {
  return { alert: 'Alert Only', reserve: 'Auto-reserve', autopay: 'Auto-pay' }[mode]
}

export function statusDisplay(trip: Trip): { title: string; detail: string; time: string } {
  const lastActivity = trip.lastMatch?.paidAt ?? trip.lastMatch?.reservedAt ?? trip.lastMatch?.foundAt
  const checkedAt = lastActivity ?? (trip.updatedAt ? new Date(trip.updatedAt).toISOString() : '')
  const updated = checkedAt ? formatDateTime(checkedAt) : ''
  const time = checkedAt ? `Last checked ${relativeTime(checkedAt)}` : 'Not checked yet'

  if (trip.mode === 'alert' && trip.lastMatch?.foundAt) {
    return { title: 'Found', detail: 'Campsite available', time: updated || time }
  }
  if (trip.status === 'scanning') return { title: 'Monitoring', detail: 'Checking availability', time }
  if (trip.status === 'idle' || trip.status === 'paused') return { title: 'Paused', detail: `Start ${modeLabel(trip.mode)} when ready`, time }
  if (trip.status === 'reserved' || trip.status === 'paid') {
    const confirmedAt = lastActivity ? formatDateTime(lastActivity) : ''
    return {
      title: trip.status === 'paid' ? 'Paid' : 'Booked',
      detail: trip.status === 'paid' ? 'Payment confirmed' : 'Booking confirmed',
      time: confirmedAt || updated || 'Reservation confirmed',
    }
  }
  if (trip.status === 'reserving') return { title: 'Reserving', detail: 'Completing reservation', time }
  if (trip.status === 'failed' && trip.mode === 'autopay') return { title: 'Payment failed', detail: 'Check the BC Parks checkout page for details', time }
  if (trip.status === 'failed') return { title: 'Failed', detail: 'Needs attention before scanning', time }
  return { title: 'Paused', detail: `Start ${modeLabel(trip.mode)} when ready`, time }
}

export function describeRange(range: DateRange): string {
  if (range.type === 'specific') return `${formatShortDate(range.checkIn)} to ${formatShortDate(range.checkOut)}`
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const month = new Date(range.year, range.month - 1, 1).toLocaleDateString(undefined, { month: 'long' })
  return `${days[range.startDay]} to ${days[range.endDay]} in ${month} ${range.year}`
}

export function formatShortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function matchLine(match: MatchedSite): string {
  return `${match.parkName} / ${match.sectionName || 'Section'} / Site ${match.siteName}`
}

function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return formatDateTime(value)
  if (diffMs < 30_000) return 'just now'

  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return formatDateTime(value)
}
