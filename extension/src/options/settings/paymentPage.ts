import { getAuth, getStorage, savePayment } from '../../storage'
import type { AuthState } from '../../types'
import { createPointCheckout, getPointsSummary, type PointsSummary } from '../../serverApi'
import { icon } from './shared'

type PaymentPageOptions = {
  openAuthDialog: () => Promise<void>
}

export class PaymentPage {
  constructor(private readonly options: PaymentPageOptions) {}

  async render(): Promise<void> {
    await this.renderSection(await getAuth())
  }

  private pointsSectionHTML(auth: AuthState, points: PointsSummary | null, error: string | null): string {
    const signedIn = Boolean(auth.user)
    if (!signedIn) {
      return `<div class="payment-card locked">
        <div class="payment-card-header">
          <div class="payment-title-row">
            <h2>CampOsprey Points</h2>
            <span class="payment-pill">${icon('lock')} Sign in required</span>
          </div>
        </div>
        <div class="payment-info">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <div><strong>Sign in to buy and use points.</strong><br>Points are charged only after a campsite is successfully paid.</div>
        </div>
        <div class="payment-actions">
          <button class="btn-primary" id="payment-sign-in-btn" type="button">Sign in to buy points</button>
        </div>
      </div>`
    }

    if (error) {
      return `<div class="payment-card">
        <div class="payment-card-header">
          <div class="payment-title-row">
            <h2>CampOsprey Points</h2>
            <span class="payment-pill">Unavailable</span>
          </div>
        </div>
        <div class="payment-info">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <div><strong>Could not load points.</strong><br>${this.escape(error)}</div>
        </div>
      </div>`
    }

    if (!points) {
      return `<div class="payment-card">
        <div class="payment-card-header">
          <div class="payment-title-row">
            <h2>CampOsprey Points</h2>
            <span class="payment-pill">Loading</span>
          </div>
        </div>
      </div>`
    }

    const packages = points.packages.length > 0
      ? points.packages.map(pkg => `<button class="btn-secondary point-package-btn" type="button" data-package-id="${this.escape(pkg.id)}">
          ${this.escape(pkg.name)} · ${pkg.points.toLocaleString()} points
        </button>`).join('')
      : '<div class="payment-local-note">No point packages are available.</div>'

    const transactions = points.recentTransactions.length > 0
      ? points.recentTransactions.slice(0, 5).map(tx => `<div class="payment-local-note">
          ${this.escape(tx.type)}: ${tx.pointsDelta > 0 ? '+' : ''}${tx.pointsDelta} points · balance ${tx.balanceAfter}
        </div>`).join('')
      : '<div class="payment-local-note">No point activity yet.</div>'

    return `<div class="payment-card">
      <div class="payment-card-header">
        <div>
          <div class="payment-title-row">
            <h2>CampOsprey Points</h2>
            <span class="payment-pill">${points.balance.toLocaleString()} points</span>
          </div>
        </div>
      </div>
      <div class="payment-local-note">
        Successful paid bookings cost ${points.successfulBookingPointCost.toLocaleString()} points.
      </div>
      <div class="payment-actions">
        ${packages}
      </div>
      <div class="payment-form">
        ${transactions}
      </div>
    </div>`
  }

  private paymentSectionHTML(auth: AuthState, points: PointsSummary | null = null, error: string | null = null): string {
    const signedIn = Boolean(auth.user)
    const disabled = signedIn ? '' : 'disabled'
    const lockedClass = signedIn ? '' : ' locked'
    const actionButton = signedIn
      ? '<button class="btn-primary" id="save-payment-btn">Save Payment Info</button>'
      : '<button class="btn-primary" id="payment-sign-in-btn" type="button">Sign in to save payment info</button>'
    const editButton = signedIn
      ? `<button class="btn-secondary" type="button">${icon('settings')} Edit</button>`
      : ''
    const info = signedIn
      ? ''
      : `<div class="payment-info">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <div><strong>Sign in to add or edit payment information.</strong><br>Your payment details are stored locally on this device only.</div>
        </div>`

    return `${this.pointsSectionHTML(auth, points, error)}
    <div class="payment-card${lockedClass}">
      <div class="payment-card-header">
        <div>
          <div class="payment-title-row">
            <h2>BC Parks Auto-pay Details</h2>
            <span class="payment-pill">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-5"/></svg>
              Stored locally on this device
            </span>
          </div>
        </div>
        ${editButton}
      </div>
      <div class="payment-form">
        ${info}
        <div class="payment-grid">
          <div class="payment-field">
            <label for="card-number">Card number</label>
            <input class="input" id="card-number" placeholder="Card number" ${disabled}>
          </div>
          <div class="payment-field">
            <label for="card-holder">Name on card</label>
            <input class="input" id="card-holder" placeholder="Full name as shown on card" ${disabled}>
          </div>
          <div class="payment-field">
            <label for="card-expiry">Expiry date</label>
            <input class="input" id="card-expiry" placeholder="MM / YY" ${disabled}>
          </div>
          <div class="payment-field">
            <label for="card-cvv">CVV</label>
            <input class="input" id="card-cvv" placeholder="CVV" ${disabled}>
          </div>
          <div class="payment-field payment-field-full">
            <label for="billing-address">Billing address</label>
            <input class="input" id="billing-address" placeholder="Street address" ${disabled}>
          </div>
          <div class="payment-field payment-field-full">
            <label for="billing-postal">Postal / Zip code</label>
            <input class="input" id="billing-postal" placeholder="Postal / Zip code" ${disabled}>
          </div>
          <div class="payment-field">
            <label for="party-size">Party size</label>
            <input class="input" id="party-size" type="number" min="1" max="8" placeholder="Number of people" ${disabled}>
          </div>
        </div>
      </div>
      <div class="payment-local-note">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="16" height="11" x="4" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        Your payment details are stored locally on this device only.
      </div>
      <div class="payment-actions">
        <button class="btn-secondary" id="cancel-payment-btn" type="button">Cancel</button>
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
    if (!auth.user) return

    try {
      const points = await getPointsSummary()
      root.innerHTML = this.paymentSectionHTML(auth, points)
      this.bindSectionActions()
      await this.loadForm()
    } catch (err) {
      root.innerHTML = this.paymentSectionHTML(auth, null, err instanceof Error ? err.message : 'server_error')
      this.bindSectionActions()
      await this.loadForm()
    }
  }

  private bindSectionActions(): void {
    document.getElementById('cancel-payment-btn')?.addEventListener('click', () => void this.loadForm())
    document.getElementById('save-payment-btn')?.addEventListener('click', () => void this.saveFromForm())
    document.querySelectorAll('.point-package-btn').forEach(button => {
      button.addEventListener('click', () => void this.startCheckout((button as HTMLElement).dataset.packageId ?? ''))
    })
    document.getElementById('payment-sign-in-btn')?.addEventListener('click', () => void this.options.openAuthDialog())
  }

  private async startCheckout(packageId: string): Promise<void> {
    if (!packageId) return
    const checkout = await createPointCheckout(packageId)
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: checkout.checkoutUrl })
      return
    }
    window.open(checkout.checkoutUrl, '_blank')
  }

  private async loadForm(): Promise<void> {
    const { payment } = await getStorage()
    if (!payment) return
    const cardNumber = document.getElementById('card-number') as HTMLInputElement | null
    if (!cardNumber) return
    cardNumber.value = payment.cardNumber
    ;(document.getElementById('card-holder') as HTMLInputElement).value = payment.cardHolder
    ;(document.getElementById('card-expiry') as HTMLInputElement).value = payment.cardExpiry
    ;(document.getElementById('card-cvv') as HTMLInputElement).value = payment.cardCvv
    ;(document.getElementById('billing-address') as HTMLInputElement).value = payment.billingAddress ?? ''
    ;(document.getElementById('billing-postal') as HTMLInputElement).value = payment.billingPostal ?? ''
    ;(document.getElementById('party-size') as HTMLInputElement).value = String(payment.partySize)
  }

  private async saveFromForm(): Promise<void> {
    await savePayment({
      cardNumber: (document.getElementById('card-number') as HTMLInputElement).value,
      cardHolder: (document.getElementById('card-holder') as HTMLInputElement).value,
      cardExpiry: (document.getElementById('card-expiry') as HTMLInputElement).value,
      cardCvv: (document.getElementById('card-cvv') as HTMLInputElement).value,
      billingAddress: (document.getElementById('billing-address') as HTMLInputElement).value,
      billingPostal: (document.getElementById('billing-postal') as HTMLInputElement).value,
      partySize: parseInt((document.getElementById('party-size') as HTMLInputElement).value) || 1,
    })
    alert('Payment info saved.')
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char] ?? char))
  }
}
