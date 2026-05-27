import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumePendingStartTripId, openAuthGateForTrip, requireServerAuthForStart } from '../src/startAuthGate'
import { saveAuth } from '../src/storage'

vi.mock('../src/auth', () => ({
  validateAuth: vi.fn(),
}))

import { validateAuth } from '../src/auth'

beforeEach(async () => {
  vi.clearAllMocks()
  let stored: Record<string, unknown> = {}
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
  chrome.storage.local.set.mockImplementation((data, cb) => {
    stored = { ...stored, ...data }
    cb?.()
  })
  await saveAuth({ token: null, user: null, lastEmail: null })
})

describe('start auth gate', () => {
  it('blocks start and records pending trip when signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(false)
    expect(consumePendingStartTripId()).toBe('trip-1')
  })

  it('allows start when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(true)
    expect(consumePendingStartTripId()).toBeNull()
  })

  it('can manually set pending trip for UI flows', () => {
    openAuthGateForTrip('trip-2')
    expect(consumePendingStartTripId()).toBe('trip-2')
    expect(consumePendingStartTripId()).toBeNull()
  })
})
