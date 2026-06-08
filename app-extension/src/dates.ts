import type { DateRange } from './types'

// Day constants — 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
export const DAY = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 } as const

export interface DateWindow {
  checkIn: string   // YYYY-MM-DD
  checkOut: string  // YYYY-MM-DD
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Convert our Mon=0 convention to JS getDay() Sun=0 convention
function toJSDay(ourDay: number): number {
  return (ourDay + 1) % 7
}

// BC Parks rule: reservations close at 8 PM, 2 days before check-in.
// e.g. check-in Jul 10 → deadline Jul 8 @ 20:00 local time
export function isBookable(checkIn: string): boolean {
  const checkInDate = new Date(checkIn + 'T00:00:00')
  const deadline = new Date(checkInDate)
  deadline.setDate(deadline.getDate() - 2)
  deadline.setHours(20, 0, 0, 0)
  return new Date() < deadline
}

export function expandDateRange(range: DateRange): DateWindow[] {
  if (range.type === 'specific') {
    return [{ checkIn: range.checkIn, checkOut: range.checkOut }]
  }

  const { year, month, startDay, endDay } = range
  const results: DateWindow[] = []
  const firstOfMonth = new Date(year, month - 1, 1)
  const jsTarget = toJSDay(startDay)
  const daysAhead = (jsTarget - firstOfMonth.getDay() + 7) % 7
  const nights = ((endDay - startDay) + 7) % 7 || 7

  let current = new Date(year, month - 1, 1 + daysAhead)
  while (current.getMonth() === month - 1) {
    const checkOut = new Date(current)
    checkOut.setDate(checkOut.getDate() + nights)
    results.push({ checkIn: toISO(current), checkOut: toISO(checkOut) })
    current.setDate(current.getDate() + 7)
  }
  return results
}
