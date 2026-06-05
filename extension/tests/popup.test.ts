import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAuth } from '../src/storage'
import type { Trip } from '../src/types'

const tripStoreMock = vi.hoisted(() => {
  let trips: Trip[] = []
  return {
    getTrips: vi.fn(async () => trips),
    updateTrip: vi.fn(async (tripId: string, updates: Partial<Trip>) => {
      const trip = trips.find(existing => existing.id === tripId)
      if (!trip) throw new Error(`Trip ${tripId} not found`)
      const updated = { ...trip, ...updates, updatedAt: Date.now() } as Trip
      trips = trips.map(existing => existing.id === tripId ? updated : existing)
      return updated
    }),
    setTrips: (nextTrips: Trip[]) => {
      trips = nextTrips
    },
  }
})

vi.mock('../src/tripStore', () => ({
  getTrips: tripStoreMock.getTrips,
  updateTrip: tripStoreMock.updateTrip,
}))

vi.mock('../src/background/login', () => ({ isLoggedIn: vi.fn(async () => true) }))
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

beforeEach(async () => {
  document.body.innerHTML = `
    <a id="settings-link"></a>
    <button id="add-trip-btn"></button>
    <span id="header-email"></span>
    <div id="global-alerts"></div>
    <div id="trips-container"></div>
  `
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
  tripStoreMock.setTrips([trip()])
  await saveAuth({ token: null, user: null, lastEmail: null })
  chrome.runtime.sendMessage = vi.fn()
  chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
  chrome.tabs.create = vi.fn()
  vi.resetModules()
})

describe('popup auth gate', () => {
  it('labels the trip management button', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('add-trip-btn')?.textContent).toBe('Manage Trip')
  })

  it('renders idle trip actions in the state panel', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    const action = document.querySelector<HTMLButtonElement>('[data-action="start"]')!
    expect(action.closest('.state-panel.idle')).toBeTruthy()
    expect(document.body.textContent).toContain('Ready to scan')
  })

  it('uses header account display when signed in', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: null,
    })
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('header-email')?.textContent).toBe('user@example.com')
    expect(document.querySelector('#global-alerts .account-cta')).toBeNull()
  })

  it('shows signed-out CTA without auth inputs', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.body.textContent).toContain('Sign in to start trips')
    expect(document.querySelector('#auth-email')).toBeNull()
    expect(document.querySelector('#auth-code')).toBeNull()
  })

  it('opens options auth dialog when signed-out CTA is clicked', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.getElementById('open-account-btn')!.click()

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options/index.html#auth',
    })
  })

  it('escapes signed-in email in the CTA', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: '<img src=x onerror=alert(1)>@example.com', role: 'user' },
      lastEmail: null,
    })
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.getElementById('header-email')?.textContent).toBe('<img src=x onerror=alert(1)>@example.com')
    expect(document.querySelector('img')).toBeNull()
  })

  it('does not send SCAN_NOW when Start is clicked signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.some(([message]) =>
      (message as { type?: string }).type === 'SCAN_NOW'
    )).toBe(false)
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options/index.html#auth',
    })
  })

  it('sends SCAN_NOW when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true)
    await import('../src/popup/index')
    await new Promise(resolve => setTimeout(resolve, 0))

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SCAN_NOW',
      tripId: 'trip-1',
      resetActiveMatch: true,
    })
  })
})
