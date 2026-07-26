import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEventCode, ProviderCode, RuntimeMessageCode } from '../../src/protocol'
import type { ExtensionRemoteConfig, Settings, Trip } from '../../src/types'

const chromeMock = chrome as any

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  savePayment: vi.fn(),
  addDebugLog: vi.fn(),
  getTrips: vi.fn(),
  updateTrip: vi.fn(),
  updateTripLastScannedAt: vi.fn(),
  isLoggedIn: vi.fn(),
  watchLoginChanges: vi.fn(),
  validateAuth: vi.fn(),
  notifyUserResult: vi.fn(),
  requestScanLease: vi.fn(),
  sendBookingPaymentEvent: vi.fn(),
  flushPendingServerLogs: vi.fn(),
  decryptParkPayment: vi.fn(),
  encryptParkPayment: vi.fn(),
  isPlainPaymentConfig: vi.fn(),
}))

let localStore: Record<string, unknown> = {}

vi.mock('../../src/storage', () => ({
  getStorage: mocks.getStorage,
  savePayment: mocks.savePayment,
  addDebugLog: mocks.addDebugLog,
  formatDateTime: (date: Date | string | number = new Date()) => new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }),
}))

vi.mock('../../src/tripStore', () => ({
  getTrips: mocks.getTrips,
  updateTrip: mocks.updateTrip,
  updateTripLastScannedAt: mocks.updateTripLastScannedAt,
}))

vi.mock('../../src/background/login', () => ({
  isLoggedIn: mocks.isLoggedIn,
  watchLoginChanges: mocks.watchLoginChanges,
}))

vi.mock('../../src/auth', () => ({
  validateAuth: mocks.validateAuth,
}))

vi.mock('../../src/serverApi', () => ({
  notifyUserResult: mocks.notifyUserResult,
  requestScanLease: mocks.requestScanLease,
  sendBookingPaymentEvent: mocks.sendBookingPaymentEvent,
}))

vi.mock('../../src/logSync', () => ({
  flushPendingServerLogs: mocks.flushPendingServerLogs,
}))

vi.mock('../../src/paymentCrypto', () => ({
  decryptParkPayment: mocks.decryptParkPayment,
  encryptParkPayment: mocks.encryptParkPayment,
  isPlainPaymentConfig: mocks.isPlainPaymentConfig,
}))

vi.mock('../../src/providers/bcparks', () => ({
  BCParksApiError: class BCParksApiError extends Error {
    status = 500
  },
  BCParksCooldownError: class BCParksCooldownError extends Error {
    cooldownUntil = Date.now() + 1000
  },
  BCParksProvider: class {
    onAvailabilityRaw?: unknown
    beforeAvailabilityMapRequest?: unknown
    getAvailability = vi.fn(async () => [])
  },
}))

vi.mock('../../src/providers/parksCanada', () => ({
  ParksCanadaApiError: class ParksCanadaApiError extends Error {
    status = 500
  },
  ParksCanadaCooldownError: class ParksCanadaCooldownError extends Error {
    cooldownUntil = Date.now() + 1000
  },
  ParksCanadaProvider: class {
    onAvailabilityRaw?: unknown
    beforeAvailabilityMapRequest?: unknown
    getAvailability = vi.fn(async () => [])
  },
}))

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    clientId: 'client-1',
    name: 'Trip 1',
    provider: 'bc_parks',
    parks: [{ id: 'park-1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'autopay',
    status: 'reserving',
    lastMatch: {
      provider: 'bc_parks',
      parkName: 'Park 1',
      sectionName: 'Main',
      siteName: 'A1',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
      resourceId: 'site-1',
      foundAt: '2026-06-05T11:00:00.000Z',
      reservedAt: '2026-06-05T11:10:00.000Z',
    },
    attempted: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeRemoteConfig(): ExtensionRemoteConfig {
  return {
    serverTime: '2026-06-05T12:00:00.000Z',
    channel: 'website',
    latestVersion: '0.1.1',
    minSupportedVersion: '0.1.0',
    rolloutState: 'available',
    pollIntervalSeconds: 60,
    maintenance: { enabled: false },
    logSyncMinLevel: 'info',
    scanPolicy: {
      minIntervalSeconds: 30,
      maxIntervalSeconds: 600,
      defaultIntervalSeconds: 60,
      allowedIntervalSeconds: [60],
      requestSpacingMs: 0,
      maxRequestsPerCycle: 20,
      maxRequestsPerTripPerCycle: 10,
      backoff: { errorBaseSeconds: 5, rateLimitBaseSeconds: 30, maxSeconds: 300 },
    },
    userLimits: { maxActiveTrips: 1 },
    featureFlags: {},
    extraConfig: {},
    releaseNote: null,
    updatedAt: '2026-06-05T12:00:00.000Z',
  }
}

function makeStorage(settings: Partial<Settings> = {}) {
  return {
    clientId: 'client-1',
    payment: null,
    settings: { pollIntervalSeconds: 60, theme: 'auto', ...settings },
    debugLog: [],
    auth: { token: 'token-1', user: { id: 'user-1', email: 'user@example.com', role: 'user' }, lastEmail: null },
    extensionConfig: makeRemoteConfig(),
  }
}

function makePendingBookingPaymentEvent(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      tripId: 'trip-1',
      clientEventId: 'client-event-1',
      idempotencyKey: 'pending-key-1',
      scanLease: 'lease-1',
      providerCode: ProviderCode.bcParks,
      confirmationNumber: 'BCIN123B1',
      parkName: 'Park 1',
      sectionName: 'Main',
      siteName: 'A1',
      resourceId: 'site-1',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      paidAt: '2026-06-05T12:00:00.000Z',
      bookingUrl: 'https://camping.bcparks.ca/create-booking/confirmation/cart/transaction',
      ...overrides,
    },
    tripName: 'Trip 1',
    queuedAt: '2026-06-05T12:00:00.000Z',
    attempts: 0,
  }
}

describe('background booking payment reporting', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'))
    mocks.getStorage.mockReset().mockResolvedValue(makeStorage())
    mocks.getTrips.mockReset()
    mocks.updateTrip.mockReset().mockResolvedValue(undefined)
    mocks.updateTripLastScannedAt.mockReset().mockResolvedValue(undefined)
    mocks.addDebugLog.mockReset().mockResolvedValue(undefined)
    mocks.isLoggedIn.mockReset().mockResolvedValue(true)
    mocks.watchLoginChanges.mockReset()
    mocks.validateAuth.mockReset().mockResolvedValue(true)
    mocks.notifyUserResult.mockReset().mockResolvedValue({ ok: true, emailSent: false })
    mocks.requestScanLease.mockReset().mockResolvedValue({
      lease: 'lease-from-server',
      leaseId: 'lease-id',
      expiresAt: '2026-06-05T14:00:00.000Z',
      tripHash: 'hash',
    })
    mocks.sendBookingPaymentEvent.mockReset().mockResolvedValue({
      ok: true,
      bookingPaymentEventId: 7,
      chargeStatus: 'charged',
      pointTransactionId: 8,
      balanceAfter: 900,
      duplicate: false,
    })
    mocks.flushPendingServerLogs.mockReset().mockResolvedValue(undefined)
    mocks.decryptParkPayment.mockReset()
    mocks.encryptParkPayment.mockReset()
    mocks.isPlainPaymentConfig.mockReset().mockReturnValue(false)

    localStore = {}
    chromeMock.storage.local.get.mockReset().mockImplementation((keys: string | string[] | null, cb: (items: Record<string, unknown>) => void) => {
      if (Array.isArray(keys)) {
        cb(Object.fromEntries(keys.map(key => [key, localStore[key]])))
        return
      }
      if (typeof keys === 'string') {
        cb({ [keys]: localStore[keys] })
        return
      }
      cb(localStore)
    })
    chromeMock.storage.local.set.mockReset().mockImplementation((data: Record<string, unknown>, cb?: () => void) => {
      localStore = { ...localStore, ...data }
      cb?.()
    })
    chromeMock.storage.local.remove.mockReset().mockImplementation((keys: string | string[], cb?: () => void) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localStore[key]
      cb?.()
    })
    chromeMock.alarms.clear.mockReset().mockImplementation((_name: string, cb?: (wasCleared: boolean) => void) => cb?.(true))
    chromeMock.alarms.create.mockReset()
    chromeMock.alarms.get.mockReset().mockImplementation((_name: string, cb?: (alarm: chrome.alarms.Alarm) => void) => cb?.({ name: 'scan', periodInMinutes: 1 } as chrome.alarms.Alarm))
    chromeMock.notifications.create.mockReset().mockImplementation((_id: string, _opts: chrome.notifications.NotificationOptions, cb?: (notificationId: string) => void) => cb?.('notification-1'))
    chromeMock.tabs.create.mockReset()
    chromeMock.tabs.update.mockReset()
    chromeMock.runtime.onMessage.addListener.mockReset()
    chromeMock.runtime.onMessageExternal.addListener.mockReset()
    chromeMock.action.onClicked.addListener.mockReset()
    chromeMock.tabs.onRemoved.addListener.mockReset()
    chromeMock.storage.onChanged.addListener.mockReset()
    chromeMock.alarms.onAlarm.addListener.mockReset()
    chromeMock.notifications.onClicked.addListener.mockReset()
    chromeMock.runtime.onInstalled.addListener.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not clear the reservation target when auto-reserve only holds the site', async () => {
    const trip = makeTrip({ mode: 'reserve' })
    mocks.getTrips.mockResolvedValue([trip])

    await import('../../src/background/index')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0]
    listener({ t: RuntimeMessageCode.bookingReserved, tripId: trip.id, scanLease: 'lease-1' }, { tab: { id: 123 } })

    await vi.waitFor(() => expect(mocks.updateTrip).toHaveBeenCalledWith(trip.id, expect.objectContaining({
      status: 'reserved',
    })))
    expect(chromeMock.storage.local.remove).not.toHaveBeenCalledWith('campOspreyTarget')
    expect(mocks.sendBookingPaymentEvent).not.toHaveBeenCalled()
  })

  it('reports confirmed payment with scan lease so the server can charge points', async () => {
    const trip = makeTrip()
    mocks.getTrips.mockResolvedValue([trip])

    await import('../../src/background/index')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0]
    listener({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId: trip.id,
      confirmationNumber: 'BCIN123B1',
      bookingUrl: 'https://camping.bcparks.ca/create-booking/confirmation/cart/transaction',
      paidAt: '2026-06-05T12:00:00.000Z',
      scanLease: 'lease-1',
    }, { tab: { id: 123 } })

    await vi.waitFor(() => expect(mocks.sendBookingPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      tripId: trip.id,
      scanLease: 'lease-1',
      providerCode: ProviderCode.bcParks,
      confirmationNumber: 'BCIN123B1',
      parkName: 'Park 1',
      sectionName: 'Main',
      siteName: 'A1',
      resourceId: 'site-1',
      checkIn: '2026-07-04',
      checkOut: '2026-07-05',
      paidAt: '2026-06-05T12:00:00.000Z',
      bookingUrl: 'https://camping.bcparks.ca/create-booking/confirmation/cart/transaction',
    })))
    expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: LogEventCode.bookingPaymentEventReported,
      status: 'paid',
      metadata: expect.objectContaining({
        bookingPaymentEventId: 7,
        chargeStatus: 'charged',
        pointTransactionId: 8,
        balanceAfter: 900,
      }),
    }), { forceServerSync: true })
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('campOspreyTarget')
  })

  it('does not report a point charge when paid confirmation is missing match metadata', async () => {
    const trip = makeTrip({ lastMatch: null })
    mocks.getTrips.mockResolvedValue([trip])

    await import('../../src/background/index')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0]
    listener({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId: trip.id,
      confirmationNumber: 'BCIN123B1',
      paidAt: '2026-06-05T12:00:00.000Z',
      scanLease: 'lease-1',
    }, { tab: { id: 123 } })

    await vi.waitFor(() => expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: LogEventCode.bookingPaymentEventMissingMetadata,
      message: 'Booking was paid, but matched site metadata was missing; cannot report point charge event',
    }), { forceServerSync: true }))
    expect(mocks.sendBookingPaymentEvent).not.toHaveBeenCalled()
  })

  it('keeps paid events queued when lease validation or the server charge fails', async () => {
    mocks.sendBookingPaymentEvent.mockRejectedValue(new Error('stale_scan_lease'))
    const trip = makeTrip()
    mocks.getTrips.mockResolvedValue([trip])

    await import('../../src/background/index')
    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0]
    listener({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId: trip.id,
      confirmationNumber: 'BCIN123B1',
      paidAt: '2026-06-05T12:00:00.000Z',
      scanLease: 'lease-1',
    }, { tab: { id: 123 } })

    await vi.waitFor(() => expect(mocks.addDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: LogEventCode.bookingPaymentEventReportFailed,
      error: 'stale_scan_lease',
      metadata: expect.objectContaining({ attempts: 1 }),
    }), { forceServerSync: true }))
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      pendingBookingPaymentEvents: expect.any(Object),
    }), expect.any(Function))
  })

  it('flushes queued paid events on service-worker startup', async () => {
    localStore.pendingBookingPaymentEvents = {
      'pending-key-1': makePendingBookingPaymentEvent(),
    }

    await import('../../src/background/index')

    await vi.waitFor(() => expect(mocks.sendBookingPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'pending-key-1',
      scanLease: 'lease-1',
      providerCode: ProviderCode.bcParks,
      confirmationNumber: 'BCIN123B1',
    })))
    expect(localStore.pendingBookingPaymentEvents).toEqual({})
  })

  it('flushes queued paid events when server login recovers', async () => {
    mocks.getTrips.mockResolvedValue([])

    await import('../../src/background/index')
    await Promise.resolve()
    localStore.pendingBookingPaymentEvents = {
      'pending-key-1': makePendingBookingPaymentEvent(),
    }
    const loginCallback = mocks.watchLoginChanges.mock.calls[0][0]

    await loginCallback(true)

    await vi.waitFor(() => expect(mocks.sendBookingPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'pending-key-1',
      scanLease: 'lease-1',
    })))
  })
})
