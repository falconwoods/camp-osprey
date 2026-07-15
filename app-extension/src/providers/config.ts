import type { ReservationProvider } from '../types'

export const DEFAULT_PROVIDER: ReservationProvider = 'bc_parks'

export interface ProviderInfo {
  id: ReservationProvider
  label: string
  baseUrl: string
  loginUrl: string
  cartUrl: string
  reservationsUrl: string
}

export const PROVIDERS: Record<ReservationProvider, ProviderInfo> = {
  bc_parks: {
    id: 'bc_parks',
    label: 'BC Parks',
    baseUrl: 'https://camping.bcparks.ca',
    loginUrl: 'https://camping.bcparks.ca/login',
    cartUrl: 'https://camping.bcparks.ca/cart',
    reservationsUrl: 'https://camping.bcparks.ca/account/all-bookings',
  },
  parks_canada: {
    id: 'parks_canada',
    label: 'Parks Canada',
    baseUrl: 'https://reservation.pc.gc.ca',
    loginUrl: 'https://reservation.pc.gc.ca/login',
    cartUrl: 'https://reservation.pc.gc.ca/cart',
    reservationsUrl: 'https://reservation.pc.gc.ca/account/all-bookings',
  },
}

export function isReservationProvider(value: unknown): value is ReservationProvider {
  return value === 'bc_parks' || value === 'parks_canada'
}

export function providerInfo(provider: ReservationProvider): ProviderInfo {
  return PROVIDERS[provider]
}
