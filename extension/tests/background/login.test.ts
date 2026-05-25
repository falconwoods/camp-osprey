import { describe, it, expect } from 'vitest'
import { isLoggedIn } from '../../src/background/login'

type Cookie = { name: string; value: string }

describe('isLoggedIn', () => {
  it('returns true when isLoggedIn cookie is true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.cookies.getAll as any).mockImplementation((_details: unknown, cb: (c: Cookie[]) => void) =>
      cb([{ name: 'XSRF-TOKEN', value: 'abc' }, { name: 'isLoggedIn', value: 'true' }])
    )
    expect(await isLoggedIn()).toBe(true)
  })

  it('returns false when only anonymous cookies are present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.cookies.getAll as any).mockImplementation((_details: unknown, cb: (c: Cookie[]) => void) =>
      cb([{ name: 'XSRF-TOKEN', value: 'abc' }, { name: 'ARRAffinity', value: 'def' }])
    )
    expect(await isLoggedIn()).toBe(false)
  })

  it('returns false when only anonymous telemetry cookies are present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.cookies.getAll as any).mockImplementation((_details: unknown, cb: (c: Cookie[]) => void) =>
      cb([{ name: 'XSRF-TOKEN', value: 'abc' }, { name: 'ai_user', value: 'user' }, { name: 'ai_session', value: 'session' }])
    )
    expect(await isLoggedIn()).toBe(false)
  })

  it('returns false when session cookies are present without isLoggedIn', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.cookies.getAll as any).mockImplementation((_details: unknown, cb: (c: Cookie[]) => void) =>
      cb([{ name: 'XSRF-TOKEN', value: 'abc' }, { name: '.AspNetCore.Cookies', value: 'session' }])
    )
    expect(await isLoggedIn()).toBe(false)
  })

  it('returns false when no cookies are present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(chrome.cookies.getAll as any).mockImplementation((_details: unknown, cb: (c: Cookie[]) => void) =>
      cb([])
    )
    expect(await isLoggedIn()).toBe(false)
  })
})
