import { requestCode, signOut, verifyCode } from './auth'
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
    account_blocked: 'This account cannot use CampOsprey. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach CampOsprey right now. Try again in a moment.'
}

export function renderAccountPanelHTML(auth: AuthState, pendingTripId: string | null): string {
  if (auth.user) {
    const role = auth.user.role && auth.user.role !== 'user'
      ? `<div class="hint">Role: ${escapeHtml(auth.user.role)}</div>`
      : ''
    return `<div class="section account-summary">
      <div class="section-label">Account</div>
      <div class="account-email">${escapeHtml(auth.user.email)}</div>
      ${role}
      <button class="btn-secondary" id="sign-out-btn" style="margin-top:12px">Sign out</button>
    </div>`
  }

  const verifyLabel = pendingTripId ? 'Verify and start trip' : 'Verify'
  return `<div class="section account-auth" id="server-auth-panel">
    <div class="section-label">Account</div>
    <h2 style="font-size:16px;margin-bottom:4px">Sign in to CampOsprey</h2>
    <p class="hint" style="margin-bottom:12px">Use your email to start trips and receive booking updates.</p>
    <input id="auth-email" class="input" placeholder="Email" value="${escapeHtml(auth.lastEmail ?? '')}">
    <button class="btn-primary" id="auth-send-code" style="margin-top:8px">Send code</button>
    <div id="auth-code-row" style="display:none;margin-top:14px">
      <p class="hint" id="auth-code-copy" style="margin-bottom:8px"></p>
      <input id="auth-code" class="input" placeholder="6-digit code" inputmode="numeric">
      <div style="margin-top:6px;color:var(--text-muted);line-height:1.5;font-size:11px">
        Cannot find the code? Check Spam, Junk, or Trash, and search your email for "CampOsprey".
      </div>
      <button class="btn-primary" id="auth-verify-code" style="margin-top:8px">${verifyLabel}</button>
    </div>
    <div id="auth-error" style="margin-top:8px;color:var(--red);font-size:11px"></div>
  </div>`
}

export function bindAccountPanel(
  onSignedIn: () => Promise<void>,
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
      const copy = document.getElementById('auth-code-copy')
      if (copy) copy.textContent = `We sent a 6-digit code to ${email}. No password needed.`
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
      await onSignedIn()
    } catch (err) {
      setError(authMessage(err instanceof Error ? err.message : 'server_error'))
    }
  })
}
