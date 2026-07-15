import type { Trip, AvailableSite, Filters, ReservationProvider } from '../types'
import { providerInfo } from '../providers/config'
import { expandDateRange, isBookable } from '../dates'

type GetAvailabilityFn = (
  campgroundId: string,
  checkIn: string,
  checkOut: string,
  filters: Filters,
  signal?: AbortSignal,
) => Promise<AvailableSite[]>

export interface TripScanCursor {
  parkIndex: number
  dateRangeIndex: number
  windowIndex: number
}

export interface ScanBudget {
  remainingCycleRequests: number
  remainingTripRequests: number
}

export interface ScanTripResult {
  site: AvailableSite | null
  cursor: TripScanCursor
  budgetExhausted: boolean
  completedFullScan: boolean
  requestsMade: number
}

interface ScanCandidate {
  parkIndex: number
  dateRangeIndex: number
  windowIndex: number
  parkId: string
  checkIn: string
  checkOut: string
}

const START_CURSOR: TripScanCursor = { parkIndex: 0, dateRangeIndex: 0, windowIndex: 0 }

function cursorKey(cursor: TripScanCursor): string {
  return `${cursor.parkIndex}:${cursor.dateRangeIndex}:${cursor.windowIndex}`
}

function buildCandidates(trip: Trip): ScanCandidate[] {
  const candidates: ScanCandidate[] = []

  trip.parks.forEach((park, parkIndex) => {
    trip.dateRanges.forEach((dateRange, dateRangeIndex) => {
      expandDateRange(dateRange).forEach((window, windowIndex) => {
        if (!isBookable(window.checkIn)) return
        const key = `${park.id}|${window.checkIn}|${window.checkOut}`
        if (trip.attempted.includes(key)) return
        candidates.push({
          parkIndex,
          dateRangeIndex,
          windowIndex,
          parkId: park.id,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
        })
      })
    })
  })

  return candidates
}

function orderedCandidates(candidates: ScanCandidate[], cursor: TripScanCursor): ScanCandidate[] {
  if (candidates.length === 0) return []
  const startKey = cursorKey(cursor)
  const startIndex = candidates.findIndex(candidate => cursorKey(candidate) === startKey)
  if (startIndex <= 0) return candidates
  return [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)]
}

export async function scanTrip(
  trip: Trip,
  getAvailability: GetAvailabilityFn,
  shouldContinue: () => boolean = () => true,
  options: { cursor?: TripScanCursor; budget?: ScanBudget } = {},
): Promise<ScanTripResult> {
  const candidates = orderedCandidates(buildCandidates(trip), options.cursor ?? START_CURSOR)
  let cursor = candidates[0]
    ? { parkIndex: candidates[0].parkIndex, dateRangeIndex: candidates[0].dateRangeIndex, windowIndex: candidates[0].windowIndex }
    : START_CURSOR
  let requestsMade = 0

  for (let index = 0; index < candidates.length; index += 1) {
    if (!shouldContinue()) {
      return { site: null, cursor, budgetExhausted: false, completedFullScan: false, requestsMade }
    }
    if (
      options.budget &&
      (options.budget.remainingCycleRequests <= 0 || options.budget.remainingTripRequests <= 0)
    ) {
      return { site: null, cursor, budgetExhausted: true, completedFullScan: false, requestsMade }
    }

    const candidate = candidates[index]
    const nextCandidate = candidates[index + 1]
    cursor = nextCandidate
      ? { parkIndex: nextCandidate.parkIndex, dateRangeIndex: nextCandidate.dateRangeIndex, windowIndex: nextCandidate.windowIndex }
      : START_CURSOR

    if (options.budget) {
      options.budget.remainingCycleRequests -= 1
      options.budget.remainingTripRequests -= 1
    }
    requestsMade += 1

    const sites = await getAvailability(candidate.parkId, candidate.checkIn, candidate.checkOut, trip.filters)
    const fresh = sites.filter(s => !trip.attempted.includes(`${s.resourceId}|${s.checkIn}|${s.checkOut}`))
    if (fresh.length > 0) {
      const park = trip.parks[candidate.parkIndex]
      return {
        site: { ...fresh[0], provider: trip.provider, campgroundName: park?.parentName ? `${park.parentName} › ${park.name}` : (park?.name ?? candidate.parkId), availableCount: fresh.length },
        cursor,
        budgetExhausted: false,
        completedFullScan: false,
        requestsMade,
      }
    }
  }

  return { site: null, cursor: START_CURSOR, budgetExhausted: false, completedFullScan: true, requestsMade }
}

export function makeAttemptedKey(site: AvailableSite): string {
  return `${site.campgroundId}|${site.checkIn}|${site.checkOut}`
}

export function buildBookingUrl(site: AvailableSite, provider: ReservationProvider = site.provider ?? 'bc_parks'): string {
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const pid = site.campgroundId
  const mid = site.mapId || pid
  const extra = provider === 'parks_canada'
    ? `&peopleCapacityCategoryCounts=${encodeURIComponent(JSON.stringify([[-32767, null, 1, null]]))}` +
      `&filterData=${encodeURIComponent(JSON.stringify({ '-32756': '[[1],0,0,0]' }))}`
    : ''
  return (
    `${providerInfo(provider).baseUrl}/create-booking/results` +
    `?transactionLocationId=${pid}&resourceLocationId=${pid}&mapId=${mid}` +
    `&searchTabGroupId=0&bookingCategoryId=0` +
    `&startDate=${site.checkIn}&endDate=${site.checkOut}&nights=${nights}` +
    `&isReserving=true&equipmentId=-32768&subEquipmentId=-32768${extra}`
  )
}
