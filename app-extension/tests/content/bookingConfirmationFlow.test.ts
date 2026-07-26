import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMessageCode } from '../../src/protocol'

const chromeMock = chrome as any

const target = {
  provider: 'bc_parks',
  resourceId: 'site-1',
  siteName: '18',
  sectionName: 'Main',
  parkName: 'Park 1',
  tripId: 'trip-1',
  mode: 'reserve',
  noDouble: false,
  noWalkin: false,
  checkIn: '2026-07-04',
  checkOut: '2026-07-05',
  scanLease: 'lease-1',
  setAt: Date.now(),
}

function renderBookingConfirmationPage(): void {
  document.body.innerHTML = `
    <app-checkout-confirmation>
      <h1 id="pageTitle">Success!</h1>
      <div id="confirmationMessage_1">
        You have successfully made a reservation for <strong>Campsite 18</strong>.
      </div>
      <div class="success-reference" id="referenceNumber_1">
        <p class="success-reference-number"> Reservation Number: BCIN123B1 </p>
      </div>
    </app-checkout-confirmation>
  `
}

function renderPaymentFailurePage(): void {
  document.body.innerHTML = `
    <app-payment>
      <h1 id="pageTitle">Payment</h1>
      <div role="alert" aria-live="assertive" class="alert-box error-box">
        <div class="alert-box-title">Payment was unsuccessful</div>
        <div>The payment was unsuccessful. Please try again.</div>
      </div>
      <button id="applyPaymentButton">Apply payment</button>
    </app-payment>
  `
}

function setUrl(url: string): void {
  window.history.replaceState({}, '', url)
}

function mockTargetLookup(overrides: Partial<typeof target> = {}): void {
  chromeMock.runtime.sendMessage.mockImplementation((message: unknown, callback?: (response?: unknown) => void) => {
    if ((message as { t?: number }).t === RuntimeMessageCode.getCampsoonTarget) {
      const response = { ok: true, target: { ...target, ...overrides, setAt: Date.now() } }
      callback?.(response)
      return Promise.resolve(response)
    }
    callback?.()
    return Promise.resolve(undefined)
  })
}

describe('BC Parks content booking confirmation flow', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'))
    document.body.innerHTML = ''
    setUrl('/create-booking/confirmation/cart/transaction')
    chromeMock.runtime.sendMessage.mockReset()
    chromeMock.storage.local.remove.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports paid booking confirmation for an auto-reserve trip after manual payment', async () => {
    renderBookingConfirmationPage()
    mockTargetLookup({ mode: 'reserve' })

    await import('../../src/content/bcparks')
    await Promise.resolve()

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId: 'trip-1',
      scanLease: 'lease-1',
      confirmationNumber: 'BCIN123B1',
      bookingUrl: expect.stringContaining('/create-booking/confirmation/cart/transaction'),
      paidAt: '2026-06-05T12:00:00.000Z',
    }))
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ t: RuntimeMessageCode.clearCampsoonTarget }, expect.any(Function))
  })

  it('does not auto-drive checkout for an auto-reserve trip on a manual payment page', async () => {
    setUrl('/create-booking/payment')
    document.body.innerHTML = '<app-payment><h1 id="pageTitle">Payment</h1><button>Apply payment</button></app-payment>'
    mockTargetLookup({ mode: 'reserve' })

    await import('../../src/content/bcparks')
    await Promise.resolve()

    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.getDecryptedPayment,
    }))
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingConfirmed,
    }))
  })

  it('does not report a paid booking when auto-pay lands on a payment failure page', async () => {
    setUrl('/create-booking/payment/cart/transaction')
    renderPaymentFailurePage()
    mockTargetLookup({ mode: 'autopay' })

    await import('../../src/content/bcparks')
    await vi.advanceTimersByTimeAsync(1600)

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingFailed,
      tripId: 'trip-1',
      scanLease: 'lease-1',
      error: expect.stringContaining('Payment was unsuccessful'),
    }))
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingConfirmed,
    }))
  })

  it('keeps the reservation target after auto-reserve hold so later manual payment can be attributed', async () => {
    setUrl('/create-booking/reservationmessages')
    document.body.innerHTML = '<button>Confirm reservation details</button>'
    mockTargetLookup({ mode: 'reserve' })

    await import('../../src/content/bcparks')
    await vi.advanceTimersByTimeAsync(3600)

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingReserved,
      tripId: 'trip-1',
      scanLease: 'lease-1',
    }))
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith({ t: RuntimeMessageCode.clearCampsoonTarget }, expect.any(Function))
    expect(chromeMock.storage.local.remove).not.toHaveBeenCalledWith('campOspreyTarget')
  })
})

describe('Parks Canada content booking confirmation flow', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'))
    document.body.innerHTML = ''
    setUrl('/create-booking/confirmation/cart/transaction')
    chromeMock.runtime.sendMessage.mockReset()
    chromeMock.storage.local.remove.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports paid booking confirmation for an auto-reserve trip after manual payment', async () => {
    renderBookingConfirmationPage()
    mockTargetLookup({ provider: 'parks_canada', mode: 'reserve' })

    await import('../../src/content/parksCanada')
    await Promise.resolve()

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      t: RuntimeMessageCode.bookingConfirmed,
      tripId: 'trip-1',
      scanLease: 'lease-1',
      confirmationNumber: 'BCIN123B1',
      bookingUrl: expect.stringContaining('/create-booking/confirmation/cart/transaction'),
      paidAt: '2026-06-05T12:00:00.000Z',
    }))
  })
})
