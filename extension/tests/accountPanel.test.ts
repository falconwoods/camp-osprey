import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindAccountPanel, renderAccountPanelHTML, renderAuthPanelHTML } from '../src/accountPanel'

vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', role: 'user' } })),
  signOut: vi.fn(async () => undefined),
}))

import { requestCode, signOut, verifyCode } from '../src/auth'

describe('account panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="account-root"></div>'
  })

  it('renders signed-out account CTA without auth fields', () => {
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
      token: null,
      user: null,
      lastEmail: 'user@example.com',
    }, null)

    expect(document.body.textContent).toContain('Not signed in')
    expect(document.querySelector('#account-open-auth-btn')).not.toBeNull()
    expect(document.querySelector('#auth-email')).toBeNull()
    expect(document.querySelector('#auth-name')).toBeNull()
  })

  it('uses pending trip copy on verify button', () => {
    document.getElementById('account-root')!.innerHTML = renderAuthPanelHTML({
      token: null,
      user: null,
      lastEmail: null,
    }, 'trip-1')

    expect(document.body.textContent).toContain('Verify and start trip')
  })

  it('uses sign-in and signup copy without account badge', () => {
    document.getElementById('account-root')!.innerHTML = renderAuthPanelHTML({
      token: null,
      user: null,
      lastEmail: null,
    }, null)

    expect(document.body.textContent).toContain('Sign in or create account')
    expect(document.body.textContent).toContain('Send email code')
    expect(document.body.textContent).toContain('Passwordless sign-in')
    expect(document.querySelector('.auth-pill')).toBeNull()
    expect(document.querySelector('.auth-card-brand')!.textContent).toContain('campsoon')
  })

  it('renders signed-in email and sign-out', () => {
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: 'user@example.com',
    }, null)

    expect(document.body.textContent).toContain('user@example.com')
    expect(document.querySelector('#sign-out-btn')).not.toBeNull()
  })

  it('requests and verifies code without name', async () => {
    document.getElementById('account-root')!.innerHTML = renderAuthPanelHTML({
      token: null,
      user: null,
      lastEmail: null,
    }, 'trip-1')

    const onSignedIn = vi.fn(async () => undefined)
    const onChanged = vi.fn(async () => undefined)
    bindAccountPanel(onSignedIn, onChanged)

    ;(document.getElementById('auth-email') as HTMLInputElement).value = 'user@example.com'
    document.getElementById('auth-send-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requestCode).toHaveBeenCalledWith({ email: 'user@example.com' })
    expect((document.getElementById('auth-email-step') as HTMLDivElement).style.display).toBe('none')

    ;(document.getElementById('auth-code') as HTMLInputElement).value = '123456'
    document.getElementById('auth-verify-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(verifyCode).toHaveBeenCalledWith({ email: 'user@example.com', code: '123456' })
    expect(onSignedIn).toHaveBeenCalled()
  })

  it('shows resend with cooldown after code request', async () => {
    document.getElementById('account-root')!.innerHTML = renderAuthPanelHTML({
      token: null,
      user: null,
      lastEmail: null,
    }, null)

    bindAccountPanel(vi.fn(), vi.fn())

    ;(document.getElementById('auth-email') as HTMLInputElement).value = 'user@example.com'
    document.getElementById('auth-send-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const resendButton = document.getElementById('auth-resend-code') as HTMLButtonElement
    expect(resendButton.disabled).toBe(true)
    expect(resendButton.textContent).toBe('Resend code in 30s')
  })

  it('signs out and refreshes account state', async () => {
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', role: 'user' },
      lastEmail: 'user@example.com',
    }, null)

    const onChanged = vi.fn(async () => undefined)
    bindAccountPanel(vi.fn(), onChanged)
    document.getElementById('sign-out-btn')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(signOut).toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
  })
})
