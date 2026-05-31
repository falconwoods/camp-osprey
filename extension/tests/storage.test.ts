import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addDebugLog,
  getStorage,
  saveTrips,
  updateTrip,
  MAX_DEBUG_LOG_ENTRIES,
  PENDING_SERVER_LOGS_KEY,
} from '../src/storage'
import { clearAuthSession, getAuth, saveAuth } from '../src/storage'
import type { DebugLogEntry, Trip } from '../src/types'

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
    expect(data.settings.logSyncMinLevel).toBe('info')
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

  function entry(i: number): DebugLogEntry {
    return {
      ts: `2026-05-27T00:00:${String(i).padStart(2, '0')}.000Z`,
      level: 'info',
      event: 'scan_cycle_started',
      message: `entry ${i}`,
    }
  }

  it('keeps more than 30 structured entries so the scan history is not truncated too aggressively', async () => {
    const existing = Array.from({ length: 40 }, (_, i) => entry(i))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'info', event: 'site_found', message: 'latest' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(41)
    expect(setCall.debugLog[0]).toEqual(existing[0])
    expect(setCall.debugLog[40]).toEqual(expect.objectContaining({
      level: 'info',
      event: 'site_found',
      message: 'latest',
      ts: expect.any(String),
    }))
  })

  it('keeps overnight-sized local logs instead of trimming at 500 entries', async () => {
    const existing = Array.from({ length: 800 }, (_, i) => entry(i))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: existing }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'debug', event: 'availability_result', message: 'latest' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(801)
    expect(setCall.debugLog[0]).toEqual(existing[0])
    expect(setCall.debugLog[800]).toEqual(expect.objectContaining({ event: 'availability_result' }))
  })

  it('keeps a larger local log history cap for long debug runs', async () => {
    expect(MAX_DEBUG_LOG_ENTRIES).toBe(100_000)
  })

  it('adds an ISO timestamp to each structured log entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T17:42:05-07:00'))
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: [] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({
      level: 'info',
      event: 'site_found',
      message: 'Found reservable site',
      parkName: 'Alice Lake',
      siteName: '67',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      foundAt: '2026-05-27T00:42:05.000Z',
      bookingDate: '2026-05-27T00:42:05.000Z',
      status: 'found',
    })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog[0]).toEqual({
      ts: '2026-05-27T00:42:05.000Z',
      level: 'info',
      event: 'site_found',
      message: 'Found reservable site',
      parkName: 'Alice Lake',
      siteName: '67',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      foundAt: '2026-05-27T00:42:05.000Z',
      bookingDate: '2026-05-27T00:42:05.000Z',
      status: 'found',
    })
  })

  it('drops old string logs before writing the first structured entry', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({ debugLog: ['old string log'] }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'warning', event: 'match_failed', message: 'Site unavailable' })

    const setCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(setCall.debugLog).toHaveLength(1)
    expect(setCall.debugLog[0]).toEqual(expect.objectContaining({
      level: 'warning',
      event: 'match_failed',
      message: 'Site unavailable',
    }))
  })

  it('serializes concurrent structured writes so log entries are not lost', async () => {
    let stored: Record<string, unknown> = { debugLog: [] }
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })

    await Promise.all([
      addDebugLog({ level: 'info', event: 'first_event', message: 'first' }),
      addDebugLog({ level: 'error', event: 'second_event', message: 'second' }),
    ])

    expect(stored.debugLog).toHaveLength(2)
    expect(stored.debugLog).toEqual([
      expect.objectContaining({ event: 'first_event', message: 'first' }),
      expect.objectContaining({ event: 'second_event', message: 'second' }),
    ])
  })

  it('queues server logs at or above the configured sync level', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
      debugLog: [],
      settings: { pollIntervalSeconds: 60, debugMode: false, theme: 'auto', logSyncMinLevel: 'warning' },
      [PENDING_SERVER_LOGS_KEY]: [],
    }))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())

    await addDebugLog({ level: 'info', event: 'info_event', message: 'ignored remotely' })
    await addDebugLog({ level: 'error', event: 'error_event', message: 'queued remotely' })

    const firstSet = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const secondSet = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(firstSet[PENDING_SERVER_LOGS_KEY]).toEqual([])
    expect(secondSet[PENDING_SERVER_LOGS_KEY]).toEqual([
      expect.objectContaining({ level: 'error', event: 'error_event' }),
    ])
  })
})
