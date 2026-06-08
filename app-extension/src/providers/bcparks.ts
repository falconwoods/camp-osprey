import type { AvailableSite, Filters, Park } from '../types'

const BASE = 'https://camping.bcparks.ca'
const CONCURRENCY = 3
const AVAILABILITY_400_COOLDOWN_MS = 5 * 60 * 1000
const AVAILABILITY_400_COOLDOWN_KEY = 'availability_400_cooldown_until'

export class BCParksApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`BC Parks API error ${status}: ${path}`)
    this.name = 'BCParksApiError'
  }
}

export class BCParksCooldownError extends Error {
  constructor(public readonly cooldownUntil: number) {
    super(`BC Parks API cooling down until ${new Date(cooldownUntil).toLocaleTimeString()}`)
    this.name = 'BCParksCooldownError'
  }
}

type AvailabilityMapResponse = {
  resourceAvailabilities?: Record<string, Array<{ availability?: number; processedAvailability?: number }>>
}

function buildFilterData(filters: Filters): string {
  const filterData = []
  if (filters.noWalkin) {
    filterData.push({
      attributeDefinitionId: -32764,
      attributeType: 0,
      enumValues: [1],
      attributeDefinitionDecimalValue: 0,
      filterStrategy: 1,
    })
  }
  if (filters.noDouble) {
    filterData.push({
      attributeDefinitionId: -32722,
      attributeType: 0,
      enumValues: [1],
      attributeDefinitionDecimalValue: 0,
      filterStrategy: 1,
    })
  }
  return JSON.stringify(filterData)
}

async function getCached<T>(key: string): Promise<T | null> {
  const result = await new Promise<Record<string, unknown>>(resolve =>
    chrome.storage.session.get(key, resolve)
  )
  return (result[key] as T) ?? null
}

async function setCached(key: string, value: unknown): Promise<void> {
  await new Promise<void>(resolve => chrome.storage.session.set({ [key]: value }, resolve))
}

export class BCParksProvider {
  private cartUid: string | null = null
  private cartTxUid: string | null = null
  private cartData: Record<string, unknown> | null = null
  private availabilityCooldownUntil = 0

  // Set this to receive raw daily API responses for available sites
  onAvailabilityRaw?: (siteId: string, siteName: string, daily: Array<Record<string, number>>) => void | Promise<void>

  private async api(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(BASE + path)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const resp = await fetch(url.toString(), { credentials: 'include', signal })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new BCParksApiError(resp.status, path, body)
    }
    return resp.json()
  }

  private clearCart(): void {
    this.cartUid = null
    this.cartTxUid = null
    this.cartData = null
  }

  private async ensureCart(signal?: AbortSignal): Promise<void> {
    if (this.cartUid) return
    const data = await this.api('/api/cart', undefined, signal) as Record<string, unknown>
    const tx = data['newTransaction'] as Record<string, unknown>
    this.cartUid = data['cartUid'] as string
    this.cartTxUid = tx['cartTransactionUid'] as string
    this.cartData = data
  }

  private async getAvailabilityCooldownUntil(): Promise<number> {
    const stored = await getCached<number>(AVAILABILITY_400_COOLDOWN_KEY)
    return Math.max(this.availabilityCooldownUntil, stored ?? 0)
  }

  private async setAvailabilityCooldownUntil(cooldownUntil: number): Promise<void> {
    this.availabilityCooldownUntil = cooldownUntil
    await setCached(AVAILABILITY_400_COOLDOWN_KEY, cooldownUntil)
  }

  private async assertAvailabilityNotCoolingDown(): Promise<void> {
    const cooldownUntil = await this.getAvailabilityCooldownUntil()
    if (Date.now() < cooldownUntil) {
      throw new BCParksCooldownError(cooldownUntil)
    }
  }

  private async getMapAvailability(
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<AvailabilityMapResponse> {
    await this.assertAvailabilityNotCoolingDown()
    try {
      return await this.api('/api/availability/map', params, signal) as AvailabilityMapResponse
    } catch (err) {
      if (!(err instanceof BCParksApiError) || err.status !== 400) throw err
    }

    this.clearCart()
    await this.ensureCart(signal)
    const retryParams = {
      ...params,
      cartUid: this.cartUid!,
      cartTransactionUid: this.cartTxUid!,
      bookingUid: crypto.randomUUID(),
    }

    try {
      return await this.api('/api/availability/map', retryParams, signal) as AvailabilityMapResponse
    } catch (err) {
      if (err instanceof BCParksApiError && err.status === 400) {
        await this.setAvailabilityCooldownUntil(Date.now() + AVAILABILITY_400_COOLDOWN_MS)
      }
      throw err
    }
  }

  async searchParks(query: string): Promise<Park[]> {
    const locations = await this.api('/api/resourceLocation') as Array<Record<string, unknown>>
    const term = query.toLowerCase()
    return locations
      .filter(loc => {
        if (!term) return true
        const vals = (loc['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return (vals['shortName'] ?? '').toLowerCase().includes(term)
          || (vals['fullName'] ?? '').toLowerCase().includes(term)
      })
      .map(loc => {
        const vals = (loc['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return { id: String(loc['resourceLocationId']), name: vals['shortName'] ?? String(loc['resourceLocationId']) }
      })
  }

  private async getResources(campgroundId: string, signal?: AbortSignal): Promise<Record<string, Record<string, unknown>>> {
    const cacheKey = `resources_${campgroundId}`
    const cached = await getCached<Record<string, Record<string, unknown>>>(cacheKey)
    if (cached) return cached
    const data = await this.api('/api/resourcelocation/resources', { resourceLocationId: campgroundId }, signal)
    await setCached(cacheKey, data)
    return data as Record<string, Record<string, unknown>>
  }

  private async getSections(campgroundId: string, signal?: AbortSignal): Promise<Record<string, [string, boolean, string]>> {
    const cacheKey = `sections_${campgroundId}`
    const cached = await getCached<Record<string, [string, boolean, string]>>(cacheKey)
    if (cached) return cached
    const maps = await this.api('/api/maps', { resourceLocationId: campgroundId }, signal) as Array<Record<string, unknown>>
    const sections: Record<string, [string, boolean, string]> = {}
    for (const m of maps) {
      const mapId = String(m['mapId'])
      const vals = (m['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
      const title = vals['title'] ?? ''
      const isWalkin = title.toLowerCase().includes('walk')
      for (const mr of (m['mapResources'] as Array<Record<string, unknown>>) ?? []) {
        sections[String(mr['resourceId'])] = [title, isWalkin, mapId]
      }
    }
    await setCached(cacheKey, sections)
    return sections
  }

  private siteFlags(resource: Record<string, unknown>, sectionIsWalkin: boolean): [boolean, boolean] {
    const vals = (resource['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
    const desc = (vals['description'] ?? '').toLowerCase()
    // definedAttributes values[0]===1 appears on normal sites for both walk-in (-32764) and
    // double (-32722) IDs — the encoding is not a simple Yes/No flag, so we don't use it.
    // Walk-in: rely on section membership (maps API) + description keywords.
    // Double: rely on description keywords + linkedResources (linked pairs share availability).
    const isWalkin = sectionIsWalkin || desc.includes('first-come') || desc.includes('first come')
    const isDouble = desc.includes('double site') || ((resource['linkedResources'] as unknown[])?.length ?? 0) > 0
    return [isWalkin, isDouble]
  }

  async getAvailability(
    campgroundId: string,
    checkIn: string,
    checkOut: string,
    filters: Filters,
    signal?: AbortSignal,
  ): Promise<AvailableSite[]> {
    await this.assertAvailabilityNotCoolingDown()
    await this.ensureCart(signal)
    const [resources, sections] = await Promise.all([
      this.getResources(campgroundId, signal),
      this.getSections(campgroundId, signal),
    ])

    const filterData = buildFilterData(filters)

    const candidates = Object.entries(resources)
      .map(([resourceId, resource]) => {
        const [sectionName, sectionIsWalkin, mapId] = sections[resourceId] ?? ['', false, '']
        const [isWalkin, isDouble] = this.siteFlags(resource, sectionIsWalkin)
        if (filters.noWalkin && isWalkin) return null
        if (filters.noDouble && isDouble) return null
        // Sites with no section (not in any map) are suspicious — likely walk-in or restricted access
        if (filters.noWalkin && !sectionName) return null
        const vals = (resource['localizedValues'] as Array<Record<string, string>>)?.[0] ?? {}
        return { resourceId, sectionName, isWalkin, isDouble, siteName: vals['name'] ?? resourceId, mapId }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    const candidatesByResourceId = new Map(candidates.map(c => [c.resourceId, c]))
    const candidateMapIds = [...new Set(candidates.map(c => c.mapId).filter(Boolean))]

    let activeCount = 0
    const queue: Array<() => void> = []
    const acquire = () => new Promise<void>(resolve => {
      if (activeCount < CONCURRENCY) { activeCount++; resolve() }
      else queue.push(resolve)
    })
    const release = () => {
      activeCount--
      const next = queue.shift()
      if (next) { activeCount++; next() }
    }

    const availableResourceIds = new Set<string>()
    await Promise.all(candidateMapIds.map(async mapId => {
      await acquire()
      try {
        const mapAvailability = await this.getMapAvailability({
          mapId,
          bookingCategoryId: '0',
          equipmentCategoryId: '-32768',
          subEquipmentCategoryId: '-32768',
          cartUid: this.cartUid!,
          cartTransactionUid: this.cartTxUid!,
          bookingUid: crypto.randomUUID(),
          groupHoldUid: '',
          startDate: checkIn,
          endDate: checkOut,
          getDailyAvailability: 'false',
          isReserving: 'true',
          boatLength: '0', boatDraft: '0', boatWidth: '0',
          peopleCapacityCategoryCounts: '[]',
          numEquipment: '0',
          filterData,
          seed: new Date().toISOString(),
        }, signal) as AvailabilityMapResponse

        for (const [resourceId, availability] of Object.entries(mapAvailability.resourceAvailabilities ?? {})) {
          if (!candidatesByResourceId.has(resourceId)) continue
          const available = availability.length > 0 && availability.every(d =>
            (d.processedAvailability ?? d.availability) === 0
          )
          if (available) availableResourceIds.add(resourceId)
        }
      } finally {
        release()
      }
    }))

    const sites: AvailableSite[] = []
    for (const resourceId of availableResourceIds) {
      const c = candidatesByResourceId.get(resourceId)!
      await this.onAvailabilityRaw?.(c.resourceId, c.siteName, [{ availability: 0 }])
      sites.push({
        resourceId: c.resourceId,
        campgroundId,
        campgroundName: '',
        sectionName: c.sectionName,
        siteName: c.siteName,
        mapId: c.mapId,
        isWalkin: c.isWalkin,
        isDouble: c.isDouble,
        checkIn,
        checkOut,
      })
    }
    return sites
  }

  async holdSite(site: AvailableSite, partySize: number): Promise<void> {
    await this.ensureCart()
    const bookingUid = crypto.randomUUID()
    const blockerUid = crypto.randomUUID()
    const now = new Date().toISOString()

    const cartBody = {
      ...this.cartData,
      bookings: [{
        bookingUid, cartUid: this.cartUid,
        bookingCategoryId: 0, bookingModel: 0,
        createTransactionUid: this.cartTxUid,
        currentVersion: null, history: [], drafts: [], referenceNumberPostfix: '',
        newVersion: {
          cartTransactionUid: this.cartTxUid,
          bookingMembers: [], bookingVehicles: [], bookingBoats: [],
          bookingCapacityCategoryCounts: [
            { capacityCategoryId: -32767, subCapacityCategoryId: -32768, count: partySize, isAdult: true },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32767, count: 0, isAdult: true },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32766, count: 0, isAdult: false },
            { capacityCategoryId: -32767, subCapacityCategoryId: -32765, count: 0, isAdult: false },
          ],
          rateCategoryId: -32768,
          resourceBlockerUids: [blockerUid],
          resourceNonSpecificBlockerUids: [], resourceZoneBlockerUids: [], resourceZoneEntryBlockerUids: [],
          startDate: site.checkIn, endDate: site.checkOut,
          releasePersonalInformation: false,
          equipmentCategoryId: -32768, subEquipmentCategoryId: -32768,
          occupant: {
            contact: { email: '', contactName: '', phoneNumberCountryCode: null, phoneNumber: '' },
            address: {}, allowMarketing: false, phoneNumbers: {}, preferredCultureName: 'en-CA',
            firstName: '', lastName: '',
          },
          requiresCheckout: false, bookingStatus: 0, completedDate: now, arrivalComment: '',
          entryPointResourceId: null, exitPointResourceId: null, bookingSurcharges: [],
          consentToRelease: false, equipmentDescription: '', groupHoldUid: '', organizationName: '',
          passExpiryDate: null, passNumber: '',
          resourceLocationId: parseInt(site.campgroundId),
          checkInTime: null, checkOutTime: null, deferredPayment: false,
        },
      }],
      resourceBlockers: [{
        blockerType: 0, cartUid: this.cartUid,
        resourceBlockerUid: blockerUid, bookingUid, groupHoldUid: '', isReservation: true,
        newVersion: {
          creationDate: now, cartTransactionUid: this.cartTxUid,
          startDate: site.checkIn, endDate: site.checkOut,
          resourceId: parseInt(site.resourceId),
          resourceLocationId: parseInt(site.campgroundId), status: 0,
        },
      }],
    }

    const resp1 = await fetch(`${BASE}/api/cart/commit?isCompleted=false&isSelfCheckIn=false`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart: cartBody }),
    })
    if (!resp1.ok) {
      const detail = await resp1.json().catch(() => ({}))
      throw new Error((detail as Record<string, string>)['messageKey'] ?? `Cart commit failed: ${resp1.status}`)
    }

    const cartResp = await fetch(`${BASE}/api/cart`, { credentials: 'include' })
    const confirmedCart = await cartResp.json()
    const resp2 = await fetch(`${BASE}/api/cart/commit?isCompleted=false&isSelfCheckIn=false`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart: confirmedCart }),
    })
    if (!resp2.ok) {
      const detail = await resp2.json().catch(() => ({}))
      throw new Error((detail as Record<string, string>)['messageKey'] ?? `Confirmation failed: ${resp2.status}`)
    }

    this.cartUid = null
    this.cartTxUid = null
    this.cartData = null
  }
}
