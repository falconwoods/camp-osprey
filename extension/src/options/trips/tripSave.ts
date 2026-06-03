import { getClientId, getStorage, saveTrips } from '../../storage'
import type { DateRange, Park, Trip } from '../../types'

type SaveTripInput = {
  editingTripId: string | null
  tripParks: Park[]
  tripDates: DateRange[]
}

type SaveTripResult = {
  savedTripId: string
  savedTrip: Trip | undefined
}

function fieldError(errorId: string, sectionId: string, message: string): void {
  const el = document.getElementById(errorId)!
  el.textContent = '⚠ ' + message
  el.classList.add('show')
  document.getElementById(sectionId)?.classList.add('section-invalid')
}

export function clearFieldErrors(): void {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = ''
    el.classList.remove('show')
  })
  document.querySelectorAll('.section-invalid').forEach(el => el.classList.remove('section-invalid'))
  document.querySelectorAll('.input.invalid').forEach(el => el.classList.remove('invalid'))
}

export function bindTripNameErrorReset(): void {
  document.getElementById('trip-name')!.addEventListener('input', () => {
    document.getElementById('error-name')!.classList.remove('show')
    document.getElementById('section-name')?.classList.remove('section-invalid')
    ;(document.getElementById('trip-name') as HTMLInputElement).classList.remove('invalid')
  })
}

export async function saveTripFromEditor(input: SaveTripInput): Promise<SaveTripResult | null> {
  clearFieldErrors()

  const name = (document.getElementById('trip-name') as HTMLInputElement).value.trim()
  const mode = (document.getElementById('trip-mode') as HTMLSelectElement).value as Trip['mode']
  const noWalkin = (document.getElementById('filter-walkin') as HTMLInputElement).checked
  const noDouble = (document.getElementById('filter-double') as HTMLInputElement).checked

  let hasErrors = false

  if (!name) {
    fieldError('error-name', 'section-name', 'Trip name is required.')
    ;(document.getElementById('trip-name') as HTMLInputElement).classList.add('invalid')
    ;(document.getElementById('trip-name') as HTMLInputElement).focus()
    hasErrors = true
  }

  if (input.tripParks.length === 0) {
    fieldError('error-parks', 'section-parks', 'Add at least one park to scan.')
    hasErrors = true
  }

  if (input.tripDates.length === 0) {
    fieldError('error-dates', 'section-dates', 'Add at least one date range — configure dates above and click "+ Add This Range".')
    hasErrors = true
  }

  if (hasErrors) return null

  const { trips } = await getStorage()
  const clientId = await getClientId()
  const now = Date.now()
  const savedTripId = input.editingTripId ?? crypto.randomUUID()

  if (input.editingTripId) {
    const idx = trips.findIndex(t => t.id === input.editingTripId)
    if (idx !== -1) {
      trips[idx] = {
        ...trips[idx],
        clientId: trips[idx].clientId ?? clientId,
        name,
        parks: input.tripParks,
        dateRanges: input.tripDates,
        mode,
        filters: { noWalkin, noDouble },
        status: 'idle',
        updatedAt: now,
        deletedAt: null,
      }
    }
  } else {
    const savedMode = localStorage.getItem('datemode_new')
    if (savedMode) localStorage.setItem(`datemode_${savedTripId}`, savedMode)
    trips.push({
      id: savedTripId,
      clientId,
      name,
      parks: input.tripParks,
      dateRanges: input.tripDates,
      mode,
      filters: { noWalkin, noDouble },
      status: 'idle',
      lastMatch: null,
      attempted: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  await saveTrips(trips)
  return {
    savedTripId,
    savedTrip: trips.find(t => t.id === savedTripId),
  }
}
