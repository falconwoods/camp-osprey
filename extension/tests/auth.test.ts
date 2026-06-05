import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestCode, signOut, validateAuth, verifyCode } from '../src/auth'
import { notifyUserResult, sendExtensionLogs } from '../src/serverApi'
import { getAuth, saveAuth } from '../src/storage'

beforeEach(() => {
  vi.restoreAllMocks()
  let stored: Record<string, unknown> = {}
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
  chrome.storage.local.set.mockImplementation((data, cb) => {
    stored = { ...stored, ...data }
    cb?.()
  })
})

describe('extension auth client', () => {
  it('requests an email code without sending name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNewUser: false }), { status: 200 })))

    await expect(requestCode({ email: 'user@example.com' })).resolves.toEqual({ ok: true, isNewUser: false })

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({
      email: 'user@example.com',
      clientId: expect.any(String),
      clientInfo: expect.objectContaining({
        extensionVersion: '0.1.0',
        platformOs: 'mac',
        platformArch: 'arm',
      }),
    }))
    expect(body.name).toBeUndefined()
  })

  it('stores auth after verifying code without sending name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      pointsBalance: 700,
    }), { status: 200 })))

    await verifyCode({ email: 'user@example.com', code: '123456' })

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({
      email: 'user@example.com',
      code: '123456',
      clientId: expect.any(String),
      clientInfo: expect.objectContaining({
        extensionVersion: '0.1.0',
        platformOs: 'mac',
        platformArch: 'arm',
      }),
    }))
    expect(body.name).toBeUndefined()
    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: 'user@example.com',
      pointsBalance: 700,
    })
  })

  it('validates a stored token with /api/user', async () => {
    await saveAuth({ token: 'tok', user: null, lastEmail: 'user@example.com' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'u1',
      email: 'user@example.com',
      name: 'Eric',
      role: 'user',
      pointsBalance: 700,
    }), { status: 200 })))

    await expect(validateAuth()).resolves.toBe(true)
    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
      pointsBalance: 700,
    })
  })

  it('stores a refreshed auth token returned by the server', async () => {
    await saveAuth({ token: 'old-token', user: null, lastEmail: 'user@example.com' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'u1',
      email: 'user@example.com',
      name: 'Eric',
      role: 'user',
      pointsBalance: 700,
    }), {
      status: 200,
      headers: { 'set-auth-token': 'new-token' },
    })))

    await expect(validateAuth()).resolves.toBe(true)
    await expect(getAuth()).resolves.toEqual({
      token: 'new-token',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
      pointsBalance: 700,
    })
  })

  it('clears token and user when validation fails', async () => {
    await saveAuth({
      token: 'bad',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))

    await expect(validateAuth()).resolves.toBe(false)
    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com', pointsBalance: null })
  })

  it('signs out while keeping lastEmail', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })

    await signOut()

    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com', pointsBalance: null })
  })

  it('reports a trip result with bearer auth', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, emailSent: true }), { status: 200 })))

    await expect(notifyUserResult('trip 1', {
      outcome: 'hold_placed',
      matchedSite: {
        parkName: 'Park 1',
        sectionName: 'Main',
        siteName: 'A1',
        checkIn: '2026-07-04',
        checkOut: '2026-07-05',
        bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
        resourceId: 'site-1',
      },
    })).resolves.toEqual({ ok: true, emailSent: true })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/trips/trip%201/result'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"outcome":"hold_placed"'),
      }),
    )
    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.clientId).toEqual(expect.any(String))
    expect(body.clientInfo).toEqual(expect.objectContaining({
      extensionVersion: '0.1.0',
      platformOs: 'mac',
      platformArch: 'arm',
    }))
  })

  it('sends extension logs in a bearer-authenticated batch', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, accepted: 1 }), { status: 200 })))

    await expect(sendExtensionLogs([{
      ts: '2026-05-31T12:00:00.000Z',
      level: 'error',
      event: 'trip_scan_error',
      message: 'Error scanning trip',
      tripId: 'trip-1',
    }])).resolves.toEqual({ ok: true, accepted: 1 })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/extension-logs'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"event":"trip_scan_error"'),
      }),
    )
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.clientId).toEqual(expect.any(String))
    expect(body.clientInfo).toEqual(expect.objectContaining({
      extensionVersion: '0.1.0',
      platformOs: 'mac',
      platformArch: 'arm',
    }))
    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })
})
