import { describe, it, expect, beforeEach } from 'vitest'
import { addDebugLog, getStorage, saveTrips, updateTrip } from '../src/storage'
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
