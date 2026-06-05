import { getAuth, getStorage, savePayment } from '../../storage'
import { getTrips, updateTrip } from '../../tripStore'
import { bindAsyncButton } from '../../shared/components/button'
import type { AuthState, PaymentConfig, Trip } from '../../types'

type ParkPaymentPageOptions = {
  openAuthDialog: () => Promise<void>
  renderTripList?: () => Promise<void>
}

type PaymentFieldId = 'card-number' | 'card-holder' | 'card-expiry' | 'card-cvv' | 'billing-address' | 'billing-postal'

type PaymentFormValues = Record<PaymentFieldId, string>

export class ParkPaymentPage {
  constructor(private readonly options: ParkPaymentPageOptions) {}

  async render(): Promise<void> {
    await this.renderSection(await getAuth())
  }

  private paymentSectionHTML(auth: AuthState): string {
    const signedIn = Boolean(auth.user)
    const disabled = signedIn ? '' : 'disabled'
    const lockedClass = signedIn ? '' : ' locked'
    const actionButton = signedIn
      ? '<button class="btn-primary" id="save-payment-btn">Save Payment Info</button>'
      : '<button class="btn-primary" id="payment-sign-in-btn" type="button">Sign in to save payment info</button>'
    const deleteButton = signedIn
      ? '<button class="btn-secondary" id="delete-payment-btn" type="button">Delete Payment Info</button>'
      : ''
    const info = signedIn
      ? ''
      : `<div class="payment-info">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <div><strong>Sign in to add or edit payment information.</strong><br>Your payment details are stored locally on this device only.</div>
        </div>`

    return `<div class="payment-card${lockedClass}">
      <div class="payment-card-header">
        <div>
          <div class="payment-title-row">
            <h2>Park Payment</h2>
            <span class="payment-pill">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-5"/></svg>
              Only stored locally on this device.
            </span>
          </div>
          <p class="payment-copy">Used only in auto-pay mode to complete park booking checkout, not for campsoon app payments.</p>
        </div>
      </div>
      <div class="payment-form">
        ${info}
        <div class="payment-grid">
          <div class="payment-field">
            <label for="card-number">Card number</label>
            <input class="input" id="card-number" type="text" inputmode="numeric" autocomplete="cc-number" maxlength="23" pattern="[0-9 ]{13,23}" placeholder="Card number" aria-describedby="error-card-number" ${disabled}>
            <div class="field-error" id="error-card-number"></div>
          </div>
          <div class="payment-field">
            <label for="card-holder">Name on card</label>
            <input class="input" id="card-holder" type="text" autocomplete="cc-name" maxlength="80" placeholder="Full name as shown on card" aria-describedby="error-card-holder" ${disabled}>
            <div class="field-error" id="error-card-holder"></div>
          </div>
          <div class="payment-field">
            <label for="card-expiry">Expiry date</label>
            <input class="input" id="card-expiry" type="text" inputmode="numeric" autocomplete="cc-exp" maxlength="5" pattern="(0[1-9]|1[0-2])/[0-9]{2}" placeholder="MM/YY" aria-describedby="error-card-expiry" ${disabled}>
            <div class="field-error" id="error-card-expiry"></div>
          </div>
          <div class="payment-field">
            <label for="card-cvv">CVV</label>
            <input class="input" id="card-cvv" type="password" inputmode="numeric" autocomplete="cc-csc" maxlength="4" pattern="[0-9]{3,4}" placeholder="CVV" aria-describedby="error-card-cvv" ${disabled}>
            <div class="field-error" id="error-card-cvv"></div>
          </div>
          <div class="payment-field payment-field-full">
            <label for="billing-address">Billing address</label>
            <input class="input" id="billing-address" type="text" autocomplete="billing street-address" maxlength="160" placeholder="Street address" aria-describedby="error-billing-address" ${disabled}>
            <div class="field-error" id="error-billing-address"></div>
          </div>
          <div class="payment-field payment-field-full">
            <label for="billing-postal">Postal / Zip code</label>
            <input class="input" id="billing-postal" type="text" autocomplete="billing postal-code" maxlength="12" placeholder="Postal / Zip code" aria-describedby="error-billing-postal" ${disabled}>
            <div class="field-error" id="error-billing-postal"></div>
          </div>
        </div>
      </div>
      <div class="payment-local-note">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="16" height="11" x="4" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        Your payment details are stored locally on this device only.
      </div>
      <div class="payment-actions">
        <button class="btn-secondary" id="cancel-payment-btn" type="button">Cancel</button>
        ${deleteButton}
        ${actionButton}
      </div>
    </div>`
  }

  private async renderSection(auth: AuthState): Promise<void> {
    const root = document.getElementById('payment-root')
    if (!root) return
    root.innerHTML = this.paymentSectionHTML(auth)
    this.bindSectionActions()
    await this.loadForm()
  }

  private bindSectionActions(): void {
    document.getElementById('cancel-payment-btn')?.addEventListener('click', () => void this.loadForm())
    const deleteButton = document.getElementById('delete-payment-btn') as HTMLButtonElement | null
    if (deleteButton) bindAsyncButton(deleteButton, 'Deleting...', () => this.deletePayment())
    const saveButton = document.getElementById('save-payment-btn') as HTMLButtonElement | null
    if (saveButton) bindAsyncButton(saveButton, 'Saving...', () => this.saveFromForm())
    document.getElementById('payment-sign-in-btn')?.addEventListener('click', () => void this.options.openAuthDialog())
    this.fieldIds().forEach(id => {
      document.getElementById(id)?.addEventListener('input', event => {
        this.clearFieldError((event.currentTarget as HTMLInputElement).id as PaymentFieldId)
      })
    })
  }

  private async loadForm(): Promise<void> {
    const { payment } = await getStorage()
    const cardNumber = document.getElementById('card-number') as HTMLInputElement | null
    if (!cardNumber) return
    if (!payment) {
      this.clearForm()
      return
    }
    cardNumber.value = payment.cardNumber
    ;(document.getElementById('card-holder') as HTMLInputElement).value = payment.cardHolder
    ;(document.getElementById('card-expiry') as HTMLInputElement).value = payment.cardExpiry
    ;(document.getElementById('card-cvv') as HTMLInputElement).value = payment.cardCvv
    ;(document.getElementById('billing-address') as HTMLInputElement).value = payment.billingAddress ?? ''
    ;(document.getElementById('billing-postal') as HTMLInputElement).value = payment.billingPostal ?? ''
  }

  private async saveFromForm(): Promise<void> {
    const payment = this.validPaymentFromForm()
    if (!payment) return
    await savePayment(payment)
    await this.options.renderTripList?.()
    alert('Payment info saved.')
  }

  private async deletePayment(): Promise<void> {
    const trips = await getTrips()
    const activeAutoPayTrips = trips.filter(trip => this.isActiveAutoPayTrip(trip))
    const message = activeAutoPayTrips.length
      ? `Delete saved park payment info from this device? This will pause ${activeAutoPayTrips.length} active auto-pay trip${activeAutoPayTrips.length === 1 ? '' : 's'}.`
      : 'Delete saved park payment info from this device?'
    if (!confirm(message)) return
    await savePayment(null)
    if (activeAutoPayTrips.length) {
      await Promise.all(activeAutoPayTrips.map(trip => updateTrip(trip.id, { status: 'paused' })))
      activeAutoPayTrips.forEach(trip => {
        chrome.runtime.sendMessage({ type: 'STOP_SCAN', tripId: trip.id })
      })
      chrome.storage.local.remove('campOspreyTarget')
    }
    await this.options.renderTripList?.()
    this.clearForm()
    alert('Payment info deleted.')
  }

  private isActiveAutoPayTrip(trip: Trip): boolean {
    return trip.mode === 'autopay' && (trip.status === 'scanning' || trip.status === 'reserving')
  }

  private clearForm(): void {
    this.fieldIds().forEach(id => {
      const input = document.getElementById(id) as HTMLInputElement | null
      if (input) input.value = ''
    })
    this.clearErrors()
  }

  private validPaymentFromForm(): PaymentConfig | null {
    this.clearErrors()
    const values = this.formValues()
    const cardNumber = values['card-number'].replace(/\D/g, '')
    const cardExpiry = values['card-expiry'].replace(/\s/g, '')
    const errors: Partial<Record<PaymentFieldId, string>> = {}

    if (!/^\d{13,19}$/.test(cardNumber) || !this.passesLuhn(cardNumber)) {
      errors['card-number'] = 'Enter a valid card number.'
    }
    if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(values['card-holder'])) {
      errors['card-holder'] = 'Enter the name on the card.'
    }
    if (!this.isValidExpiry(cardExpiry)) {
      errors['card-expiry'] = 'Enter a future expiry date as MM/YY.'
    }
    if (!/^\d{3,4}$/.test(values['card-cvv'])) {
      errors['card-cvv'] = 'Enter a 3 or 4 digit CVV.'
    }
    if (values['billing-address'].length < 5) {
      errors['billing-address'] = 'Enter a billing address.'
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(values['billing-postal'])) {
      errors['billing-postal'] = 'Enter a valid postal or zip code.'
    }

    const firstError = this.fieldIds().find(id => errors[id])
    if (firstError) {
      this.showErrors(errors)
      document.getElementById(firstError)?.focus()
      return null
    }

    return {
      cardNumber,
      cardHolder: values['card-holder'],
      cardExpiry,
      cardCvv: values['card-cvv'],
      billingAddress: values['billing-address'],
      billingPostal: values['billing-postal'].toUpperCase(),
    }
  }

  private formValues(): PaymentFormValues {
    return Object.fromEntries(
      this.fieldIds().map(id => [id, (document.getElementById(id) as HTMLInputElement).value.trim()])
    ) as PaymentFormValues
  }

  private fieldIds(): PaymentFieldId[] {
    return ['card-number', 'card-holder', 'card-expiry', 'card-cvv', 'billing-address', 'billing-postal']
  }

  private showErrors(errors: Partial<Record<PaymentFieldId, string>>): void {
    this.fieldIds().forEach(id => {
      if (!errors[id]) return
      const input = document.getElementById(id) as HTMLInputElement | null
      const error = document.getElementById(`error-${id}`)
      input?.classList.add('invalid')
      input?.setAttribute('aria-invalid', 'true')
      if (error) {
        error.textContent = errors[id] ?? ''
        error.classList.add('show')
      }
    })
  }

  private clearErrors(): void {
    this.fieldIds().forEach(id => this.clearFieldError(id))
  }

  private clearFieldError(id: PaymentFieldId): void {
    const input = document.getElementById(id) as HTMLInputElement | null
    const error = document.getElementById(`error-${id}`)
    input?.classList.remove('invalid')
    input?.removeAttribute('aria-invalid')
    if (error) {
      error.textContent = ''
      error.classList.remove('show')
    }
  }

  private isValidExpiry(value: string): boolean {
    const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value)
    if (!match) return false
    const month = Number(match[1])
    const year = 2000 + Number(match[2])
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    return year > currentYear || (year === currentYear && month >= currentMonth)
  }

  private passesLuhn(cardNumber: string): boolean {
    let sum = 0
    let doubleDigit = false
    for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
      let digit = Number(cardNumber[i])
      if (doubleDigit) {
        digit *= 2
        if (digit > 9) digit -= 9
      }
      sum += digit
      doubleDigit = !doubleDigit
    }
    return sum % 10 === 0
  }
}
