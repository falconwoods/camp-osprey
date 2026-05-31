const DEFAULT_BACKEND_BASE_URL = 'http://localhost:4000'

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '')
}

export const BACKEND_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_BACKEND_BASE_URL)
