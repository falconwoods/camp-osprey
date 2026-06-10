const DEFAULT_BACKEND_BASE_URL = 'https://campsoon.com'

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '')
}

export const BACKEND_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_BACKEND_BASE_URL)
export const EXTENSION_CHANNEL = (
  import.meta.env.VITE_EXTENSION_CHANNEL === 'website' ? 'website' : 'chrome_store'
) as 'chrome_store' | 'website'
export const IS_LOCAL_BUILD = import.meta.env.MODE === 'development'

export const APP_CONFIG = {
  points: {
    successfulBookingPointCost: 1000,
  },
} as const
