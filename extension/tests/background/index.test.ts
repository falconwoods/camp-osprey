import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AvailableSite, StorageData, Trip } from '../../src/types'

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  updateTrip: vi.fn(),
  addDebugLog: vi.fn(),
  isLoggedIn: vi.fn(),
  validateAuth: vi.fn(),
  watchLoginChanges: vi.fn(),
  getAvailability: vi.fn(),
}))

vi.mock('../../src/storage', () => ({
  getStorage: mocks.getStorage,
  updateTrip: mocks.updateTrip,
  addDebugLog: mocks.addDebugLog,
}))

vi.mock('../../src/background/login', () => ({
  isLoggedIn: mocks.isLoggedIn,
  watchLoginChanges: mocks.watchLoginChanges,
}))

vi.mock('../../src/auth', () => ({
  validateAuth: mocks.validateAuth,
}))

vi.mock('../../src/providers/bcparks', () => ({
  BCParksProvider: class {
    onAvailabilityRaw?: unknown
    getAvailability = mocks.getAvailability
  },
}))

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Trip 1',
    parks: [{ id: 'park-1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify',
    status: 'scanning',
    lastMatch: null,
    attempted: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeStorage(trips: Trip[]): StorageData {
  return {
    trips,
    payment: null,
    settings: { pollIntervalSeconds: 60, debugMode: false, theme: 'auto' },
    debugLog: [],
    auth: { token: null, user: null, lastEmail: null },
  }
}

function makeSite(overrides: Partial<AvailableSite> = {}): AvailableSite {
  return {
    resourceId: 'site-1',
    campgroundId: 'park-1',
    campgroundName: 'Park 1',
    sectionName: 'Main',
    siteName: 'A1',
    mapId: 'map-1',
    isWalkin: false,
    isDouble: false,
    checkIn: '2026-07-04',
    checkOut: '2026-07-05',
    availableCount: 2,
    ...overrides,
  }
}

describe('background scanner scheduling', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.getStorage.mockReset()
    mocks.updateTrip.mockReset().mockResolvedValue(undefined)
    mocks.addDebugLog.mockReset().mockResolvedValue(undefined)
    mocks.isLoggedIn.mockReset().mockResolvedValue(true)
    mocks.validateAuth.mockReset().mockResolvedValue(true)
    mocks.watchLoginChanges.mockReset()
    mocks.getAvailability.mockReset().mockResolvedValue([])
    chrome.runtime.onMessage.addListener.mockClear()
    chrome.runtime.getURL = vi.fn(() => 'chrome-extension://test/icons/icon48.png')
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({}))
    chrome.storage.local.set.mockImplementation((_data, cb) => cb?.())
    chrome.alarms.clear.mockImplementation((_name, cb) => cb?.(true))
    chrome.notifications.create.mockImplementation((_id, _opts, cb) => cb?.('notif-1'))
  })

  it('SCAN_NOW scans only the requested trip when tripId is provided', async () => {
    const trips = [
      makeTrip({ id: 'trip-1', name: 'Trip 1', parks: [{ id: 'park-1', name: 'Park 1' }] }),
      makeTrip({ id: 'trip-2', name: 'Trip 2', parks: [{ id: 'park-2', name: 'Park 2' }] }),
    ]
    mocks.getStorage.mockResolvedValue(makeStorage(trips))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: 'trip-2' })

    await vi.waitFor(() => expect(mocks.getAvailability).toHaveBeenCalledTimes(1))
    expect(mocks.getAvailability.mock.calls[0][0]).toBe('park-2')
  })

  it('queues SCAN_NOW when a scan is already running', async () => {
    const trips = [
      makeTrip({ id: 'trip-1', name: 'Trip 1', parks: [{ id: 'park-1', name: 'Park 1' }] }),
      makeTrip({ id: 'trip-2', name: 'Trip 2', parks: [{ id: 'park-2', name: 'Park 2' }] }),
    ]
    mocks.getStorage.mockResolvedValue(makeStorage(trips))
    let finishFirstScan!: () => void
    mocks.getAvailability.mockImplementation(async (parkId: string) => {
      if (parkId === 'park-1') await new Promise<void>(resolve => { finishFirstScan = resolve })
      return []
    })

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: 'trip-1' })
    await vi.waitFor(() => expect(mocks.getAvailability).toHaveBeenCalledWith('park-1', expect.any(String), expect.any(String), expect.any(Object), expect.any(AbortSignal)))

    listener({ type: 'SCAN_NOW', tripId: 'trip-2' })
    await Promise.resolve()
    expect(mocks.getAvailability).not.toHaveBeenCalledWith('park-2', expect.any(String), expect.any(String), expect.any(Object), expect.any(AbortSignal))

    finishFirstScan()
    await vi.waitFor(() => expect(mocks.getAvailability).toHaveBeenCalledWith('park-2', expect.any(String), expect.any(String), expect.any(Object), expect.any(AbortSignal)))
  })

  it('sets hold and autopay trips to reserving when a match is opened', async () => {
    const trip = makeTrip({ mode: 'hold' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))
    mocks.getAvailability.mockResolvedValue([makeSite()])

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: trip.id })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(
      trip.id,
      expect.objectContaining({ status: 'reserving' })
    ))
  })

  it('skips scanning when server auth is invalid', async () => {
    const trip = makeTrip()
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))
    mocks.validateAuth.mockResolvedValue(false)

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: trip.id })

    await vi.waitFor(() => expect(chrome.notifications.create).toHaveBeenCalled())
    expect(mocks.getAvailability).not.toHaveBeenCalled()
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'Sign In Required' }),
      expect.any(Function)
    )
  })

  it('marks hold success as reserved', async () => {
    const trip = makeTrip({ mode: 'hold', status: 'reserving' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_RESERVED', tripId: trip.id })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, { status: 'reserved' }))
  })

  it('marks confirmed autopay booking as paid', async () => {
    const trip = makeTrip({ mode: 'autopay', status: 'reserving' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_CONFIRMED', tripId: trip.id, confirmationNumber: 'ABC123' })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, { status: 'paid' }))
  })

  it('marks booking failure as failed', async () => {
    const trip = makeTrip({ mode: 'autopay', status: 'reserving' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_FAILED', tripId: trip.id, error: 'card declined' })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, { status: 'failed' }))
  })
})
