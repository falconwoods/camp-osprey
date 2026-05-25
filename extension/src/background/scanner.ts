import type { Trip, AvailableSite, Filters } from '../types'
import { expandDateRange, isBookable } from '../dates'

type GetAvailabilityFn = (
  campgroundId: string,
  checkIn: string,
  checkOut: string,
  filters: Filters,
  signal?: AbortSignal,
) => Promise<AvailableSite[]>

export async function scanTrip(
  trip: Trip,
  getAvailability: GetAvailabilityFn,
  shouldContinue: () => boolean = () => true,
): Promise<AvailableSite | null> {
  for (const park of trip.parks) {
    for (const dateRange of trip.dateRanges) {
      for (const window of expandDateRange(dateRange)) {
        if (!shouldContinue()) return null
        if (!isBookable(window.checkIn)) continue  // past BC Parks 8 PM / 2-day deadline
        const key = `${park.id}|${window.checkIn}|${window.checkOut}`
        if (trip.attempted.includes(key)) continue

        const sites = await getAvailability(park.id, window.checkIn, window.checkOut, trip.filters)
        // Filter out specific sites that were attempted individually (e.g. were taken at booking time)
        const fresh = sites.filter(s => !trip.attempted.includes(`${s.resourceId}|${s.checkIn}|${s.checkOut}`))
        if (fresh.length > 0) return { ...fresh[0], campgroundName: park.name, availableCount: fresh.length }
      }
    }
  }
  return null
}

export function makeAttemptedKey(site: AvailableSite): string {
  return `${site.campgroundId}|${site.checkIn}|${site.checkOut}`
}

export function buildBookingUrl(site: AvailableSite): string {
  const nights = Math.round(
    (new Date(site.checkOut).getTime() - new Date(site.checkIn).getTime()) / 86_400_000
  )
  const pid = site.campgroundId
  const mid = site.mapId || pid
  return (
    `https://camping.bcparks.ca/create-booking/results` +
    `?transactionLocationId=${pid}&resourceLocationId=${pid}&mapId=${mid}` +
    `&searchTabGroupId=0&bookingCategoryId=0` +
    `&startDate=${site.checkIn}&endDate=${site.checkOut}&nights=${nights}` +
    `&isReserving=true&equipmentId=-32768&subEquipmentId=-32768`
  )
}
