import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AvailableSite, StorageData, Trip } from '../../src/types'

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  updateTrip: vi.fn(),
  addDebugLog: vi.fn(),
  isLoggedIn: vi.fn(),
  validateAuth: vi.fn(),
  sendTripResult: vi.fn(),
  watchLoginChanges: vi.fn(),
  getAvailability: vi.fn(),
}))

vi.mock('../../src/storage', () => ({
  getStorage: mocks.getStorage,
  updateTrip: mocks.updateTrip,
  addDebugLog: mocks.addDebugLog,
  formatDateTime: (date: Date | string | number = new Date()) => new Date(date).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }),
}))

vi.mock('../../src/background/login', () => ({
  isLoggedIn: mocks.isLoggedIn,
  watchLoginChanges: mocks.watchLoginChanges,
}))

vi.mock('../../src/auth', () => ({
  validateAuth: mocks.validateAuth,
}))

vi.mock('../../src/serverApi', () => ({
  sendTripResult: mocks.sendTripResult,
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
    mocks.sendTripResult.mockReset().mockResolvedValue({ ok: true, emailSent: false })
    mocks.watchLoginChanges.mockReset()
    mocks.getAvailability.mockReset().mockResolvedValue([])
    chrome.runtime.onMessage.addListener.mockClear()
    chrome.notifications.onClicked.addListener.mockClear()
    chrome.tabs.create.mockClear()
    chrome.notifications.create.mockClear()
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

  it('does not reopen a reservation tab or resend the match notification for the same active match', async () => {
    const trip = makeTrip({ mode: 'hold' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))
    mocks.getAvailability.mockResolvedValue([makeSite()])

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: trip.id })

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(chrome.notifications.create).toHaveBeenCalledTimes(1))

    listener({ type: 'SCAN_NOW', tripId: trip.id })
    await vi.waitFor(() => expect(mocks.getAvailability).toHaveBeenCalledTimes(2))

    expect(chrome.tabs.create).toHaveBeenCalledTimes(1)
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.stringContaining('already handling active match'))
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

  it('includes the discovery time in match notifications', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T17:42:05-07:00'))
    const trip = makeTrip({ mode: 'hold' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))
    mocks.getAvailability.mockResolvedValue([makeSite()])

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'SCAN_NOW', tripId: trip.id })

    await vi.waitFor(() => expect(chrome.notifications.create).toHaveBeenCalledTimes(1))
    const notificationOptions = chrome.notifications.create.mock.calls[0][1]
    expect(notificationOptions.message).toContain('Found:')
    expect(notificationOptions.message).toContain('May 26, 2026')
    vi.useRealTimers()
  })

  it('marks hold success as reserved', async () => {
    const trip = makeTrip({ mode: 'hold', status: 'reserving' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_RESERVED', tripId: trip.id })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, { status: 'reserved' }))
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.stringContaining('Reservation held'))
  })

  it('reports hold success to the server for email notification', async () => {
    const trip = makeTrip({
      mode: 'hold',
      status: 'reserving',
      lastMatch: {
        parkName: 'Park 1',
        sectionName: 'Main',
        siteName: 'A1',
        checkIn: '2026-07-04',
        checkOut: '2026-07-05',
        bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
        resourceId: 'site-1',
        foundAt: '2026-05-26T17:00:00.000Z',
      },
    })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_RESERVED', tripId: trip.id })

    await vi.waitFor(() => expect(mocks.sendTripResult).toHaveBeenCalledWith(trip.id, {
      outcome: 'hold_placed',
      matchedSite: expect.objectContaining({
        parkName: 'Park 1',
        sectionName: 'Main',
        siteName: 'A1',
        checkIn: '2026-07-04',
        checkOut: '2026-07-05',
        bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
        resourceId: 'site-1',
      }),
      tripSnapshot: expect.objectContaining({
        name: 'Trip 1',
        parks: trip.parks,
        dateRanges: trip.dateRanges,
        filters: trip.filters,
        mode: 'hold',
        status: 'reserved',
        attempted: [],
      }),
    }))
  })

  it('notifies and logs server reporting details when a site is reserved', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T18:10:00-07:00'))
    mocks.sendTripResult.mockResolvedValue({ ok: true, emailSent: true })
    const trip = makeTrip({
      mode: 'hold',
      status: 'reserving',
      lastMatch: {
        parkName: 'Park 1',
        sectionName: 'Main',
        siteName: 'A1',
        checkIn: '2026-07-04',
        checkOut: '2026-07-05',
        bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
        resourceId: 'site-1',
        foundAt: '2026-05-26T17:00:00.000Z',
      },
    })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_RESERVED', tripId: trip.id })

    await vi.waitFor(() => expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: 'Site Reserved',
        message: expect.stringContaining('Park 1'),
        requireInteraction: true,
      }),
      expect.any(Function),
    ))
    const notificationOptions = chrome.notifications.create.mock.calls[0][1]
    expect(notificationOptions.message).toContain('Main')
    expect(notificationOptions.message).toContain('Site A1')
    expect(notificationOptions.message).toContain('2026-07-04 → 2026-07-05')
    expect(notificationOptions.message).toContain('Reserved:')
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.stringContaining('Reporting reservation result to server'))
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.stringContaining('Reservation email sent'))
    vi.useRealTimers()
  })

  it('marks confirmed autopay booking as paid', async () => {
    const trip = makeTrip({ mode: 'autopay', status: 'reserving' })
    mocks.getStorage.mockResolvedValue(makeStorage([trip]))

    await import('../../src/background/index')
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ type: 'BOOKING_CONFIRMED', tripId: trip.id, confirmationNumber: 'ABC123' })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, { status: 'paid' }))
    await vi.waitFor(() => expect(chrome.notifications.create).toHaveBeenCalled())
    const notificationOptions = chrome.notifications.create.mock.calls[0][1]
    expect(notificationOptions.message).toContain('Paid:')
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.stringContaining('Booking paid'))
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
