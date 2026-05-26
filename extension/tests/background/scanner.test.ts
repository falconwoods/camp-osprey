import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scanTrip } from '../../src/background/scanner'
import type { Trip, AvailableSite } from '../../src/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1', name: 'Test', parks: [{ id: 'p1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-06' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify', status: 'scanning', lastMatch: null,
    attempted: [], createdAt: Date.now(),
    ...overrides,
  }
}

function makeSite(overrides: Partial<AvailableSite> = {}): AvailableSite {
  return {
    resourceId: 'res-1', campgroundId: 'p1', campgroundName: 'Park 1',
    sectionName: 'Main', siteName: 'A1', mapId: '100',
    isWalkin: false, isDouble: false,
    checkIn: '2026-07-04', checkOut: '2026-07-06',
    ...overrides,
  }
}

describe('scanTrip', () => {
  const mockGetAvailability = vi.fn()

  beforeEach(() => {
    mockGetAvailability.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when no sites available', async () => {
    mockGetAvailability.mockResolvedValue([])
    const result = await scanTrip(makeTrip(), mockGetAvailability)
    expect(result).toBeNull()
  })

  it('returns first match when site is available', async () => {
    const site = makeSite()
    mockGetAvailability.mockResolvedValue([site])
    const result = await scanTrip(makeTrip(), mockGetAvailability)
    expect(result).toMatchObject({ resourceId: 'res-1', campgroundName: 'Park 1' })
  })

  it('keeps the available site count on the selected match', async () => {
    mockGetAvailability.mockResolvedValue([
      makeSite({ resourceId: 'res-1', siteName: 'A1' }),
      makeSite({ resourceId: 'res-2', siteName: 'A2' }),
      makeSite({ resourceId: 'res-3', siteName: 'A3' }),
    ])

    const result = await scanTrip(makeTrip(), mockGetAvailability)

    expect(result).toMatchObject({ resourceId: 'res-1', availableCount: 3 })
  })

  it('skips already-attempted park/date combinations', async () => {
    mockGetAvailability.mockResolvedValue([makeSite()])
    const trip = makeTrip({ attempted: ['p1|2026-07-04|2026-07-06'] })
    const result = await scanTrip(trip, mockGetAvailability)
    expect(result).toBeNull()
    expect(mockGetAvailability).not.toHaveBeenCalled()
  })

  it('checks parks in priority order', async () => {
    const calls: string[] = []
    mockGetAvailability.mockImplementation(async (id: string) => { calls.push(id); return [] })
    const trip = makeTrip({ parks: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] })
    await scanTrip(trip, mockGetAvailability)
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('returns first match and stops checking further parks', async () => {
    let callCount = 0
    mockGetAvailability.mockImplementation(async () => { callCount++; return callCount === 1 ? [makeSite()] : [] })
    const trip = makeTrip({ parks: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] })
    await scanTrip(trip, mockGetAvailability)
    expect(callCount).toBe(1)
  })

  it('stops before the next park/date check when cancellation is requested', async () => {
    let shouldContinue = true
    mockGetAvailability.mockImplementation(async () => {
      shouldContinue = false
      return []
    })
    const trip = makeTrip({ parks: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] })
    const result = await scanTrip(trip, mockGetAvailability, () => shouldContinue)
    expect(result).toBeNull()
    expect(mockGetAvailability).toHaveBeenCalledTimes(1)
  })

  it('waits briefly between availability checks for separate date windows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00'))
    mockGetAvailability.mockResolvedValue([])
    const trip = makeTrip({
      dateRanges: [
        { type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' },
        { type: 'specific', checkIn: '2026-07-11', checkOut: '2026-07-12' },
      ],
    })

    const scanPromise = scanTrip(trip, mockGetAvailability)
    await vi.waitFor(() => expect(mockGetAvailability).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(199)
    expect(mockGetAvailability).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(mockGetAvailability).toHaveBeenCalledTimes(2))
    await expect(scanPromise).resolves.toBeNull()
  })
})
