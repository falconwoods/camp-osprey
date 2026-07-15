import type { PaymentConfig, ReservationProvider, Trip } from './types'
import { hasSavedParkPayment } from './paymentCrypto'
import { expandDateRange, isBookable } from './dates'
import { providerInfo } from './providers/config'

export interface Warning {
  level: 'error' | 'warn'
  title?: string
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

export function getRequiredBookingProviders(trips: Trip[]): ReservationProvider[] {
  const providers = new Set<ReservationProvider>()
  for (const trip of trips) {
    if (trip.mode === 'reserve' || trip.mode === 'autopay') providers.add(trip.provider)
  }
  return [...providers]
}

export function getGlobalWarnings(
  trips: Trip[],
  providerLoggedIn: Partial<Record<ReservationProvider, boolean>> | boolean,
  payment: PaymentConfig | null = null,
): Warning[] {
  const warnings: Warning[] = []
  const loggedInByProvider: Partial<Record<ReservationProvider, boolean>> = typeof providerLoggedIn === 'boolean'
    ? { bc_parks: providerLoggedIn }
    : providerLoggedIn

  for (const provider of getRequiredBookingProviders(trips)) {
    if (loggedInByProvider[provider]) continue
    const info = providerInfo(provider)
    warnings.push({
      level: 'warn',
      title: `${info.label} sign-in needed`,
      message: `Sign in to ${info.label} to continue using auto-reserve and auto-pay for trips on that provider.`,
      action: { label: `Open ${info.label}`, url: info.loginUrl },
    })
  }

  if (trips.some(trip => trip.mode === 'autopay') && !isValidParkPayment(payment)) {
    warnings.push({
      level: 'warn',
      title: 'Park Payment setup required',
      message: 'Add your Park Payment details to enable auto-pay trips.',
      action: { label: 'Set up Park Payment', url: '#payment' },
    })
  }

  return warnings
}

export function renderWarnings(warnings: Warning[]): string {
  return warnings.map(w => {
    const actionHTML = w.action
      ? `<a class="alert-action" href="${w.action.url}"${w.action.url.startsWith('#') ? '' : ' target="_blank"'}>${w.action.label}</a>`
      : ''
    const actionClass = w.action ? ' alert-has-action' : ''
    const title = w.title ?? (w.level === 'error' ? 'Action needed' : 'Heads up')
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

function isValidParkPayment(payment: PaymentConfig | null): payment is PaymentConfig {
  return hasSavedParkPayment(payment)
}
