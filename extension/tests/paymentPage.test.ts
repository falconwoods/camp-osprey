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
    recentTransactions: [
      {
        id: 42,
        type: 'stripe_purchase',
        pointsDelta: 500,
        balanceAfter: 700,
        sourceType: 'stripe_session',
        sourceId: 'cs_test_123',
        details: 'Starter package purchase',
        createdAt: '2026-05-30T15:45:00.000Z',
      },
      {
        id: 43,
        type: 'booking_charge',
        pointsDelta: -100,
        balanceAfter: 600,
        sourceType: 'trip',
        sourceId: 'trip_123',
        details: 'Gold Creek, Main · Site 27 · Jun 12-14',
        createdAt: '2026-06-01T15:45:00.000Z',
      },
    ],
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
    chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
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
    expect(document.getElementById('account-root')!.textContent).toContain('Activity Type')
    expect(document.getElementById('account-root')!.textContent).toContain('Points After')
    expect(document.getElementById('account-root')!.textContent).toContain('Details')
    expect(document.getElementById('account-root')!.textContent).toContain('Stripe Purchase')
    expect(document.getElementById('account-root')!.textContent).toContain('Booking Charge')
    expect(document.getElementById('account-root')!.textContent).toContain('Starter package purchase')
    expect(document.getElementById('account-root')!.textContent).toContain('Gold Creek, Main')
    expect(document.getElementById('account-root')!.textContent).toContain('Site 27')
    expect(document.getElementById('account-root')!.textContent).toContain('+500')
    expect(document.getElementById('account-root')!.textContent).toContain('-100')
    expect(document.getElementById('account-root')!.textContent).not.toContain('cs_test_123')
    expect([...document.querySelectorAll('.point-activity-row:not(.point-activity-header) [data-label="Activity Type"]')].map(node => node.textContent)).toEqual([
      'Booking Charge',
      'Stripe Purchase',
    ])
    expect([...document.querySelectorAll('.point-activity-row:not(.point-activity-header) [data-label="Points"]')].map(node => node.textContent)).toEqual([
      '-100',
      '+500',
    ])

    document.querySelector<HTMLButtonElement>('.point-package-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(createPointCheckout).toHaveBeenCalledWith(
      'starter',
      'chrome-extension://test/options/index.html#account',
      'abcdefghijklmnopabcdefghijklmnop',
    )
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/cs_123' })
  })
})
