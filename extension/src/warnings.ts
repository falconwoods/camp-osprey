import type { Trip } from './types'
import { expandDateRange, isBookable } from './dates'

export interface Warning {
  level: 'error' | 'warn'
  message: string
  action?: { label: string; url: string }
}

export function getTripWarnings(trip: Trip): Warning[] {
  const warnings: Warning[] = []

  if (trip.parks.length === 0) {
    warnings.push({ level: 'error', message: 'No parks added — tap to edit and add at least one park.' })
  }

  if (trip.dateRanges.length === 0) {
    warnings.push({ level: 'error', message: 'No date ranges — tap to edit and add dates.' })
  } else {
    const hasBookable = trip.dateRanges.some(r =>
      expandDateRange(r).some(w => isBookable(w.checkIn))
    )
    if (!hasBookable) {
      warnings.push({ level: 'warn', message: 'All dates are past the BC Parks booking deadline (8 PM, 2 days before check-in).' })
    }
  }

  return warnings
}

export function getGlobalWarnings(trips: Trip[], loggedIn: boolean): Warning[] {
  const warnings: Warning[] = []

  const scanningNeedLogin = trips.some(t => t.status === 'scanning' && t.mode !== 'notify')
  if (!loggedIn && scanningNeedLogin) {
    warnings.push({
      level: 'error',
      message: 'Not logged in to BC Parks — Hold and Auto-pay modes are disabled.',
      action: { label: 'Log in →', url: 'https://camping.bcparks.ca/login' },
    })
  }

  return warnings
}

export function renderWarnings(warnings: Warning[]): string {
  return warnings.map(w => {
    const actionHTML = w.action
      ? `<a href="${w.action.url}" target="_blank" style="margin-left:8px;text-decoration:underline;opacity:0.9">${w.action.label}</a>`
      : ''
    return `<div class="alert-${w.level}">⚠ ${w.message}${actionHTML}</div>`
  }).join('')
}
