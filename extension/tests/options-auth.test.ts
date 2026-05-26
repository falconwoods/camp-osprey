import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAuth, saveTrips } from '../src/storage'
import type { Trip } from '../src/types'

vi.mock('../src/background/login', () => ({
  isLoggedIn: vi.fn(async () => true),
  watchLoginChanges: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' } })),
  validateAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))

import { validateAuth } from '../src/auth'

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

function renderFixture(): void {
  document.body.innerHTML = `
    <div id="trips-view">
      <div class="tab active" data-tab="trips"></div>
      <div class="tab" data-tab="payment"></div>
      <div class="tab" data-tab="settings"></div>
      <div id="tab-trips"><div id="global-alerts"></div><div id="trip-list"></div><button id="new-trip-btn"></button></div>
      <div id="tab-payment" class="hidden"></div>
      <div id="tab-settings" class="hidden"></div>
      <input id="card-number"><input id="card-holder"><input id="card-expiry"><input id="card-cvv">
      <input id="billing-address"><input id="billing-postal"><input id="party-size">
      <button id="save-payment-btn"></button>
      <button class="theme-btn" data-theme-choice="auto"></button>
      <button class="theme-btn" data-theme-choice="light"></button>
      <button class="theme-btn" data-theme-choice="dark"></button>
      <select id="poll-interval"><option value="60"></option></select>
      <input id="debug-mode" type="checkbox">
      <div id="debug-section" class="hidden"></div>
      <button id="test-notif-btn"></button>
      <button id="save-settings-btn"></button>
      <div id="debug-log-box"></div>
      <button id="clear-log-btn"></button>
      <button id="copy-log-btn"></button>
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

beforeEach(async () => {
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
  await saveTrips([trip()])
  await saveAuth({ token: null, user: null, lastEmail: null })
  vi.resetModules()
})

describe('options auth gate', () => {
  it('shows sign-in banner while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.body.textContent).toContain('Sign in to start trips')
    expect(document.body.textContent).toContain('Check Spam, Junk, or Trash')
  })

  it('does not send SCAN_NOW when Start is clicked signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/options/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'SCAN_NOW', tripId: 'trip-1' })
  })
})
