import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingStartTripId, consumePendingStartTripId, getPendingStartTripId, requireServerAuthForStart } from '../src/startAuthGate'

vi.mock('../src/auth', () => ({
  validateAuth: vi.fn(),
}))

import { validateAuth } from '../src/auth'

beforeEach(() => {
  let stored: Record<string, unknown> = {}
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
  chrome.storage.local.set.mockImplementation((data, cb) => {
    stored = { ...stored, ...data }
    cb?.()
  })
  chrome.storage.local.remove.mockImplementation((key, cb) => {
    const keys = Array.isArray(key) ? key : [key]
    for (const item of keys) delete stored[item]
    cb?.()
  })
  chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
  chrome.tabs.create = vi.fn()
})

describe('start auth gate', () => {
  it('stores pending trip and opens Options Account when auth is missing', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(false)

    await expect(getPendingStartTripId()).resolves.toBe('trip-1')
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options/index.html#account',
    })
  })

  it('does not store pending trip when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(true)

    await expect(getPendingStartTripId()).resolves.toBeNull()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('consumes and clears pending trip id', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await requireServerAuthForStart('trip-1')

    await expect(consumePendingStartTripId()).resolves.toBe('trip-1')
    await expect(getPendingStartTripId()).resolves.toBeNull()
  })

  it('clears pending trip id explicitly', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await requireServerAuthForStart('trip-1')

    await clearPendingStartTripId()

    await expect(getPendingStartTripId()).resolves.toBeNull()
  })
})
