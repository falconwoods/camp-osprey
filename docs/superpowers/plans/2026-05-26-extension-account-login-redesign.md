# Extension Account Login Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move CampOsprey extension login into a dedicated Options Account tab, route signed-out Start through that tab, resume the pending trip after login, and remove name collection from extension auth.

**Architecture:** Keep popup and Trips focused on status plus navigation, and make Options Account the only full auth UI. Store pending trip intent in `chrome.storage.local` so popup closure does not lose the Start request. Update the server extension auth helper so email-only registration and login share one flow.

**Tech Stack:** Chrome extension MV3, TypeScript, Vite, Vitest, Next.js route handlers, better-auth email OTP, Drizzle user lookup.

---

## File Structure

- Modify `extension/src/types.ts`: make `ServerUser.name` optional and add a `PendingAuthState` type for the storage-backed pending trip intent.
- Modify `extension/src/storage.ts`: add helper functions for pending trip intent if storing it separately from `auth`.
- Modify `extension/src/startAuthGate.ts`: replace module-memory pending trip with storage-backed helpers and add Options Account tab routing.
- Create `extension/src/accountPanel.ts`: full Account tab renderer and binder for email/code auth, signed-in summary, sign-out, and pending trip continuation.
- Modify `extension/options/index.html`: add Account tab markup and account-specific CSS.
- Modify `extension/src/options/index.ts`: add Account tab routing, render lightweight Trips auth CTA, render Account tab, and resume pending trip after login.
- Modify `extension/src/popup/index.ts`: remove embedded login form, render compact account CTA, and route signed-out Start to Options Account.
- Modify `extension/src/auth.ts`: remove `name` from extension request/verify input types and payloads.
- Modify `server/lib/extension-auth.ts`: remove extension-facing name requirement and keep email-only account creation behavior.
- Modify `server/app/api/extension-auth/request-code/route.ts`: stop passing name into OTP email.
- Modify `server/app/api/extension-auth/verify-code/route.ts`: stop threading name/updateUserName through verify.
- Modify tests in `extension/tests/auth.test.ts`, `extension/tests/popup.test.ts`, `extension/tests/options-auth.test.ts`, and `server/__tests__/extension-auth.test.ts`.

## Tasks

### Task 1: Storage-Backed Pending Start Intent

**Files:**
- Modify: `extension/src/types.ts`
- Modify: `extension/src/storage.ts`
- Modify: `extension/src/startAuthGate.ts`
- Test: `extension/tests/startAuthGate.test.ts`

- [ ] **Step 1: Write failing tests for pending start persistence**

Replace or extend `extension/tests/startAuthGate.test.ts` with tests that prove `requireServerAuthForStart` stores the pending trip in Chrome storage and opens Options Account.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingStartTripId, consumePendingStartTripId, getPendingStartTripId, requireServerAuthForStart } from '../src/startAuthGate'

vi.mock('../src/auth', () => ({
  validateAuth: vi.fn(),
}))

import { validateAuth } from '../src/auth'

beforeEach(() => {
  let stored: Record<string, unknown> = {}
  chrome.storage.local.get.mockImplementation((_keys, cb) => cb(stored))
  chrome.storage.local.set.mockImplementation((data, cb) => {
    stored = { ...stored, ...data }
    cb?.()
  })
  chrome.storage.local.remove.mockImplementation((key, cb) => {
    const keys = Array.isArray(key) ? key : [key]
    for (const item of keys) delete stored[item]
    cb?.()
  })
  chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
  chrome.tabs.create = vi.fn()
})

describe('start auth gate', () => {
  it('stores pending trip and opens Options Account when auth is missing', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(false)

    await expect(getPendingStartTripId()).resolves.toBe('trip-1')
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options/index.html#account',
    })
  })

  it('does not store pending trip when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true)

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(true)

    await expect(getPendingStartTripId()).resolves.toBeNull()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('consumes and clears pending trip id', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await requireServerAuthForStart('trip-1')

    await expect(consumePendingStartTripId()).resolves.toBe('trip-1')
    await expect(getPendingStartTripId()).resolves.toBeNull()
  })

  it('clears pending trip id explicitly', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false)
    await requireServerAuthForStart('trip-1')

    await clearPendingStartTripId()

    await expect(getPendingStartTripId()).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd extension
npm test -- startAuthGate.test.ts
```

Expected: FAIL because `getPendingStartTripId` and `clearPendingStartTripId` do not exist, `consumePendingStartTripId` is not async, and pending state is currently module memory.

- [ ] **Step 3: Add optional user name type and pending storage helpers**

In `extension/src/types.ts`, change `ServerUser` and add `PendingAuthState`:

```ts
export interface ServerUser {
  id: string
  email: string
  name?: string
  role: string
}

export interface PendingAuthState {
  pendingStartTripId: string | null
}
```

In `extension/src/storage.ts`, add a constant and helpers below `clearAuthSession`:

```ts
const PENDING_START_KEY = 'campOspreyPendingStartTripId'

export async function getPendingStartTripId(): Promise<string | null> {
  const result = await promisify<Record<string, unknown>>(cb =>
    chrome.storage.local.get([PENDING_START_KEY], cb)
  )
  const value = result[PENDING_START_KEY]
  return typeof value === 'string' && value ? value : null
}

export async function setPendingStartTripId(tripId: string | null): Promise<void> {
  if (!tripId) {
    await clearPendingStartTripId()
    return
  }
  await promisify<void>(cb => chrome.storage.local.set({ [PENDING_START_KEY]: tripId }, cb))
}

export async function clearPendingStartTripId(): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.remove(PENDING_START_KEY, cb))
}
```

- [ ] **Step 4: Replace `startAuthGate.ts` with storage-backed behavior**

Use this implementation:

```ts
import { validateAuth } from './auth'
import {
  clearPendingStartTripId as clearStoredPendingStartTripId,
  getPendingStartTripId as getStoredPendingStartTripId,
  setPendingStartTripId,
} from './storage'

const listeners = new Set<() => void>()

export function onAuthGateChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  listeners.forEach(listener => listener())
}

export function openOptionsAccount(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#account') })
}

export async function openAuthGateForTrip(tripId: string | null): Promise<void> {
  await setPendingStartTripId(tripId)
  emit()
  openOptionsAccount()
}

export async function getPendingStartTripId(): Promise<string | null> {
  return getStoredPendingStartTripId()
}

export async function clearPendingStartTripId(): Promise<void> {
  await clearStoredPendingStartTripId()
  emit()
}

export async function consumePendingStartTripId(): Promise<string | null> {
  const tripId = await getStoredPendingStartTripId()
  await clearPendingStartTripId()
  return tripId
}

export async function requireServerAuthForStart(tripId: string): Promise<boolean> {
  const ok = await validateAuth()
  if (ok) return true
  await openAuthGateForTrip(tripId)
  return false
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
cd extension
npm test -- startAuthGate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/types.ts extension/src/storage.ts extension/src/startAuthGate.ts extension/tests/startAuthGate.test.ts
git commit -m "feat: persist pending extension auth start"
```

### Task 2: Email-Only Extension Auth API

**Files:**
- Modify: `extension/src/auth.ts`
- Modify: `extension/tests/auth.test.ts`
- Modify: `server/lib/extension-auth.ts`
- Modify: `server/app/api/extension-auth/request-code/route.ts`
- Modify: `server/app/api/extension-auth/verify-code/route.ts`
- Modify: `server/__tests__/extension-auth.test.ts`

- [ ] **Step 1: Write failing extension auth payload tests**

In `extension/tests/auth.test.ts`, update the verify test to call without `name` and assert request bodies do not contain `name`:

```ts
it('requests an email code without sending name', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNewUser: false }), { status: 200 })))

  await expect(requestCode({ email: 'user@example.com' })).resolves.toEqual({ ok: true, isNewUser: false })

  const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
  expect(body).toEqual({ email: 'user@example.com' })
})

it('stores auth after verifying code without sending name', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    token: 'tok',
    user: { id: 'u1', email: 'user@example.com', role: 'user' },
  }), { status: 200 })))

  await verifyCode({ email: 'user@example.com', code: '123456' })

  const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
  expect(body).toEqual({ email: 'user@example.com', code: '123456' })
  await expect(getAuth()).resolves.toEqual({
    token: 'tok',
    user: { id: 'u1', email: 'user@example.com', role: 'user' },
    lastEmail: 'user@example.com',
  })
})
```

- [ ] **Step 2: Write failing server email-only tests**

In `server/__tests__/extension-auth.test.ts`, replace name-specific request/verify expectations with:

```ts
it('sends code for a new email without requiring or forwarding name', async () => {
  const sent: Array<{ email: string; name?: string }> = []
  const deps = {
    findUserByEmail: async () => null,
    sendCode: async (email: string, name?: string) => { sent.push({ email, name }) },
  }

  await expect(requestExtensionAuthCode({ email: 'new@example.com', name: 'Ignored User' }, deps))
    .resolves.toEqual({ ok: true, isNewUser: true })
  expect(sent).toEqual([{ email: 'new@example.com', name: undefined }])
})

it('returns token/user for new verified email without forwarding name', async () => {
  let verifiedWith: { email: string; code: string; name?: string } | null = null
  let updated: { id: string; name: string } | null = null
  const deps = {
    findUserByEmail: async () => null,
    verifyCode: async (email: string, code: string, name?: string) => {
      verifiedWith = { email, code, name }
      return {
        token: 'tok',
        user: { id: 'u1', email: 'new@example.com', name: null, role: null, banned: false },
      }
    },
    updateUserName: async (id: string, name: string) => { updated = { id, name } },
  }

  await expect(verifyExtensionAuthCode({ email: 'new@example.com', code: '123456', name: 'Ignored User' }, deps))
    .resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'new@example.com', name: 'new@example.com', role: 'user' },
    })
  expect(verifiedWith).toEqual({ email: 'new@example.com', code: '123456', name: undefined })
  expect(updated).toBeNull()
})
```

Remove or update old tests that expect normalized names to be forwarded or `updateUserName` to be called.

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
cd extension
npm test -- auth.test.ts
cd ../server
npm test -- extension-auth.test.ts
```

Expected: FAIL because `VerifyCodeInput` still accepts `name`, server still forwards email/name for new users, and server tests still cover old name behavior until edited.

- [ ] **Step 4: Update extension auth input types**

In `extension/src/auth.ts`, remove `name` fields:

```ts
export interface RequestCodeInput {
  email: string
}

export interface VerifyCodeInput {
  email: string
  code: string
}
```

No other changes are needed in `requestCode` and `verifyCode`; they already serialize the input object.

- [ ] **Step 5: Update server auth helper for email-only account creation**

In `server/lib/extension-auth.ts`, keep `normalizeExtensionName` only if other tests still import it, but stop using it in request/verify flow:

```ts
export type RequestCodeDeps = {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  sendCode: (email: string) => Promise<void>;
};

export type VerifyCodeDeps = {
  findUserByEmail: (email: string) => Promise<(UserLookup & { role: string | null }) | null>;
  verifyCode: (email: string, code: string, name?: string) => Promise<VerifiedSession>;
  updateUserName?: (userId: string, name: string) => Promise<void>;
};
```

Replace `requestExtensionAuthCode` name handling with:

```ts
  try {
    await deps.sendCode(email);
  } catch (err) {
    console.error('[extension-auth] send code failed:', err);
    throw extensionAuthError('email_send_failed');
  }
```

Replace the new-user name section in `verifyExtensionAuthCode` with:

```ts
  let verified: VerifiedSession;
  try {
    verified = await deps.verifyCode(email, code);
  } catch (err) {
    throw extensionAuthErrorForVerifyCodeFailure(err);
  }

  if (verified.user.banned) throw extensionAuthError('account_blocked');

  const finalName = existingUser?.name ?? (verified.user.name?.trim() || email);
```

Do not call `deps.updateUserName`.

- [ ] **Step 6: Update server routes**

In `server/app/api/extension-auth/request-code/route.ts`, change `sendCode` to ignore name:

```ts
      sendCode: async (email) => {
        const otp = await auth.api.createVerificationOTP({
          body: { email, type: 'sign-in' },
          headers: request.headers,
        });
        const { subject, html } = buildOtpEmail(otp, email);
        await sendEmail({ to: email, subject, html });
      },
```

In `server/app/api/extension-auth/verify-code/route.ts`, change the dependency object:

```ts
      verifyCode: async (email, code) => {
        const result = await auth.api.signInEmailOTP({
          body: { email, otp: code, name: email },
          headers: request.headers,
        });
        const authUser = result.user as BetterAuthUser;
        return {
          token: result.token,
          user: {
            id: authUser.id,
            email: authUser.email,
            name: authUser.name,
            role: authUser.role ?? null,
            banned: authUser.banned ?? null,
          },
        };
      },
```

Remove the `updateUserName` dependency from that route.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd extension
npm test -- auth.test.ts
cd ../server
npm test -- extension-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add extension/src/auth.ts extension/tests/auth.test.ts server/lib/extension-auth.ts server/app/api/extension-auth/request-code/route.ts server/app/api/extension-auth/verify-code/route.ts server/__tests__/extension-auth.test.ts
git commit -m "feat: use email-only extension auth"
```

### Task 3: Account Tab Renderer

**Files:**
- Create: `extension/src/accountPanel.ts`
- Test: `extension/tests/accountPanel.test.ts`

- [ ] **Step 1: Write failing account panel tests**

Create `extension/tests/accountPanel.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindAccountPanel, renderAccountPanelHTML } from '../src/accountPanel'

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

  it('renders email-only signed-out form', () => {
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
      token: null,
      user: null,
      lastEmail: 'user@example.com',
    }, null)

    expect(document.body.textContent).toContain('Sign in to CampOsprey')
    expect(document.querySelector<HTMLInputElement>('#auth-email')!.value).toBe('user@example.com')
    expect(document.querySelector('#auth-name')).toBeNull()
  })

  it('uses pending trip copy on verify button', () => {
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
      token: null,
      user: null,
      lastEmail: null,
    }, 'trip-1')

    expect(document.body.textContent).toContain('Verify and start trip')
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
    document.getElementById('account-root')!.innerHTML = renderAccountPanelHTML({
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

    ;(document.getElementById('auth-code') as HTMLInputElement).value = '123456'
    document.getElementById('auth-verify-code')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(verifyCode).toHaveBeenCalledWith({ email: 'user@example.com', code: '123456' })
    expect(onSignedIn).toHaveBeenCalled()
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
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
cd extension
npm test -- accountPanel.test.ts
```

Expected: FAIL because `accountPanel.ts` does not exist.

- [ ] **Step 3: Create `accountPanel.ts`**

Create `extension/src/accountPanel.ts`:

```ts
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
```

- [ ] **Step 4: Run focused test**

Run:

```bash
cd extension
npm test -- accountPanel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/accountPanel.ts extension/tests/accountPanel.test.ts
git commit -m "feat: add options account panel"
```

### Task 4: Options Account Tab And Pending Trip Resume

**Files:**
- Modify: `extension/options/index.html`
- Modify: `extension/src/options/index.ts`
- Modify: `extension/tests/options-auth.test.ts`

- [ ] **Step 1: Update options tests for Account tab behavior**

In `extension/tests/options-auth.test.ts`, update the fixture to include Account tab:

```html
<div class="tab" data-tab="account"></div>
<div id="tab-account" class="hidden"><div id="account-root"></div></div>
```

Update mocks:

```ts
vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', role: 'user' } })),
  validateAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))
```

Add these tests:

```ts
it('shows lightweight sign-in banner without auth inputs while signed out', async () => {
  vi.mocked(validateAuth).mockResolvedValue(false)
  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(document.body.textContent).toContain('Sign in to start trips')
  expect(document.querySelector('#global-alerts #auth-email')).toBeNull()
  expect(document.querySelector('#global-alerts #auth-code')).toBeNull()
})

it('selects Account tab from hash and renders auth form', async () => {
  location.hash = '#account'
  vi.mocked(validateAuth).mockResolvedValue(false)
  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(document.querySelector('[data-tab="account"]')!.classList.contains('active')).toBe(true)
  expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
  expect(document.querySelector('#account-root #auth-email')).not.toBeNull()
})

it('stores pending trip and opens account when Start is clicked signed out', async () => {
  vi.mocked(validateAuth).mockResolvedValue(false)
  await import('../src/options/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click()
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'SCAN_NOW', tripId: 'trip-1' })
  expect(document.getElementById('tab-account')!.classList.contains('hidden')).toBe(false)
})
```

- [ ] **Step 2: Run options test and verify failure**

Run:

```bash
cd extension
npm test -- options-auth.test.ts
```

Expected: FAIL because Account tab is missing and Trips still embeds the full auth panel.

- [ ] **Step 3: Add Account tab HTML and styles**

In `extension/options/index.html`, add an Account tab button after Settings:

```html
<div class="tab" data-tab="account">Account</div>
```

Add Account panel CSS near other section styles:

```css
.account-summary { background: var(--bg-card); border-radius: 8px; padding: 16px; }
.account-email { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.account-auth { background: var(--bg-card); border-radius: 8px; padding: 16px; max-width: 420px; }
```

Add this tab panel after `tab-settings`:

```html
<div id="tab-account" class="hidden">
  <div id="account-root"></div>
</div>
```

- [ ] **Step 4: Update imports in Options TS**

In `extension/src/options/index.ts`, replace the auth panel import.

Remove:

```ts
import { authPanelHTML, bindAuthPanel } from '../authPanel'
```

Use one merged storage import:

```ts
import { getAuth, getPendingStartTripId, getStorage, saveTrips, savePayment, saveSettings, updateTrip, clearDebugLog } from '../storage'
import { renderAccountPanelHTML, bindAccountPanel } from '../accountPanel'
import { consumePendingStartTripId } from '../startAuthGate'
```

- [ ] **Step 5: Replace tab switching with reusable `selectTab`**

Replace the current tab listener block with:

```ts
type OptionsTab = 'trips' | 'payment' | 'settings' | 'account'

function selectTab(name: OptionsTab): void {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === name)
  })
  document.getElementById('tab-trips')!.classList.toggle('hidden', name !== 'trips')
  document.getElementById('tab-payment')!.classList.toggle('hidden', name !== 'payment')
  document.getElementById('tab-settings')!.classList.toggle('hidden', name !== 'settings')
  document.getElementById('tab-account')!.classList.toggle('hidden', name !== 'account')
  if (name === 'account') renderAccount()
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = (tab as HTMLElement).dataset['tab'] as OptionsTab
    location.hash = name
    selectTab(name)
  })
})
```

- [ ] **Step 6: Add lightweight Trips auth CTA and Account renderer**

Add these functions before `renderTripList`:

```ts
function accountCtaHTML(authEmail: string | null): string {
  if (authEmail) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span>Signed in as ${authEmail}</span>
      <button class="trip-action-btn" id="open-account-btn">Account</button>
    </div>`
  }
  return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
    <span><strong>Sign in to start trips</strong><br>Get booking emails and keep trips connected to your account.</span>
    <button class="trip-action-btn" id="open-account-btn">Sign in</button>
  </div>`
}

async function bindAccountCta(): Promise<void> {
  document.getElementById('open-account-btn')?.addEventListener('click', () => {
    location.hash = 'account'
    selectTab('account')
  })
}

async function renderAccount(): Promise<void> {
  const root = document.getElementById('account-root')
  if (!root) return
  const auth = await getAuth()
  const pendingTripId = await getPendingStartTripId()
  root.innerHTML = renderAccountPanelHTML(auth, pendingTripId)
  bindAccountPanel(async () => {
    const tripId = await consumePendingStartTripId()
    if (tripId) await startTripNow(tripId)
    await renderAccount()
    await renderTripList()
  }, renderAccount)
}
```

- [ ] **Step 7: Replace embedded auth panel in Trips render**

Inside `renderTripList`, replace the `authPanelHTML` block with:

```ts
  if (globalAlertsEl) {
    const authEmail = auth.user?.email ?? null
    globalAlertsEl.innerHTML = accountCtaHTML(authEmail) + renderWarnings(getGlobalWarnings(trips, loggedIn))
    await bindAccountCta()
  }
```

- [ ] **Step 8: Select Account when auth gate blocks Start**

In both Start handlers in `extension/src/options/index.ts`, after `requireServerAuthForStart(id)` returns false, call:

```ts
selectTab('account')
await renderAccount()
```

For Save/New Trip path, after `requireServerAuthForStart(savedTripId)` returns false, call:

```ts
document.getElementById('back-btn')!.click()
selectTab('account')
await renderAccount()
return
```

- [ ] **Step 9: Initialize hash route**

At the bottom before or after initial renders, add:

```ts
const initialTab = location.hash.replace('#', '') as OptionsTab
selectTab(['trips', 'payment', 'settings', 'account'].includes(initialTab) ? initialTab : 'trips')
```

Keep `renderTripList()`, `loadPaymentForm()`, `loadSettingsForm()`, and `refreshDebugLog()` calls.

- [ ] **Step 10: Run focused options tests**

Run:

```bash
cd extension
npm test -- options-auth.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add extension/options/index.html extension/src/options/index.ts extension/tests/options-auth.test.ts
git commit -m "feat: add account tab auth flow"
```

### Task 5: Popup Lightweight Account CTA

**Files:**
- Modify: `extension/src/popup/index.ts`
- Modify: `extension/tests/popup.test.ts`

- [ ] **Step 1: Update popup tests for no embedded form and Account routing**

In `extension/tests/popup.test.ts`, add these mocks in `beforeEach`:

```ts
chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
chrome.tabs.create = vi.fn()
```

Add tests:

```ts
it('shows signed-out CTA without auth inputs', async () => {
  vi.mocked(validateAuth).mockResolvedValue(false)
  await import('../src/popup/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(document.body.textContent).toContain('Sign in to start trips')
  expect(document.querySelector('#auth-email')).toBeNull()
  expect(document.querySelector('#auth-code')).toBeNull()
})

it('opens options account when signed-out CTA is clicked', async () => {
  vi.mocked(validateAuth).mockResolvedValue(false)
  await import('../src/popup/index')
  await new Promise(resolve => setTimeout(resolve, 0))

  document.getElementById('open-account-btn')!.click()

  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test/options/index.html#account',
  })
})
```

Update the signed-out Start test to also assert:

```ts
expect(chrome.tabs.create).toHaveBeenCalledWith({
  url: 'chrome-extension://test/options/index.html#account',
})
```

- [ ] **Step 2: Run popup test and verify failure**

Run:

```bash
cd extension
npm test -- popup.test.ts
```

Expected: FAIL because popup still renders the full `authPanelHTML`.

- [ ] **Step 3: Remove full auth panel imports and add CTA helper**

In `extension/src/popup/index.ts`, remove:

```ts
import { authPanelHTML, bindAuthPanel } from '../authPanel'
```

Add `openOptionsAccount` to the start gate import:

```ts
import { openOptionsAccount, requireServerAuthForStart } from '../startAuthGate'
```

Add helper:

```ts
function accountCtaHTML(authEmail: string | null): string {
  if (authEmail) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span>Signed in as ${authEmail}</span>
      <button class="btn btn-start" id="open-account-btn">Account</button>
    </div>`
  }
  return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
    <span><strong>Sign in to start trips</strong><br>Get booking emails for your trips.</span>
    <button class="btn btn-start" id="open-account-btn">Sign in</button>
  </div>`
}
```

- [ ] **Step 4: Replace popup auth render**

Inside `render`, replace the `authPanelHTML` and `bindAuthPanel` block with:

```ts
  globalAlertsEl.innerHTML = accountCtaHTML(auth.user?.email ?? null) + renderWarnings(getGlobalWarnings(trips, loggedIn))
  document.getElementById('open-account-btn')?.addEventListener('click', openOptionsAccount)
```

Remove the old pending-trip callback that directly started a trip after embedded popup login.

- [ ] **Step 5: Ensure signed-out Start routes through Account**

The existing Start handler already calls `requireServerAuthForStart(id)`. With Task 1, that stores pending trip and opens Options Account. No extra popup code is needed besides the updated test.

- [ ] **Step 6: Run focused popup tests**

Run:

```bash
cd extension
npm test -- popup.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/popup/index.ts extension/tests/popup.test.ts
git commit -m "feat: route popup auth to account tab"
```

### Task 6: Remove Dead Embedded Auth Panel Usage

**Files:**
- Modify or Delete: `extension/src/authPanel.ts`
- Update imports wherever needed

- [ ] **Step 1: Search for remaining embedded auth panel usage**

Run:

```bash
rg "authPanelHTML|bindAuthPanel|authPanel" extension/src extension/tests
```

Expected before cleanup: references only in `extension/src/authPanel.ts` or failing imports if earlier tasks missed a file.

- [ ] **Step 2: Delete `authPanel.ts` if unused**

If `rg` shows no imports, delete the file:

```bash
rm extension/src/authPanel.ts
```

If a legitimate import remains, replace it with `accountPanel.ts` or the lightweight CTA from the owning surface before deleting.

- [ ] **Step 3: Run extension tests**

Run:

```bash
cd extension
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A extension/src/authPanel.ts extension/src extension/tests
git commit -m "refactor: remove embedded auth panel"
```

### Task 7: Full Verification

**Files:**
- All changed files from prior tasks

- [ ] **Step 1: Run extension unit tests**

Run:

```bash
cd extension
npm test
```

Expected: PASS.

- [ ] **Step 2: Build extension**

Run:

```bash
cd extension
npm run build
```

Expected: PASS and `extension/dist` is generated.

- [ ] **Step 3: Run server unit tests**

Run:

```bash
cd server
npm test
```

Expected: PASS.

- [ ] **Step 4: Build server**

Run:

```bash
cd server
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test in unpacked extension**

Load `extension/dist` as an unpacked extension in Chrome. Verify:

- Popup signed out shows a compact Sign in CTA and no email/code fields.
- Clicking popup Sign in opens Options Account.
- Clicking Start while signed out opens Options Account and does not start scanning.
- Account email step sends a code.
- Account code step signs in and starts the pending trip.
- Options Trips signed out shows lightweight CTA and no email/code fields.
- Signed-in Account tab shows email and Sign out.

- [ ] **Step 6: Final commit if verification changes were needed**

If verification required fixes, commit them:

```bash
git add -A
git commit -m "fix: complete account login verification"
```

If no files changed after verification, do not create an empty commit.
