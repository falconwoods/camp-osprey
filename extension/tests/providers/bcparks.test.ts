import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BCParksApiError, BCParksCooldownError, BCParksProvider } from '../../src/providers/bcparks'

function mockFetch(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(responses).find(k => url.includes(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return { ok: true, json: async () => responses[key] }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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
      '/api/availability/map': {
        resourceAvailabilities: {
          'res-1': [{ availability: 0 }],
          'res-2': [{ availability: 0 }],
        },
      },
    })
    chrome.storage.session.get.mockImplementation((_key: string, cb: (r: Record<string, unknown>) => void) => cb({}))
    chrome.storage.session.set.mockImplementation((_data: unknown, cb?: () => void) => cb?.())
  })

  afterEach(() => {
    vi.useRealTimers()
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
      '/api/availability/map': { resourceAvailabilities: { 'res-1': [{ availability: 0 }] } },
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
      '/api/availability/map': { resourceAvailabilities: { 'res-1': [{ availability: 1 }] } },
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })
    expect(sites).toHaveLength(0)
  })

  it('excludes sites that BC Parks map availability says fail the selected filters', async () => {
    const fetchMock = mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'H10', description: 'Parking for single vehicle only- no trailers. Carry equipment to site.' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Gold Creek' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/map': { resourceAvailabilities: { 'res-1': [{ availability: 5 }] } },
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: true, noDouble: false })
    expect(sites).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/availability/map'), expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('"attributeDefinitionId":-32764')), expect.any(Object))
  })

  it('uses map-level availability instead of checking every site individually', async () => {
    const fetchMock = mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
        'res-2': { localizedValues: [{ name: 'Site A2', description: '' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }, { resourceId: 'res-2' }] }],
      '/api/availability/map': { resourceAvailabilities: { 'res-2': [{ availability: 0 }] } },
    })
    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })

    expect(sites.map(s => s.resourceId)).toEqual(['res-2'])
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/availability/resourcestatus'), expect.any(Object))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/availability/resourcedailyavailability'), expect.any(Object))
  })

  it('passes the abort signal to every fetch needed for availability checks', async () => {
    const fetchMock = mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/map': { resourceAvailabilities: { 'res-1': [{ availability: 0 }] } },
    })
    const controller = new AbortController()
    const provider = new BCParksProvider()

    await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false }, controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/cart'), expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/resourcelocation/resources'), expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/maps'), expect.objectContaining({ signal: controller.signal }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/availability/map'), expect.objectContaining({ signal: controller.signal }))
  })

  it('waits for raw availability logging before resolving results', async () => {
    mockFetch({
      '/api/cart': cartResponse,
      '/api/resourcelocation/resources': {
        'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
      },
      '/api/maps': [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
      '/api/availability/map': { resourceAvailabilities: { 'res-1': [{ availability: 0 }] } },
    })
    const provider = new BCParksProvider()
    const events: string[] = []
    let releaseRawLog!: () => void
    provider.onAvailabilityRaw = async () => {
      events.push('raw started')
      await new Promise<void>(resolve => { releaseRawLog = resolve })
      events.push('raw logged')
    }

    const availabilityPromise = provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })
    await vi.waitFor(() => expect(events).toEqual(['raw started']))
    let resolved = false
    availabilityPromise.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)

    releaseRawLog()
    const sites = await availabilityPromise
    events.push(`resolved ${sites.length}`)

    expect(events).toEqual(['raw started', 'raw logged', 'resolved 1'])
  })

  it('refreshes cart and retries map availability once after a 400', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/cart')) {
        const cartNumber = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/cart')).length
        return {
          ok: true,
          json: async () => ({
            cartUid: `cart-${cartNumber}`,
            newTransaction: { cartTransactionUid: `tx-${cartNumber}` },
          }),
        }
      }
      if (url.includes('/api/resourcelocation/resources')) {
        return {
          ok: true,
          json: async () => ({
            'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
          }),
        }
      }
      if (url.includes('/api/maps')) {
        return {
          ok: true,
          json: async () => [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
        }
      }
      if (url.includes('/api/availability/map')) {
        const mapCallNumber = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/availability/map')).length
        if (mapCallNumber === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ title: 'Bad Request', status: 400 }),
          }
        }
        return {
          ok: true,
          json: async () => ({ resourceAvailabilities: { 'res-1': [{ availability: 0 }] } }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new BCParksProvider()
    const sites = await provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false })

    expect(sites).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/cart'))).toHaveLength(2)
    const mapUrls = fetchMock.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/api/availability/map'))
    expect(mapUrls).toHaveLength(2)
    expect(mapUrls[0]).toContain('cartUid=cart-1')
    expect(mapUrls[1]).toContain('cartUid=cart-2')
  })

  it('enters cooldown after repeated map availability 400s and skips network during cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T20:00:00Z'))
    const sessionStorage: Record<string, unknown> = {}
    chrome.storage.session.get.mockImplementation((key: string, cb: (r: Record<string, unknown>) => void) => {
      cb({ [key]: sessionStorage[key] })
    })
    chrome.storage.session.set.mockImplementation((data: Record<string, unknown>, cb?: () => void) => {
      Object.assign(sessionStorage, data)
      cb?.()
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/cart')) {
        return {
          ok: true,
          json: async () => ({ cartUid: crypto.randomUUID(), newTransaction: { cartTransactionUid: crypto.randomUUID() } }),
        }
      }
      if (url.includes('/api/resourcelocation/resources')) {
        return {
          ok: true,
          json: async () => ({
            'res-1': { localizedValues: [{ name: 'Site A1', description: '' }], linkedResources: [] },
          }),
        }
      }
      if (url.includes('/api/maps')) {
        return {
          ok: true,
          json: async () => [{ mapId: 1, localizedValues: [{ title: 'Main' }], mapResources: [{ resourceId: 'res-1' }] }],
        }
      }
      if (url.includes('/api/availability/map')) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ title: 'Bad Request', status: 400 }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new BCParksProvider()
    await expect(provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false }))
      .rejects.toBeInstanceOf(BCParksApiError)

    fetchMock.mockClear()
    await expect(provider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false }))
      .rejects.toBeInstanceOf(BCParksCooldownError)
    expect(fetchMock).not.toHaveBeenCalled()

    const restartedProvider = new BCParksProvider()
    await expect(restartedProvider.getAvailability('42', '2026-07-04', '2026-07-05', { noWalkin: false, noDouble: false }))
      .rejects.toBeInstanceOf(BCParksCooldownError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
