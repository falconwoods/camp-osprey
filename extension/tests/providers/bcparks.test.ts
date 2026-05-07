import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BCParksProvider } from '../../src/providers/bcparks'

function mockFetch(responses: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = Object.keys(responses).find(k => url.includes(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return { ok: true, json: async () => responses[key] }
  }))
}

const cartResponse = {
  cartUid: 'cart-123',
  newTransaction: { cartTransactionUid: 'tx-456', terminalLocationId: -2147483590 },
}

describe('searchParks', () => {
  it('returns matching parks filtered by query', async () => {
    mockFetch({
      '/api/resourceLocation': [
        { resourceLocationId: 1, localizedValues: [{ shortName: 'Garibaldi', fullName: 'Garibaldi Lake' }] },
        { resourceLocationId: 2, localizedValues: [{ shortName: 'Alice Lake', fullName: 'Alice Lake Park' }] },
      ],
    })
    const provider = new BCParksProvider()
    const results = await provider.searchParks('garib')
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ id: '1', name: 'Garibaldi' })
  })

  it('returns all parks for empty query', async () => {
    mockFetch({
      '/api/resourceLocation': [
        { resourceLocationId: 1, localizedValues: [{ shortName: 'Garibaldi', fullName: 'Garibaldi Lake' }] },
      ],
    })
    const provider = new BCParksProvider()
    const results = await provider.searchParks('')
    expect(results).toHaveLength(1)
  })
})

describe('getAvailability', () => {
  beforeEach(() => {
    mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
        'res-2': { localizedValues: [{ name: 'Site A2', description: '' }], linkedResources: [] },
      },
      '/api/maps': [
        {
          mapId: 100,
          localizedValues: [{ title: 'Main Loop' }],
          mapResources: [{ resourceId: 'res-1' }, { resourceId: 'res-2' }],
        },
      ],
      '/api/availability/resourcedailyavailability': [{ availability: 0 }],
    })
    chrome.storage.session.get.mockImplementation((_key: string, cb: (r: Record<string, unknown>) => void) => cb({}))
    chrome.storage.session.set.mockImplementation((_data: unknown, cb?: () => void) => cb?.())
  })

  it('returns available sites', async () => {
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-06', { noWalkin: false, noDouble: false })
    expect(sites.length).toBeGreaterThan(0)
    expect(sites[0].campgroundId).toBe('42')
    expect(sites[0].checkIn).toBe('2026-07-04')
  })

  it('excludes walk-in sites when noWalkin is true', async () => {
    mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Walk-in Site', description: 'first-come first-served' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Walk-in Area' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/resourcedailyavailability': [{ availability: 0 }],
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: true, noDouble: false })
    expect(sites).toHaveLength(0)
  })

  it('returns empty when all nights unavailable', async () => {
    mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/resourcedailyavailability': [{ availability: 1 }],
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })
    expect(sites).toHaveLength(0)
  })
})
