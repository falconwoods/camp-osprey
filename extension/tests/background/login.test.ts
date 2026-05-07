import { describe, it, expect } from 'vitest'
import { isLoggedIn } from '../../src/background/login'

describe('isLoggedIn', () => {
  it('returns true when isLoggedIn cookie is present with value "true"', async () => {
    chrome.cookies.get.mockImplementation((_details: unknown, cb: (c: { value: string } | null) => void) =>
      cb({ value: 'true' })
    )
    expect(await isLoggedIn()).toBe(true)
  })

  it('returns false when cookie is absent', async () => {
    chrome.cookies.get.mockImplementation((_details: unknown, cb: (c: null) => void) => cb(null))
    expect(await isLoggedIn()).toBe(false)
  })

  it('returns false when cookie value is not "true"', async () => {
    chrome.cookies.get.mockImplementation((_details: unknown, cb: (c: { value: string } | null) => void) =>
      cb({ value: 'false' })
    )
    expect(await isLoggedIn()).toBe(false)
  })
})
