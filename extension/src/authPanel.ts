import { requestCode, signOut, verifyCode } from './auth'
import { consumePendingStartTripId } from './startAuthGate'
import type { AuthState } from './types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function authPanelHTML(auth: AuthState, inputClass = 'auth-input', buttonClass = 'btn btn-start'): string {
  if (auth.user) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center">
      <span>Signed in as ${escapeHtml(auth.user.name)}</span>
      <button class="${buttonClass}" id="sign-out-btn">Sign out</button>
    </div>`
  }

  return `<div class="alert-warn" id="server-auth-panel">
    <strong>Sign in to start trips</strong><br>
    Get booking emails and keep your trips connected to your account.
    <div style="margin-top:8px">
      <input id="auth-email" class="${inputClass}" placeholder="Email" value="${escapeHtml(auth.lastEmail ?? '')}">
      <button class="${buttonClass}" id="auth-send-code">Sign in with email</button>
    </div>
    <div id="auth-code-row" style="display:none;margin-top:8px">
      <input id="auth-code" class="${inputClass}" placeholder="6-digit code">
      <div style="margin-top:6px;color:var(--text-muted);line-height:1.5">
        Cannot find the code? Check Spam, Junk, or Trash, and search your email for "CampOsprey".
      </div>
      <button class="${buttonClass}" id="auth-verify-code">Verify</button>
    </div>
    <div id="auth-error" style="margin-top:6px;color:var(--red)"></div>
  </div>`
}

export function authMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid email address.',
    invalid_code: 'That code did not work. Check the code and try again.',
    expired_code: 'That code expired. Send a new code.',
    rate_limited: 'Too many attempts. Wait a bit, then try again.',
    account_blocked: 'This account cannot use CampOsprey. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach CampOsprey right now. Try again in a moment.'
}

export function bindAuthPanel(
  onSignedIn: (pendingTripId: string | null) => Promise<void>,
  onChanged: () => Promise<void>,
): void {
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    await signOut()
    await onChanged()
  })

  const setError = (message: string) => {
    const el = document.getElementById('auth-error')
    if (el) el.textContent = message
  }

  document.getElementById('auth-send-code')?.addEventListener('click', async () => {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    try {
      await requestCode({ email })
      document.getElementById('auth-code-row')!.style.display = 'block'
      setError('')
    } catch (err) {
      const code = err instanceof Error ? err.message : 'server_error'
      setError(authMessage(code))
    }
  })

  document.getElementById('auth-verify-code')?.addEventListener('click', async () => {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    const code = (document.getElementById('auth-code') as HTMLInputElement).value
    try {
      await verifyCode({ email, code })
      await onSignedIn(consumePendingStartTripId())
    } catch (err) {
      setError(authMessage(err instanceof Error ? err.message : 'server_error'))
    }
  })
}
