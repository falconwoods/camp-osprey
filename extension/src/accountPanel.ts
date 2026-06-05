import { requestCode, signOut, verifyCode } from './auth'
import { withButtonLoading } from './shared/components/button'
import type { AuthState } from './types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function authMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid email address.',
    invalid_code: 'That code did not work. Check the code and try again.',
    expired_code: 'That code expired. Send a new code.',
    rate_limited: 'Too many attempts. Wait a bit, then try again.',
    account_blocked: 'This account cannot use campsoon. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach campsoon right now. Try again in a moment.'
}

export function renderAccountPanelHTML(auth: AuthState, pendingTripId: string | null): string {
  if (auth.user) {
    const role = auth.user.role && auth.user.role !== 'user'
      ? `<div class="hint">Role: ${escapeHtml(auth.user.role)}</div>`
      : ''
    return `<div class="section account-summary account-management">
      <div class="account-management-row">
        <div>
          <div class="account-management-label">Signed in as</div>
          <div class="account-email">${escapeHtml(auth.user.email)}</div>
          ${role}
        </div>
        <button class="btn-secondary" id="sign-out-btn" type="button">Sign out</button>
      </div>
    </div>`
  }

  const pendingCopy = pendingTripId
    ? '<p class="account-management-copy">Sign in to continue starting this trip.</p>'
    : '<p class="account-management-copy">Sign in to start trips and receive booking updates.</p>'
  return `<div class="section account-summary account-management account-management-empty">
    <div class="account-management-row">
      <div>
        <div class="account-management-label">Not signed in</div>
        ${pendingCopy}
      </div>
      <button class="btn-primary" id="account-open-auth-btn" type="button">Sign in</button>
    </div>
  </div>`
}

export function renderAuthPanelHTML(auth: AuthState, pendingTripId: string | null): string {
  const verifyLabel = pendingTripId ? 'Verify and start trip' : 'Verify code'
  const sendIcon = '<svg class="auth-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>'
  const shieldNoteIcon = '<svg class="auth-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/></svg>'
  const clockIcon = '<svg class="auth-inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  return `<div class="section account-auth" id="server-auth-panel">
    <div class="auth-card-brand" aria-label="campsoon">
      <img src="../icons/icon48.png" alt="">
      <span>campsoon</span>
    </div>
    <div id="auth-email-step" class="auth-state">
      <h2 class="auth-title">Sign in or create account</h2>
      <p class="auth-copy">Use your email to start trips and receive booking updates.</p>
      <div class="auth-divider"></div>
      <label class="auth-field-label" for="auth-email">Email address</label>
      <input id="auth-email" class="input auth-input" placeholder="Email address" value="${escapeHtml(auth.lastEmail ?? '')}">
      <button class="btn-primary auth-primary-btn" id="auth-send-code">Send email code ${sendIcon}</button>
      <div class="auth-note">${shieldNoteIcon}<span>Passwordless sign-in</span></div>
    </div>
    <div id="auth-code-row" class="auth-state" style="display:none">
      <h2 class="auth-title">Check your email</h2>
      <p class="auth-copy" id="auth-code-copy"></p>
      <div class="auth-divider"></div>
      <label class="auth-field-label" for="auth-code">Verification code</label>
      <input id="auth-code" class="input auth-input" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code">
      <button class="btn-primary auth-primary-btn" id="auth-verify-code">${verifyLabel}</button>
      <div class="auth-find-note">Can't find it? Check Spam, Junk, or Trash.</div>
      <div class="account-auth-actions">
        <button class="account-auth-link auth-resend-link" id="auth-resend-code" type="button">${clockIcon}<span>Resend code</span></button>
        <span class="auth-actions-divider" aria-hidden="true"></span>
        <button class="account-auth-link" id="auth-change-email" type="button">Use a different email</button>
      </div>
    </div>
    <div id="auth-error" class="account-auth-error"></div>
  </div>`
}

const resendCooldownSeconds = 30

export function bindAccountPanel(
  onSignedIn: () => Promise<void>,
  onChanged: () => Promise<void>,
): void {
  document.getElementById('sign-out-btn')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement
    await withButtonLoading(button, 'Signing out...', async () => {
      await signOut()
      await onChanged()
    })
  })

  const setError = (message: string) => {
    const el = document.getElementById('auth-error')
    if (el) el.textContent = message
  }

  let submittedEmail = ''
  let resendTimer: ReturnType<typeof setInterval> | null = null

  const startResendCooldown = () => {
    const resendButton = document.getElementById('auth-resend-code') as HTMLButtonElement | null
    if (!resendButton) return
    if (resendTimer) clearInterval(resendTimer)

    let remaining = resendCooldownSeconds
    resendButton.disabled = true
    const resendLabel = resendButton.querySelector('span') ?? resendButton
    resendLabel.textContent = `Resend code in ${remaining}s`

    resendTimer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        if (resendTimer) clearInterval(resendTimer)
        resendTimer = null
        resendButton.disabled = false
        resendLabel.textContent = 'Resend code'
        return
      }
      resendLabel.textContent = `Resend code in ${remaining}s`
    }, 1000)
  }

  const showCodeStep = (email: string) => {
    submittedEmail = email
    const emailStep = document.getElementById('auth-email-step')
    if (emailStep) emailStep.style.display = 'none'
    document.getElementById('auth-code-row')!.style.display = 'block'
    const copy = document.getElementById('auth-code-copy')
    if (copy) copy.innerHTML = `We sent a 6-digit code to <strong>${escapeHtml(email)}</strong>.`
    ;(document.getElementById('auth-code') as HTMLInputElement | null)?.focus()
  }

  const sendCode = async (email: string): Promise<boolean> => {
    try {
      await requestCode({ email })
      showCodeStep(email)
      setError('')
      return true
    } catch (err) {
      const code = err instanceof Error ? err.message : 'server_error'
      setError(authMessage(code))
      return false
    }
  }

  document.getElementById('auth-send-code')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    const sent = await withButtonLoading(button, 'Sending code...', () => sendCode(email))
    if (sent) startResendCooldown()
  })

  document.getElementById('auth-resend-code')?.addEventListener('click', async event => {
    if (!submittedEmail) return
    const button = event.currentTarget as HTMLButtonElement
    const sent = await withButtonLoading(button, 'Resending...', () => sendCode(submittedEmail))
    if (sent) startResendCooldown()
  })

  document.getElementById('auth-change-email')?.addEventListener('click', () => {
    submittedEmail = ''
    if (resendTimer) clearInterval(resendTimer)
    resendTimer = null
    const emailStep = document.getElementById('auth-email-step')
    const codeStep = document.getElementById('auth-code-row')
    if (emailStep) emailStep.style.display = 'block'
    if (codeStep) codeStep.style.display = 'none'
    setError('')
    ;(document.getElementById('auth-email') as HTMLInputElement | null)?.focus()
  })

  document.getElementById('auth-verify-code')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement
    const email = submittedEmail || (document.getElementById('auth-email') as HTMLInputElement).value
    const code = (document.getElementById('auth-code') as HTMLInputElement).value
    await withButtonLoading(button, 'Verifying...', async () => {
      try {
        await verifyCode({ email, code })
        await onSignedIn()
      } catch (err) {
        setError(authMessage(err instanceof Error ? err.message : 'server_error'))
      }
    })
  })
}
