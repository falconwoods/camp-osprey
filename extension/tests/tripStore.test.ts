import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAuth } from '../src/storage'
import { deleteTrip, getTrips, normalizeTrip, saveTrip, updateTrip } from '../src/tripStore'
import type { Trip } from '../src/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    clientId: 'client-1',
    name: 'Test Trip',
    parks: [{ id: 'park-1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'notify',
    status: 'idle',
    lastMatch: null,
    attempted: [],
    createdAt: Date.parse('2026-06-01T10:00:00.000Z'),
    updatedAt: Date.parse('2026-06-01T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

describe('tripStore', () => {
  let stored: Record<string, unknown>

  beforeEach(async () => {
    stored = { clientId: 'client-1' }
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      if (Array.isArray(keys)) {
        cb(Object.fromEntries(keys.map(key => [key, stored[key]])))
        return
      }
      if (typeof keys === 'string') {
        cb({ [keys]: stored[keys] })
        return
      }
      cb(stored)
    })
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })
    chrome.runtime.sendMessage = vi.fn()
    global.fetch = vi.fn()
    await saveAuth({ token: 'tok', user: { id: 'u1', email: 'user@example.com', role: 'user' }, lastEmail: null })
  })

  it('normalizes server date strings into extension timestamps', () => {
    const trip = normalizeTrip({
      ...makeTrip(),
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-02T12:00:00.000Z',
      deletedAt: null,
    })

    expect(trip.createdAt).toBe(Date.parse('2026-06-01T10:00:00.000Z'))
    expect(trip.updatedAt).toBe(Date.parse('2026-06-02T12:00:00.000Z'))
    expect(trip.deletedAt).toBeNull()
  })

  it('loads active trips from the server and filters deleted rows defensively', async () => {
    const active = makeTrip({ id: 'active' })
    const deleted = makeTrip({ id: 'deleted', deletedAt: Date.now() })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
      { ...active, createdAt: new Date(active.createdAt).toISOString(), updatedAt: new Date(active.updatedAt!).toISOString() },
      { ...deleted, deletedAt: new Date(deleted.deletedAt!).toISOString() },
    ]), { status: 200 }))

    const trips = await getTrips()

    expect(fetch).toHaveBeenCalledWith('https://campsoon.com/api/trips', expect.objectContaining({
      method: 'GET',
    }))
    expect(trips.map(trip => trip.id)).toEqual(['active'])
  })

  it('returns no trips without auth instead of reading local trip storage', async () => {
    await saveAuth({ token: null, user: null, lastEmail: null })

    await expect(getTrips()).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(chrome.storage.local.get.mock.calls.flatMap(call => call[0])).not.toContain('trips')
  })

  it('upserts trips to the server without writing a local trips key', async () => {
    const trip = makeTrip()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ...trip,
      updatedAt: new Date(trip.updatedAt!).toISOString(),
    }), { status: 200 }))

    await saveTrip(trip)

    expect(fetch).toHaveBeenCalledWith('https://campsoon.com/api/trips/trip-1', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('"id":"trip-1"'),
    }))
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ trips: expect.anything() }), expect.any(Function))
  })

  it('merges updates by loading the server trip before upserting', async () => {
    const trip = makeTrip()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([trip]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...trip, status: 'scanning' }), { status: 200 }))

    const updated = await updateTrip('trip-1', { status: 'scanning' })

    expect(updated.status).toBe('scanning')
    expect(fetch).toHaveBeenLastCalledWith('https://campsoon.com/api/trips/trip-1', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('"status":"scanning"'),
    }))
  })

  it('soft-deletes trips on the server', async () => {
    const trip = makeTrip()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await deleteTrip(trip)

    expect(fetch).toHaveBeenCalledWith('https://campsoon.com/api/trips/trip-1', expect.objectContaining({
      method: 'DELETE',
      body: expect.stringContaining('"clientId":"client-1"'),
    }))
  })
})
