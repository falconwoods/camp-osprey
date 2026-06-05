import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorage, saveAuth, savePayment, saveTrips } from '../src/storage'
import type { Trip } from '../src/types'
import { AccountPage } from '../src/options/Account/accountPage'
import { ParkPaymentPage } from '../src/options/settings/parkPaymentPage'
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

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Weekend',
    parks: [{ id: 'p1', name: 'Alice Lake' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' }],
    filters: { noWalkin: true, noDouble: true },
    mode: 'notify',
    status: 'idle',
    lastMatch: null,
    attempted: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('ParkPaymentPage', () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="account-root"></div><div id="payment-root"></div>'
    let stored: Record<string, unknown> = {}
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
    chrome.storage.local.set.mockImplementation((data, cb) => {
      stored = { ...stored, ...data }
      cb?.()
    })
    chrome.tabs.create = vi.fn()
    chrome.runtime.sendMessage = vi.fn()
    chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
    })
    vi.clearAllMocks()
  })

  it('renders only Park payment details', async () => {
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn() })

    await page.render()

    expect(document.getElementById('payment-root')!.textContent).toContain('Park Payment')
    expect(document.getElementById('payment-root')!.textContent).not.toContain('campsoon Points')
    expect(getPointsSummary).not.toHaveBeenCalled()
  })

  it('blocks invalid payment values before saving', async () => {
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn() })
    await page.render()

    document.querySelector<HTMLInputElement>('#card-number')!.value = '1234'
    document.querySelector<HTMLInputElement>('#card-holder')!.value = 'J'
    document.querySelector<HTMLInputElement>('#card-expiry')!.value = '01/20'
    document.querySelector<HTMLInputElement>('#card-cvv')!.value = '12x'
    document.querySelector<HTMLInputElement>('#billing-address')!.value = '1'
    document.querySelector<HTMLInputElement>('#billing-postal')!.value = '@@'

    document.querySelector<HTMLButtonElement>('#save-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).payment).toBeNull()
    expect(document.querySelector<HTMLInputElement>('#card-number')!.classList.contains('invalid')).toBe(true)
    expect(document.querySelector('#error-card-number')!.textContent).toContain('valid card number')
  })

  it('saves normalized valid payment values', async () => {
    window.alert = vi.fn()
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn() })
    await page.render()

    document.querySelector<HTMLInputElement>('#card-number')!.value = '4242 4242 4242 4242'
    document.querySelector<HTMLInputElement>('#card-holder')!.value = 'Jane Camper'
    document.querySelector<HTMLInputElement>('#card-expiry')!.value = '12/30'
    document.querySelector<HTMLInputElement>('#card-cvv')!.value = '123'
    document.querySelector<HTMLInputElement>('#billing-address')!.value = '123 Forest Road'
    document.querySelector<HTMLInputElement>('#billing-postal')!.value = 'v6b 1a1'

    document.querySelector<HTMLButtonElement>('#save-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).payment).toEqual({
      cardNumber: '4242424242424242',
      cardHolder: 'Jane Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '123 Forest Road',
      billingPostal: 'V6B 1A1',
    })
  })

  it('deletes saved payment info after confirmation', async () => {
    window.alert = vi.fn()
    window.confirm = vi.fn(() => true)
    await savePayment({
      cardNumber: '4242424242424242',
      cardHolder: 'Jane Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '123 Forest Road',
      billingPostal: 'V6B 1A1',
    })
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn() })
    await page.render()

    expect(document.querySelector<HTMLInputElement>('#card-number')!.value).toBe('4242424242424242')

    document.querySelector<HTMLButtonElement>('#delete-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(window.confirm).toHaveBeenCalledWith('Delete saved park payment info from this device?')
    expect((await getStorage()).payment).toBeNull()
    expect(document.querySelector<HTMLInputElement>('#card-number')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('#card-holder')!.value).toBe('')
  })

  it('keeps saved payment info when deletion is cancelled', async () => {
    window.confirm = vi.fn(() => false)
    await savePayment({
      cardNumber: '4242424242424242',
      cardHolder: 'Jane Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '123 Forest Road',
      billingPostal: 'V6B 1A1',
    })
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn() })
    await page.render()

    document.querySelector<HTMLButtonElement>('#delete-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).payment?.cardNumber).toBe('4242424242424242')
    expect(document.querySelector<HTMLInputElement>('#card-number')!.value).toBe('4242424242424242')
  })

  it('pauses active auto-pay trips when saved payment info is deleted', async () => {
    window.alert = vi.fn()
    window.confirm = vi.fn(() => true)
    await savePayment({
      cardNumber: '4242424242424242',
      cardHolder: 'Jane Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '123 Forest Road',
      billingPostal: 'V6B 1A1',
    })
    await saveTrips([
      trip({ id: 'active-autopay', mode: 'autopay', status: 'scanning' }),
      trip({ id: 'idle-autopay', mode: 'autopay', status: 'idle' }),
      trip({ id: 'active-hold', mode: 'hold', status: 'scanning' }),
    ])
    const renderTripList = vi.fn(async () => undefined)
    const page = new ParkPaymentPage({ openAuthDialog: vi.fn(), renderTripList })
    await page.render()

    document.querySelector<HTMLButtonElement>('#delete-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const { trips, payment } = await getStorage()
    expect(window.confirm).toHaveBeenCalledWith('Delete saved park payment info from this device? This will pause 1 active auto-pay trip.')
    expect(payment).toBeNull()
    expect(trips.find(t => t.id === 'active-autopay')?.status).toBe('paused')
    expect(trips.find(t => t.id === 'idle-autopay')?.status).toBe('idle')
    expect(trips.find(t => t.id === 'active-hold')?.status).toBe('scanning')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STOP_SCAN', tripId: 'active-autopay' })
    expect(renderTripList).toHaveBeenCalled()
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
