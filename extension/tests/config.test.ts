import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('extension config', () => {
  it('uses the local backend by default', async () => {
    vi.stubEnv('VITE_BACKEND_BASE_URL', '')
    vi.resetModules()

    const { BACKEND_BASE_URL } = await import('../src/config')

    expect(BACKEND_BASE_URL).toBe('https://campsoon.com')
  })

  it('uses VITE_BACKEND_BASE_URL without trailing slashes', async () => {
    vi.stubEnv('VITE_BACKEND_BASE_URL', 'https://dev.example.com///')
    vi.resetModules()

    const { BACKEND_BASE_URL } = await import('../src/config')

    expect(BACKEND_BASE_URL).toBe('https://dev.example.com')
  })
})
