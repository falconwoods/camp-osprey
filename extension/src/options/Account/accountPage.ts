import { bindAccountPanel, renderAccountPanelHTML } from '../../accountPanel'
import { createPointCheckout, getPointsSummary, type PointsSummary } from '../../serverApi'
import { withButtonLoading } from '../../shared/components/button'
import { getAuth, getPendingStartTripId } from '../../storage'
import type { AuthState } from '../../types'
import { consumePendingStartTripId } from '../../startAuthGate'
import { icon } from '../settings/shared'

type AccountPageOptions = {
  openAuthDialog: () => Promise<void>
  renderHeaderAccount: () => Promise<void>
  renderTripList: () => Promise<void>
  startTripNow: (tripId: string) => Promise<boolean>
}

export class AccountPage {
  constructor(private readonly options: AccountPageOptions) {}

  async render(): Promise<void> {
    const root = document.getElementById('account-root')
    if (!root) return

    const auth = await getAuth()
    const pendingTripId = await getPendingStartTripId()
    root.innerHTML = `${renderAccountPanelHTML(auth, pendingTripId)}${this.pointsSectionHTML(auth, null, null)}`
    this.bindAccountActions()

    if (!auth.user) return

    try {
      const points = await getPointsSummary()
      root.innerHTML = `${renderAccountPanelHTML(auth, pendingTripId)}${this.pointsSectionHTML(auth, points, null)}`
    } catch (err) {
      root.innerHTML = `${renderAccountPanelHTML(auth, pendingTripId)}${this.pointsSectionHTML(auth, null, err instanceof Error ? err.message : 'server_error')}`
    }
    this.bindAccountActions()
  }

  private pointsSectionHTML(auth: AuthState, points: PointsSummary | null, error: string | null): string {
    const signedIn = Boolean(auth.user)
    if (!signedIn) {
      return `<div class="account-points-page">
        <section class="account-points-card account-points-card-locked">
          <div class="account-section-icon">${icon('lock')}</div>
          <div class="account-points-card-copy">
            <div class="account-card-kicker">Campsoon Points</div>
            <h2>Sign in to buy points</h2>
            <p>Use points to pay for successful auto-bookings. Points are charged only after a campsite is successfully paid.</p>
          </div>
          <button class="btn-primary account-points-sign-in" id="account-points-sign-in-btn" type="button">Sign in first</button>
        </section>
      </div>`
    }

    if (error) {
      return `<div class="account-points-page">
        <section class="account-points-card account-points-card-locked">
          <div class="account-section-icon account-section-icon-warning">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          </div>
          <div class="account-points-card-copy">
            <div class="account-card-kicker">Campsoon Points</div>
            <h2>Could not load points</h2>
            <p>${this.escape(error)}</p>
          </div>
        </section>
      </div>`
    }

    if (!points) {
      return `<div class="account-points-page">
        <section class="account-points-card account-points-summary">
          <div class="account-points-summary-copy">
            <div class="account-section-icon">${icon('check')}</div>
            <div>
              <div class="account-card-kicker">Campsoon Points</div>
              <h2>Loading points...</h2>
              <p>Fetching your balance and available point packages.</p>
            </div>
          </div>
        </section>
      </div>`
    }

    const packageCards = points.packages.length > 0
      ? points.packages.map(pkg => {
        const bookingCount = Math.floor(pkg.points / points.successfulBookingPointCost)
        const isBestValue = pkg.recommended
        return `<article class="point-package-card${isBestValue ? ' point-package-featured' : ''}">
          <div class="point-package-header">
            <h3>${this.escape(this.packageName(pkg.name))}</h3>
            ${isBestValue ? '<span class="point-package-badge">Best value</span>' : ''}
          </div>
          <div class="point-package-points">${pkg.points.toLocaleString()} <span>points</span></div>
          <div class="point-package-price">${this.priceLabelHTML(pkg.priceLabel)}</div>
          <p>${this.escape(this.bookingEstimate(bookingCount))}</p>
          <button class="${isBestValue ? 'btn-primary' : 'btn-secondary'} point-package-btn" type="button" data-package-id="${this.escape(pkg.id)}">Buy now</button>
        </article>`
      }).join('')
      : '<div class="account-empty-state">No point packages are available.</div>'

    const sortedTransactions = [...points.recentTransactions].sort((a, b) => this.transactionTime(b.createdAt) - this.transactionTime(a.createdAt))
    const transactions = sortedTransactions.length > 0
      ? `<div class="point-activity-statement" role="table" aria-label="Point activity statement">
          <div class="point-activity-row point-activity-header" role="row">
            <div role="columnheader">Activity Type</div>
            <div role="columnheader">Points</div>
            <div role="columnheader">Points After</div>
            <div role="columnheader">Date</div>
            <div role="columnheader">Details</div>
          </div>
          ${sortedTransactions.map(tx => {
        const direction = tx.pointsDelta >= 0 ? 'earned' : 'spent'
        return `<div class="point-activity-row">
            <div role="cell" data-label="Activity Type">${this.escape(this.transactionLabel(tx.type))}</div>
            <div role="cell" data-label="Points" class="point-activity-${direction}">${tx.pointsDelta > 0 ? '+' : ''}${tx.pointsDelta.toLocaleString()}</div>
            <div role="cell" data-label="Points After">${tx.balanceAfter.toLocaleString()}</div>
            <div role="cell" data-label="Date">${this.escape(this.formatTransactionDateTime(tx.createdAt))}</div>
            <div role="cell" data-label="Details">${this.escape(this.transactionDetails(tx))}</div>
          </div>`
      }).join('')}
        </div>`
      : '<div class="account-empty-state">No point activity yet.</div>'

    return `<div class="account-points-page">
      <section class="account-points-card account-buy-points">
        <div class="buy-points-header">
          <div class="buy-points-title-group">
            <h2>Buy points</h2>
            <p>Choose a package and complete payment securely with Stripe.</p>
          </div>
          <div class="points-balance-badge" aria-label="Current points balance">${points.balance.toLocaleString()} points available</div>
        </div>
        <div class="point-package-grid">
          ${packageCards}
        </div>
        <div class="account-stripe-note">${icon('lock')} <strong>Secure checkout with Stripe.</strong> A Stripe payment page will open to complete your purchase.</div>
      </section>

      <section class="account-points-card account-point-activity">
        <div class="account-card-heading">
          <div class="account-section-icon">${icon('clock')}</div>
          <div>
            <h2>Point activity</h2>
            <p>A statement of every points purchase, deduction, and balance change.</p>
          </div>
        </div>
        ${transactions}
      </section>
    </div>`
  }

  private bindAccountActions(): void {
    document.getElementById('account-open-auth-btn')?.addEventListener('click', () => {
      void this.options.openAuthDialog()
    })
    document.getElementById('account-points-sign-in-btn')?.addEventListener('click', () => {
      void this.options.openAuthDialog()
    })
    document.querySelectorAll('.point-package-btn').forEach(button => {
      button.addEventListener('click', () => void this.startCheckout(button as HTMLButtonElement))
    })

    bindAccountPanel(async () => {
      const tripId = await consumePendingStartTripId()
      if (tripId) await this.options.startTripNow(tripId)
      await this.render()
      await this.options.renderHeaderAccount()
      await this.options.renderTripList()
    }, async () => {
      await this.render()
      await this.options.renderHeaderAccount()
    })
  }

  private async startCheckout(button: HTMLButtonElement): Promise<void> {
    const packageId = button.dataset.packageId ?? ''
    if (!packageId) return
    await withButtonLoading(button, 'Opening Stripe...', async () => {
      const returnUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('options/index.html#account')
        : `${window.location.origin}${window.location.pathname}#account`
      const extensionId = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined
      const checkout = await createPointCheckout(packageId, returnUrl, extensionId)
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: checkout.checkoutUrl })
        return
      }
      window.open(checkout.checkoutUrl, '_blank')
    })
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

  private packageName(name: string): string {
    return name.toLowerCase().includes('package') ? name : `${name} Package`
  }

  private priceLabelHTML(priceLabel: string): string {
    const match = priceLabel.trim().match(/^([A-Z]{3})\s+(.+)$/)
    if (!match) return this.escape(priceLabel)

    const [, currency, value] = match
    return this.escape(`${currency} ${this.formatPriceValue(currency, value)}`)
  }

  private formatPriceValue(currency: string, value: string): string {
    const numericValue = Number(value.replace(/,/g, ''))
    if (!Number.isFinite(numericValue)) return value

    const symbolByCurrency: Record<string, string> = {
      CAD: '$',
      USD: '$',
    }
    const symbol = symbolByCurrency[currency] ?? ''
    return `${symbol}${numericValue.toLocaleString(undefined, {
      maximumFractionDigits: Number.isInteger(numericValue) ? 0 : 2,
    })}`
  }

  private bookingEstimate(bookingCount: number): string {
    if (bookingCount <= 0) return 'Good for getting started'
    if (bookingCount === 1) return 'Enough for 1 successful booking'
    return `Enough for ${bookingCount.toLocaleString()} successful bookings`
  }

  private transactionLabel(type: string): string {
    return type
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase())
  }

  private transactionTime(value: string): number {
    const time = new Date(value).getTime()
    return Number.isNaN(time) ? 0 : time
  }

  private transactionDetails(tx: PointsSummary['recentTransactions'][number]): string {
    if (tx.details?.trim()) return tx.details.trim()
    if (tx.type === 'booking_charge') return 'Successful booking deduction'
    if (tx.type === 'stripe_purchase') return 'Point package purchase'
    if (tx.type === 'stripe_refund') return 'Point package refund'
    return 'Account activity'
  }

  private formatTransactionDateTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Recent'
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}
