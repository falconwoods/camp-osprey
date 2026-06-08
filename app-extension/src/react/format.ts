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
  return { alert: 'Alert Only', hold: 'Auto-reserve', autopay: 'Auto-pay' }[mode]
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
