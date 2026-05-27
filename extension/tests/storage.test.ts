import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { addDebugLog, getStorage, saveTrips, updateTrip, MAX_DEBUG_LOG_ENTRIES } from '../src/storage'
import { clearAuthSession, getAuth, saveAuth } from '../src/storage'
import type { Trip } from '../src/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Test Trip',
    parks: [],
    dateRanges: [],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify',
    status: 'idle',
    lastMatch: null,
    attempted: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('getStorage', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({}))
  })

  it('returns defaults when storage is empty', async () => {
    const data = await getStorage()
    expect(data.trips).toEqual([])
    expect(data.payment).toBeNull()
    expect(data.settings.pollIntervalSeconds).toBe(60)
  })
})

describe('saveTrips', () => {
  it('calls chrome.storage.local.set with trips', async () => {
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())
    const trips = [makeTrip()]
    await saveTrips(trips)
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ trips }, expect.any(Function))
  })
})

describe('auth storage', () => {
  beforeEach(() => {
    let stored: Record<string, unknown> = {}
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })
  })

  it('defaults auth to signed out', async () => {
    const auth = await getAuth()
    expect(auth).toEqual({ token: null, user: null, lastEmail: null })
  })

  it('saves token, user, and lastEmail', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })

    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })
  })

  it('clears token and user while keeping lastEmail on sign out', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })

    await clearAuthSession()

    await expect(getAuth()).resolves.toEqual({
      token: null,
      user: null,
      lastEmail: 'user@example.com',
    })
  })
})

describe('updateTrip', () => {
  it('merges updates into matching trip', async () => {
    const trip = makeTrip()
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ trips: [trip] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await updateTrip('trip-1', { status: 'scanning' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.trips[0].status).toBe('scanning')
    expect(setCall.trips[0].name).toBe('Test Trip')
  })

  it('throws if trip not found', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ trips: [] }))
    await expect(updateTrip('missing', {})).rejects.toThrow('not found')
  })
})

describe('addDebugLog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps more than 30 entries so the scan history is not truncated too aggressively', async () => {
    const existing = Array.from({ length: 40 }, (_, i) => `entry ${i}`)
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog('latest')

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(41)
    expect(setCall.debugLog[0]).toBe('entry 0')
    expect(setCall.debugLog[40]).toContain('latest')
  })

  it('keeps overnight-sized local logs instead of trimming at 500 entries', async () => {
    const existing = Array.from({ length: 800 }, (_, i) => `entry ${i}`)
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog('latest')

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(801)
    expect(setCall.debugLog[0]).toBe('entry 0')
    expect(setCall.debugLog[800]).toContain('latest')
  })

  it('keeps a larger local log history cap for long debug runs', async () => {
    expect(MAX_DEBUG_LOG_ENTRIES).toBe(100_000)
  })

  it('adds full date and time to each log entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T17:42:05-07:00'))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: [] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog('found site')

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog[0]).toContain('May 26, 2026')
    expect(setCall.debugLog[0]).toContain('found site')
  })

  it('serializes concurrent writes so log entries are not lost', async () => {
    let stored: Record<string, unknown> = { debugLog: [] }
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })

    await Promise.all([
      addDebugLog('first'),
      addDebugLog('second'),
    ])

    expect(stored.debugLog).toHaveLength(2)
    expect(stored.debugLog).toEqual([
      expect.stringContaining('first'),
      expect.stringContaining('second'),
    ])
  })
})
