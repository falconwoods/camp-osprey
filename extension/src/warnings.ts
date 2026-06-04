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
    warnings.push({ level: 'error', message: 'No date ranges — open the editor, configure dates, then click "+ Add This Range".' })
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

export function getGlobalWarnings(_trips: Trip[], loggedIn: boolean): Warning[] {
  const warnings: Warning[] = []

  if (!loggedIn) {
    warnings.push({
      level: 'warn',
      message: 'Not logged in to BC Parks. Hold and Auto-pay modes require a BC Parks account.',
      action: { label: 'Log in →', url: 'https://camping.bcparks.ca/login' },
    })
  }

  return warnings
}

export function renderWarnings(warnings: Warning[]): string {
  return warnings.map(w => {
    const actionHTML = w.action
      ? `<a class="alert-action" href="${w.action.url}" target="_blank">${w.action.label}</a>`
      : ''
    const actionClass = w.action ? ' alert-has-action' : ''
    const title = w.level === 'error' ? 'Action needed' : w.action ? 'BC Parks sign-in needed' : 'Heads up'
    return `<div class="alert-${w.level}${actionClass}">
      <span class="alert-icon" aria-hidden="true">!</span>
      <span class="alert-copy">
        <strong>${title}</strong>
        <span>${w.message}</span>
      </span>
      ${actionHTML}
    </div>`
  }).join('')
}
