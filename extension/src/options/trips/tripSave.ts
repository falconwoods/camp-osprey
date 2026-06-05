import { getClientId, getStorage, saveTrips } from '../../storage'
import type { DateRange, Park, PaymentConfig, Trip } from '../../types'

type SaveTripInput = {
  editingTripId: string | null
  tripParks: Park[]
  tripDates: DateRange[]
  requireAutoPayPayment?: boolean
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

function isValidParkPayment(payment: PaymentConfig | null): payment is PaymentConfig {
  if (!payment) return false
  const requiredFields = [
    payment.cardNumber,
    payment.cardHolder,
    payment.cardExpiry,
    payment.cardCvv,
    payment.billingAddress,
    payment.billingPostal,
  ]
  return Boolean(
    requiredFields.every(value => typeof value === 'string' && value.trim()),
  )
}

function clearModePaymentWarning(): void {
  document.querySelector('.mode-help-payment-warning')?.remove()
  const warningAction = document.querySelector<HTMLElement>('.mode-help-action-warning')
  if (warningAction) {
    warningAction.classList.remove('mode-help-action-warning')
    warningAction.removeAttribute('role')
    warningAction.innerHTML = '<span>Auto-pay requires payment info in Settings &gt; Park Payment.</span><button type="button" data-open-payment-settings>Set up Park Payment</button>'
  }
  document.getElementById('trip-mode-help')?.classList.remove('mode-help-warning')
  document.getElementById('trip-mode')?.classList.remove('invalid')
}

function showModePaymentWarning(): void {
  const message = 'Add valid Park Payment info before starting Auto-pay.'
  const help = document.getElementById('trip-mode-help')
  const modeSelect = document.getElementById('trip-mode') as HTMLSelectElement | null
  modeSelect?.classList.add('invalid')

  if (!help) {
    alert(message)
    return
  }

  help.classList.add('mode-help-warning')
  const existingAction = help.querySelector('.mode-help-action')
  const warningHTML = `<span><b>Payment required</b> ${message}</span><button type="button" data-open-payment-settings>Set up Park Payment</button>`
  if (existingAction) {
    existingAction.classList.add('mode-help-action-warning')
    existingAction.setAttribute('role', 'alert')
    existingAction.innerHTML = warningHTML
    return
  }
  help.insertAdjacentHTML('beforeend', `<div class="mode-help-action mode-help-action-warning" role="alert">${warningHTML}</div>`)
}

export function clearFieldErrors(): void {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = ''
    el.classList.remove('show')
  })
  document.querySelectorAll('.section-invalid').forEach(el => el.classList.remove('section-invalid'))
  document.querySelectorAll('.input.invalid').forEach(el => el.classList.remove('invalid'))
  clearModePaymentWarning()
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

  const { payment, trips } = await getStorage()
  if (input.requireAutoPayPayment !== false && mode === 'autopay' && !isValidParkPayment(payment)) {
    showModePaymentWarning()
    ;(document.getElementById('trip-mode') as HTMLSelectElement | null)?.focus()
    return null
  }

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
