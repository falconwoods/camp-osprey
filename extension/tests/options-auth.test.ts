import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAuth, saveTrips } from '../src/storage'
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

import { requestCode, validateAuth, verifyCode } from '../src/auth'

function trip(): Trip {
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
      <div class="tab active" data-tab="trips"></div>
      <div class="tab" data-tab="payment"></div>
      <div class="tab" data-tab="settings"></div>
      <div class="tab" data-tab="account"></div>
      <div class="tab" data-tab="logs"></div>
      <div id="tab-trips"><div id="global-alerts"></div><div id="trip-list"></div><button id="new-trip-btn"></button></div>
      <div id="tab-payment" class="hidden"></div>
      <div id="tab-settings" class="hidden"></div>
      <div id="tab-account" class="hidden"><div id="account-root"></div></div>
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
      <input id="card-number"><input id="card-holder"><input id="card-expiry"><input id="card-cvv">
      <input id="billing-address"><input id="billing-postal"><input id="party-size">
      <button id="save-payment-btn"></button>
      <button class="theme-btn" data-theme-choice="auto"></button>
      <button class="theme-btn" data-theme-choice="light"></button>
      <button class="theme-btn" data-theme-choice="dark"></button>
      <select id="poll-interval"><option value="60"></option></select>
      <input id="debug-mode" type="checkbox">
      <button id="test-notif-btn"></button>
      <button id="save-settings-btn"></button>
    </div>
    <div id="trip-editor" class="hidden">
      <button id="back-btn"></button>
      <div id="editor-status-bar" class="hidden"></div><div id="editor-status-badge"></div>
      <div id="section-name"><input class="input" id="trip-name"><div class="field-error" id="error-name"></div></div>
      <div id="section-parks"><div id="parks-list"></div><input class="input" id="park-search"><div id="park-results"></div><div class="field-error" id="error-parks"></div></div>
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
      <input id="filter-walkin" type="checkbox"><input id="filter-double" type="checkbox">
      <button id="save-trip-btn"></button>
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
  await saveTrips([trip()])
  await saveAuth({ token: null, user: null, lastEmail: null })
  vi.resetModules()
})

describe('options auth gate', () => {
  it('shows lightweight sign-in banner without auth inputs while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.body.textContent).toContain('Sign in to start trips')
    expect(document.querySelector('#global-alerts #auth-email')).toBeNull()
    expect(document.querySelector('#global-alerts #auth-code')).toBeNull()
  })

  it('escapes signed-in email in the Trips account banner', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: '<img src=x onerror=alert(1)>@example.com', role: 'user' },
      lastEmail: null,
    })
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('#global-alerts img')).toBeNull()
    expect(document.querySelector('#global-alerts')!.textContent).toContain('<img src=x onerror=alert(1)>@example.com')
  })

  it('selects Account tab from hash and renders auth form', async () => {
    location.hash = '#account'
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
    expect(document.querySelector('#account-root #auth-email')).not.toBeNull()
  })

  it('routes to Account tab on hash changes after startup', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    location.hash = '#account'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
    expect(document.querySelector('#account-root #auth-email')).not.toBeNull()
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
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
      auth: { token: null, user: null, lastEmail: null },
    }))

    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('[data-tab="logs"]')!.classList.contains('active')).toBe(true)
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
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
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
      settings: { pollIntervalSeconds: 60, debugMode: true, theme: 'auto' },
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
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(sentScanNow()).toBe(false)
    expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
    expect(chrome.tabs.create).not.toHaveBeenCalled()

    ;(document.querySelector('#account-root #auth-email') as HTMLInputElement).value = 'user@example.com'
    document.querySelector<HTMLButtonElement>('#account-root #auth-send-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requestCode).toHaveBeenCalledWith({ email: 'user@example.com' })
    expect(sentScanNow()).toBe(false)

    ;(document.querySelector('#account-root #auth-code') as HTMLInputElement).value = '123456'
    document.querySelector<HTMLButtonElement>('#account-root #auth-verify-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(verifyCode).toHaveBeenCalledWith({ email: 'user@example.com', code: '123456' })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SCAN_NOW',
      tripId: 'trip-1',
      resetActiveMatch: true,
    })
  })
})
