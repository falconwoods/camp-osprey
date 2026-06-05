import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorage, saveAuth, savePayment, saveTrips } from '../src/storage'
import type { DebugLogEntry, Trip } from '../src/types'

vi.mock('../src/background/login', () => ({
  isLoggedIn: vi.fn(async () => true),
  watchLoginChanges: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', role: 'user' } })),
  validateAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))

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
  syncTripToServer: vi.fn(async (trip: Trip) => trip),
  softDeleteTripOnServer: vi.fn(async () => ({ ok: true })),
  sendTripResult: vi.fn(async () => ({ ok: true, emailSent: true })),
  sendExtensionLogs: vi.fn(async () => ({ ok: true, accepted: 1 })),
  getServerBaseUrl: vi.fn(() => 'https://campsoon.com'),
}))

import { requestCode, validateAuth, verifyCode } from '../src/auth'

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

function logEntry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
  return {
    ts: '2026-05-27T00:42:05.000Z',
    level: 'info',
    event: 'site_found',
    message: 'Found site',
    ...overrides,
  }
}

function renderFixture(): void {
  document.body.innerHTML = `
    <div id="trips-view">
      <div id="header-account"></div>
      <div class="tab active" data-tab="trips"></div>
      <div class="tab" data-tab="settings"></div>
      <div class="tab" data-tab="account"></div>
      <div class="tab" data-tab="payment"></div>
      <div class="tab hidden" data-tab="logs"></div>
      <div id="tab-trips"><div id="global-alerts"></div><div id="trip-list"></div><button id="new-trip-btn"></button></div>
      <div id="tab-settings" class="hidden">
        <div id="tab-settings-general"></div>
      </div>
      <div id="tab-account" class="hidden">
        <div id="account-root"></div>
      </div>
      <div id="tab-payment" class="hidden">
        <div id="payment-root"></div>
      </div>
      <div id="tab-logs" class="hidden">
        <input id="log-autoscroll" type="checkbox" checked>
        <button class="log-level-btn active" data-log-level="debug"></button>
        <button class="log-level-btn active" data-log-level="info"></button>
        <button class="log-level-btn active" data-log-level="warning"></button>
        <button class="log-level-btn active" data-log-level="error"></button>
        <button id="copy-log-jsonl-btn"></button>
        <button id="clear-log-btn"></button>
        <div id="debug-log-box"></div>
      </div>
      <button class="theme-btn" data-theme-choice="auto"></button>
      <button class="theme-btn" data-theme-choice="light"></button>
      <button class="theme-btn" data-theme-choice="dark"></button>
      <select id="poll-interval"><option value="60"></option></select>
      <input id="debug-mode" type="checkbox">
      <input id="email-on-site-found" type="checkbox">
      <button id="test-notif-btn"></button>
    </div>
    <div id="trip-editor" class="hidden">
      <button id="back-btn"></button>
      <h1 id="editor-trip-title"></h1>
      <div id="editor-status-bar" class="hidden"></div><div id="editor-status-badge"></div>
      <div id="section-name"><input class="input" id="trip-name"><div class="field-error" id="error-name"></div></div>
      <div id="section-parks"><div id="parks-list"></div><input class="input" id="park-search"><button id="park-add-btn"></button><div id="park-results"></div><div class="field-error" id="error-parks"></div></div>
      <div id="section-dates"><div id="dates-list"></div><div class="field-error" id="error-dates"></div></div>
      <button class="date-mode-btn active" data-mode="specific"></button>
      <button class="date-mode-btn" data-mode="recurring"></button>
      <div id="specific-inputs"></div><div id="recurring-inputs" class="hidden"></div>
      <input id="date-checkin" type="date"><input id="date-checkout" type="date">
      <select id="rec-start-day"><option value="4" selected>Friday</option></select>
      <select id="rec-end-day"></select>
      <select id="rec-month"><option value="7">July</option></select>
      <select id="rec-year"></select>
      <div id="rec-preview"></div>
      <button id="add-date-btn"></button>
      <select id="trip-mode"><option value="notify"></option><option value="hold"></option><option value="autopay"></option></select>
      <div id="trip-mode-help"></div>
      <input id="filter-walkin" type="checkbox"><input id="filter-double" type="checkbox">
      <button id="save-trip-btn"></button>
      <button id="start-trip-btn"></button>
      <button id="delete-trip-btn"></button>
    </div>
  `
}

function sentScanNow(): boolean {
  return vi.mocked(chrome.runtime.sendMessage).mock.calls.some(([message]) =>
    (message as { type?: string }).type === 'SCAN_NOW'
  )
}

beforeEach(async () => {
  location.hash = ''
  renderFixture()
  let stored: Record<string, unknown> = {}
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
  chrome.storage.local.set.mockImplementation((data, cb) => {
    stored = { ...stored, ...data }
    cb?.()
  })
  chrome.storage.local.remove.mockImplementation((_key, cb) => cb?.())
  ;(chrome.storage as unknown as { onChanged: { addListener: ReturnType<typeof vi.fn> } }).onChanged = {
    addListener: vi.fn(),
  }
  chrome.runtime.sendMessage = vi.fn()
  chrome.runtime.getURL = vi.fn((path: string) => path)
  chrome.tabs.create = vi.fn()
  Object.defineProperty(window, 'confirm', {
    value: vi.fn(() => true),
    writable: true,
  })
  await saveTrips([trip()])
  await saveAuth({ token: null, user: null, lastEmail: null })
  vi.resetModules()
})

describe('options auth gate', () => {
  it('shows lightweight sign-in banner without auth inputs while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('#header-account')!.textContent).toContain('Sign in')
    expect(document.querySelector('#header-account')!.textContent).not.toContain('Sign in to start trips')
    expect(document.querySelector('#global-alerts #auth-email')).toBeNull()
    expect(document.querySelector('#global-alerts #auth-code')).toBeNull()
  })

  it('shows signed-in point balance in the Trips account banner', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: '<img src=x onerror=alert(1)>@example.com', role: 'user' },
      lastEmail: null,
      pointsBalance: 700,
    })
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('#header-account img')).toBeNull()
    expect(document.querySelector('#header-account .points-icon svg')).not.toBeNull()
    expect(document.querySelector('#header-account .icon-only-btn')).toBeNull()
    expect(document.querySelector('#header-account')!.textContent).toContain('700 points')
    expect(document.querySelector('#header-account')!.textContent).not.toContain('<img src=x onerror=alert(1)>@example.com')
  })

  it('selects Account tab from hash and renders account management', async () => {
    location.hash = '#account'
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-settings')!.classList.contains('hidden')).toBe(true)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('account-root')!.textContent).toContain('Not signed in')
    expect(document.querySelector('#account-root #auth-email')).toBeNull()
    expect(document.getElementById('tab-payment')!.classList.contains('hidden')).toBe(true)
  })

  it('selects Payment tab from hash and renders locked payment form when signed out', async () => {
    location.hash = '#payment'
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="payment"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-settings')!.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(true)
    expect(document.getElementById('tab-payment')!.classList.contains('hidden')).toBe(false)
    expect(document.querySelector<HTMLInputElement>('#payment-root #card-number')!.disabled).toBe(true)
    expect(document.getElementById('payment-root')!.textContent).toContain('Sign in to add or edit payment information.')
  })

  it('enables payment fields when signed in', async () => {
    location.hash = '#payment'
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
      pointsBalance: 700,
    })

    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="payment"]')!.classList.contains('active')).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#payment-root #card-number')!.disabled).toBe(false)
    expect(document.querySelector('#payment-root #save-payment-btn')).not.toBeNull()
    expect(document.getElementById('payment-root')!.textContent).not.toContain('Sign in to add or edit payment information.')
  })

  it('routes to Account tab on hash changes after startup', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    location.hash = '#account'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-settings')!.classList.contains('hidden')).toBe(true)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('account-root')!.textContent).toContain('Not signed in')
    expect(document.querySelector('#account-root #auth-email')).toBeNull()
  })

  it('opens auth dialog from auth hash', async () => {
    location.hash = '#auth'
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.body.classList.contains('auth-dialog-open')).toBe(true)
    expect(document.querySelector('#auth-dialog-root .auth-card-brand')!.textContent).toContain('campsoon')
    expect(document.querySelector('#auth-dialog-root #auth-email')).not.toBeNull()
  })

  it('hides Logs tab while debug mode is disabled', async () => {
    location.hash = '#logs'
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="logs"]')!.classList.contains('hidden')).toBe(true)
    expect(document.querySelector('[data-tab="trips"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-logs')!.classList.contains('hidden')).toBe(true)
  })

  it('persists debug mode toggle and reveals Logs tab', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    const debugMode = document.getElementById('debug-mode') as HTMLInputElement
    debugMode.checked = true
    debugMode.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="logs"]')!.classList.contains('hidden')).toBe(false)
    expect((await getStorage()).settings.debugMode).toBe(true)
  })

  it('autosaves theme and poll interval settings', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-theme-choice="dark"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await getStorage()).settings.theme).toBe('dark')

    const interval = document.getElementById('poll-interval') as HTMLSelectElement
    interval.innerHTML = '<option value="30">30</option><option value="60">60</option>'
    interval.value = '30'
    interval.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).settings.pollIntervalSeconds).toBe(30)
  })

  it('autosaves the site-found email setting', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    const emailOnSiteFound = document.getElementById('email-on-site-found') as HTMLInputElement
    emailOnSiteFound.checked = true
    emailOnSiteFound.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).settings.emailOnSiteFound).toBe(true)
  })

  it('does not refresh the trip list while Account tab is active', async () => {
    location.hash = '#account'
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.getElementById('trip-list')!.textContent = 'keep account input stable'
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0]
    listener({ trips: { oldValue: [], newValue: [trip()] } }, 'local')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('account-root')!.textContent).toContain('Not signed in')
    expect(document.querySelector('#account-root #auth-email')).toBeNull()
    expect(document.getElementById('trip-list')!.textContent).toBe('keep account input stable')
  })

  it('selects Logs tab from hash and renders structured log rows', async () => {
    location.hash = '#logs'
    await saveTrips([trip()])
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
      trips: [trip()],
      debugLog: [
        logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
        logEntry({ level: 'error', event: 'booking_failed', message: 'Payment failed', error: 'card declined' }),
      ],
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto', logSyncMinLevel: 'info' },
      auth: { token: null, user: null, lastEmail: null },
    }))

    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="logs"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-settings')!.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('tab-logs')!.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('debug-log-box')!.textContent).toContain('park_checked')
    expect(document.getElementById('debug-log-box')!.textContent).toContain('booking_failed')
  })

  it('filters logs by level when a level chip is toggled', async () => {
    location.hash = '#logs'
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
      trips: [trip()],
      debugLog: [
        logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
        logEntry({ level: 'error', event: 'booking_failed', message: 'Payment failed' }),
      ],
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto', logSyncMinLevel: 'info' },
      auth: { token: null, user: null, lastEmail: null },
    }))

    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-log-level="debug"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('debug-log-box')!.textContent).not.toContain('park_checked')
    expect(document.getElementById('debug-log-box')!.textContent).toContain('booking_failed')
  })

  it('copies filtered logs as JSONL', async () => {
    location.hash = '#logs'
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({
      trips: [trip()],
      debugLog: [
        logEntry({ level: 'debug', event: 'park_checked', message: 'Checking park' }),
        logEntry({ level: 'info', event: 'site_found', message: 'Found site' }),
      ],
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto', logSyncMinLevel: 'info' },
      auth: { token: null, user: null, lastEmail: null },
    }))

    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))
    document.querySelector<HTMLButtonElement>('[data-log-level="debug"]')!.click()
    document.getElementById('copy-log-jsonl-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(logEntry({ level: 'info', event: 'site_found', message: 'Found site' })))
  })

  it('stores pending trip and resumes it after Account verification', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    vi.mocked(verifyCode).mockImplementationOnce(async () => {
      const result = { token: 'tok', user: { id: 'u1', email: 'user@example.com', role: 'user' } }
      await saveAuth({ ...result, lastEmail: result.user.email, pointsBalance: 700 })
      return result
    })
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(sentScanNow()).toBe(false)
    expect(document.body.classList.contains('auth-dialog-open')).toBe(true)
    expect(chrome.tabs.create).not.toHaveBeenCalled()

    ;(document.querySelector('#auth-dialog-root #auth-email') as HTMLInputElement).value = 'user@example.com'
    document.querySelector<HTMLButtonElement>('#auth-dialog-root #auth-send-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requestCode).toHaveBeenCalledWith({ email: 'user@example.com' })
    expect(sentScanNow()).toBe(false)

    ;(document.querySelector('#auth-dialog-root #auth-code') as HTMLInputElement).value = '123456'
    document.querySelector<HTMLButtonElement>('#auth-dialog-root #auth-verify-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(verifyCode).toHaveBeenCalledWith({ email: 'user@example.com', code: '123456' })
    expect(document.querySelector('#header-account')!.textContent).toContain('700 points')
    expect(document.querySelector('#header-account')!.textContent).not.toContain('Sign in to start trips')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SCAN_NOW',
      tripId: 'trip-1',
      resetActiveMatch: true,
    })
  })

  it('confirms before deleting from the trip list', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-delete]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(window.confirm).toHaveBeenCalledWith('Delete "Weekend"?')
    expect((await getStorage()).trips).toHaveLength(0)
  })

  it('saves parks in drag-and-drop priority order', async () => {
    await saveTrips([{
      ...trip(),
      parks: [
        { id: 'p1', name: 'Alice Lake' },
        { id: 'p2', name: 'Porteau Cove' },
      ],
    }])
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const parkChips = () => Array.from(document.querySelectorAll<HTMLElement>('#parks-list .park-chip'))
    expect(parkChips().map(chip => chip.textContent)).toEqual([
      expect.stringContaining('Alice Lake'),
      expect.stringContaining('Porteau Cove'),
    ])

    parkChips()[0].dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
    parkChips()[1].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    expect(parkChips().map(chip => chip.textContent)).toEqual([
      expect.stringContaining('Porteau Cove'),
      expect.stringContaining('Alice Lake'),
    ])

    document.getElementById('save-trip-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await getStorage()).trips[0].parks.map(park => park.name)).toEqual(['Porteau Cove', 'Alice Lake'])
  })

  it('does not add duplicate date ranges', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const dateRows = () => Array.from(document.querySelectorAll('#dates-list .range-summary'))
    expect(dateRows()).toHaveLength(1)

    ;(document.getElementById('date-checkin') as HTMLInputElement).value = '2026-07-04'
    ;(document.getElementById('date-checkout') as HTMLInputElement).value = '2026-07-05'
    document.getElementById('add-date-btn')!.click()

    expect(dateRows()).toHaveLength(1)
    expect(document.getElementById('error-dates')!.textContent).toBe('Date range already added.')

    ;(document.getElementById('date-checkout') as HTMLInputElement).value = '2026-07-06'
    document.getElementById('add-date-btn')!.click()

    expect(dateRows()).toHaveLength(2)
    expect(document.getElementById('error-dates')!.textContent).toBe('')
  })

  it('disables Save & Start Scanning while the async start flow is running', async () => {
    let finishAuth!: () => void
    vi.mocked(validateAuth).mockImplementationOnce(() => new Promise<boolean>(resolve => {
      finishAuth = () => resolve(true)
    }))
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const startButton = document.getElementById('start-trip-btn') as HTMLButtonElement
    startButton.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(startButton.disabled).toBe(true)
    expect(startButton.getAttribute('aria-busy')).toBe('true')
    expect(startButton.textContent).toContain('Starting...')

    startButton.click()
    expect(sentScanNow()).toBe(false)

    finishAuth()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SCAN_NOW',
      tripId: 'trip-1',
      resetActiveMatch: true,
    })
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([message]) =>
      (message as { type?: string }).type === 'SCAN_NOW'
    )).toHaveLength(1)
    expect(startButton.disabled).toBe(false)
    expect(startButton.getAttribute('aria-busy')).toBeNull()
  })

  it('blocks auto-pay scanning when Park Payment is not configured', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    ;(document.getElementById('trip-mode') as HTMLSelectElement).value = 'autopay'
    document.getElementById('start-trip-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(sentScanNow()).toBe(false)
    expect((await getStorage()).trips[0].mode).toBe('notify')
    expect(document.getElementById('trip-mode')!.classList.contains('invalid')).toBe(true)
    expect(document.getElementById('trip-mode-help')!.textContent).toContain('Payment required')
    expect(document.getElementById('trip-mode-help')!.textContent).toContain('Add valid Park Payment info before starting Auto-pay.')
  })

  it('saves auto-pay trip settings without starting when Park Payment is not configured', async () => {
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    ;(document.getElementById('trip-mode') as HTMLSelectElement).value = 'autopay'
    document.getElementById('save-trip-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const { trips } = await getStorage()
    expect(sentScanNow()).toBe(false)
    expect(trips[0].mode).toBe('autopay')
    expect(trips[0].status).toBe('idle')
  })

  it('blocks starting an existing auto-pay trip when Park Payment is not configured', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
      pointsBalance: 700,
    })
    await saveTrips([trip({ mode: 'autopay', status: 'idle' })])
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const { trips } = await getStorage()
    expect(sentScanNow()).toBe(false)
    expect(trips[0].status).toBe('idle')
    expect(document.getElementById('global-alerts')!.textContent).toContain('Park Payment required')
    expect(document.getElementById('global-alerts')!.textContent).toContain('Add valid Park Payment info before starting an auto-pay trip.')
  })

  it('clears the missing Park Payment alert after payment info is saved', async () => {
    window.alert = vi.fn()
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
      pointsBalance: 700,
    })
    await saveTrips([trip({ mode: 'autopay', status: 'idle' })])
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('global-alerts')!.textContent).toContain('Park Payment required')

    document.querySelector<HTMLButtonElement>('[data-open-payment-settings]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    ;(document.getElementById('card-number') as HTMLInputElement).value = '4111111111111111'
    ;(document.getElementById('card-holder') as HTMLInputElement).value = 'Test Camper'
    ;(document.getElementById('card-expiry') as HTMLInputElement).value = '12/30'
    ;(document.getElementById('card-cvv') as HTMLInputElement).value = '123'
    ;(document.getElementById('billing-address') as HTMLInputElement).value = '1 Park Road'
    ;(document.getElementById('billing-postal') as HTMLInputElement).value = 'V6B 1A1'
    document.getElementById('save-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(window.alert).toHaveBeenCalledWith('Payment info saved.')
    expect(document.getElementById('global-alerts')!.textContent).not.toContain('Park Payment required')
    expect(document.getElementById('global-alerts')!.textContent).not.toContain('Add valid Park Payment info before starting an auto-pay trip.')
  })

  it('shows the Park Payment alert after saved payment info is deleted for an auto-pay trip', async () => {
    window.alert = vi.fn()
    window.confirm = vi.fn(() => true)
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
      pointsBalance: 700,
    })
    await savePayment({
      cardNumber: '4111111111111111',
      cardHolder: 'Test Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '1 Park Road',
      billingPostal: 'V6B 1A1',
    })
    await saveTrips([trip({ mode: 'autopay', status: 'scanning' })])
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('global-alerts')!.textContent).not.toContain('Park Payment required')

    document.querySelector<HTMLElement>('[data-tab="payment"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    document.getElementById('delete-payment-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    const { trips, payment } = await getStorage()
    expect(payment).toBeNull()
    expect(trips[0].status).toBe('paused')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STOP_SCAN', tripId: 'trip-1' })
    expect(document.getElementById('global-alerts')!.textContent).toContain('Park Payment required')
    expect(document.getElementById('global-alerts')!.textContent).toContain('Add valid Park Payment info before using auto-pay trips.')
  })

  it('allows auto-pay scanning when Park Payment is configured', async () => {
    await savePayment({
      cardNumber: '4111111111111111',
      cardHolder: 'Test Camper',
      cardExpiry: '12/30',
      cardCvv: '123',
      billingAddress: '1 Park Road',
      billingPostal: 'V6B 1A1',
    })
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-edit-trip]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    ;(document.getElementById('trip-mode') as HTMLSelectElement).value = 'autopay'
    document.getElementById('start-trip-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SCAN_NOW',
      tripId: 'trip-1',
      resetActiveMatch: true,
    })
    expect((await getStorage()).trips[0].mode).toBe('autopay')
  })

  it('keeps the trip when list deletion is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-delete]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(window.confirm).toHaveBeenCalledWith('Delete "Weekend"?')
    expect((await getStorage()).trips).toHaveLength(1)
  })
})
