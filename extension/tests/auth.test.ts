import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestCode, signOut, validateAuth, verifyCode } from '../src/auth'
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
  it('requests an email code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNewUser: false }), { status: 200 })))

    await expect(requestCode({ email: 'user@example.com' })).resolves.toEqual({ ok: true, isNewUser: false })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/extension-auth/request-code'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('stores auth after verifying code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
    }), { status: 200 })))

    await verifyCode({ email: 'user@example.com', code: '123456', name: 'Eric' })

    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })
  })

  it('validates a stored token with /api/user', async () => {
    await saveAuth({ token: 'tok', user: null, lastEmail: 'user@example.com' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'u1',
      email: 'user@example.com',
      name: 'Eric',
      role: 'user',
    }), { status: 200 })))

    await expect(validateAuth()).resolves.toBe(true)
    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
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
    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com' })
  })

  it('signs out while keeping lastEmail', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    })

    await signOut()

    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com' })
  })
})
