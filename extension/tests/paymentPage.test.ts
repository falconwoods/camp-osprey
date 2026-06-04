import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAuth } from '../src/storage'
import { AccountPage } from '../src/options/Account/accountPage'
import { PaymentPage } from '../src/options/settings/paymentPage'
import { createPointCheckout, getPointsSummary } from '../src/serverApi'

vi.mock('../src/serverApi', () => ({
  getPointsSummary: vi.fn(async () => ({
    balance: 700,
    packages: [{ id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', recommended: true }],
    successfulBookingPointCost: 100,
    recentTransactions: [],
  })),
  createPointCheckout: vi.fn(async () => ({
    checkoutUrl: 'https://checkout.stripe.com/cs_123',
    stripeSessionId: 'cs_123',
  })),
}))

describe('PaymentPage', () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="account-root"></div><div id="payment-root"></div>'
    let stored: Record<string, unknown> = {}
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })
    chrome.tabs.create = vi.fn()
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
    })
    vi.clearAllMocks()
  })

  it('renders only Park payment details', async () => {
    const page = new PaymentPage({ openAuthDialog: vi.fn() })

    await page.render()

    expect(document.getElementById('payment-root')!.textContent).toContain('Park Payment')
    expect(document.getElementById('payment-root')!.textContent).not.toContain('campsoon Points')
    expect(getPointsSummary).not.toHaveBeenCalled()
  })

  it('renders point balance on Account and starts Stripe checkout', async () => {
    const page = new AccountPage({
      openAuthDialog: vi.fn(),
      renderHeaderAccount: vi.fn(),
      renderTripList: vi.fn(),
      startTripNow: vi.fn(),
    })

    await page.render()

    expect(getPointsSummary).toHaveBeenCalled()
    expect(document.getElementById('account-root')!.textContent).toContain('700 points')
    expect(document.getElementById('account-root')!.textContent).toContain('Starter')
    expect(document.getElementById('account-root')!.textContent).toContain('CAD')
    expect(document.getElementById('account-root')!.textContent).toContain('$5')

    document.querySelector<HTMLButtonElement>('.point-package-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(createPointCheckout).toHaveBeenCalledWith('starter')
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/cs_123' })
  })
})
