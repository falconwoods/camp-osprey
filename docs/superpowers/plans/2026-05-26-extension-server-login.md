# Extension Server Login Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require CampOsprey server login before starting any extension trip, using a passwordless email-code flow with remembered email and extension-facing auth APIs.

**Architecture:** Add stable `/api/extension-auth/*` wrapper routes around better-auth email OTP and bearer sessions. Add typed auth storage/client helpers in the extension, then gate every Start path through a shared `requireServerAuthForStart()` helper before sending `SCAN_NOW`. UI uses a persistent signed-out banner and an inline email/code panel in popup and options.

**Tech Stack:** Next.js 15 App Router, better-auth email OTP + bearer plugins, Drizzle/Postgres, Resend, Chrome Extension MV3, TypeScript, Vitest.

---

## Reference Design

Approved spec: `docs/superpowers/specs/2026-05-26-extension-server-login-design.md`

Official auth references checked during planning:

- better-auth email OTP plugin: `https://better-auth.com/docs/plugins/email-otp`
- better-auth bearer plugin/session validation: `https://better-auth.com/docs/plugins/bearer`

## File Map

### Server

- Create: `server/lib/extension-auth.ts`
  - Normalizes email/name/code.
  - Looks up users.
  - Calls better-auth OTP APIs.
  - Maps auth errors to extension-friendly error codes.
- Create: `server/app/api/extension-auth/request-code/route.ts`
  - Public extension endpoint for sending OTP codes.
- Create: `server/app/api/extension-auth/verify-code/route.ts`
  - Public extension endpoint for verifying OTP and returning `{ token, user }`.
- Modify: `server/lib/email.ts`
  - Add reusable OTP and result email greeting support.
- Modify: `server/lib/auth.ts`
  - Use pending signup name context for OTP greeting when available.
- Test: `server/__tests__/extension-auth.test.ts`
  - Unit tests for validation and response mapping.
- Test: `server/__tests__/email.test.ts`
  - Add greeting assertions.

### Extension

- Modify: `extension/src/types.ts`
  - Add `AuthState`, `ServerUser`, and `auth` to `StorageData`.
- Modify: `extension/src/storage.ts`
  - Add auth defaults and helpers: `saveAuth`, `clearAuthSession`, `getAuth`.
- Create: `extension/src/serverApi.ts`
  - Shared fetch wrapper for server APIs with bearer token.
- Create: `extension/src/auth.ts`
  - Extension auth functions: `requestCode`, `verifyCode`, `validateAuth`, `signOut`.
- Create: `extension/src/startAuthGate.ts`
  - `requireServerAuthForStart(tripId)` and pending-start state.
- Modify: `extension/src/popup/index.ts`
  - Render account banner/login panel.
  - Gate Start through server auth.
- Modify: `extension/src/options/index.ts`
  - Render account banner/login panel.
  - Gate Save-and-start and list Start through server auth.
- Modify: `extension/src/background/index.ts`
  - Defense-in-depth server-auth check before scanning trips.
- Test: `extension/tests/storage.test.ts`
- Test: `extension/tests/auth.test.ts`
- Test: `extension/tests/startAuthGate.test.ts`
- Test: `extension/tests/popup.test.ts` or existing popup coverage if present.
- Test: `extension/tests/options-auth.test.ts`
- Test: `extension/tests/background/index.test.ts`

---

## Task 1: Server Auth Wrapper Validation

**Files:**
- Create: `server/lib/extension-auth.ts`
- Test: `server/__tests__/extension-auth.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `server/__tests__/extension-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeExtensionEmail,
  normalizeExtensionName,
  normalizeExtensionCode,
  extensionAuthError,
} from '../lib/extension-auth';

describe('extension auth validation', () => {
  it('normalizes email by trimming and lowercasing', () => {
    expect(normalizeExtensionEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => normalizeExtensionEmail('not an email')).toThrow(extensionAuthError('invalid_email').message);
  });

  it('normalizes name by trimming repeated whitespace', () => {
    expect(normalizeExtensionName('  Eric   Smith  ')).toBe('Eric Smith');
  });

  it('rejects blank name', () => {
    expect(() => normalizeExtensionName('   ')).toThrow(extensionAuthError('name_required').message);
  });

  it('normalizes six digit code', () => {
    expect(normalizeExtensionCode(' 123456 ')).toBe('123456');
  });

  it('rejects malformed code', () => {
    expect(() => normalizeExtensionCode('12-456')).toThrow(extensionAuthError('invalid_code').message);
  });
});
```

- [ ] **Step 2: Run the failing server test**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: FAIL because `server/lib/extension-auth.ts` does not exist.

- [ ] **Step 3: Implement validation helpers**

Create `server/lib/extension-auth.ts`:

```ts
export type ExtensionAuthErrorCode =
  | 'invalid_email'
  | 'invalid_code'
  | 'expired_code'
  | 'name_required'
  | 'account_blocked'
  | 'rate_limited'
  | 'email_send_failed'
  | 'server_error';

export class ExtensionAuthError extends Error {
  constructor(
    public code: ExtensionAuthErrorCode,
    public status: number,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<ExtensionAuthErrorCode, number> = {
  invalid_email: 400,
  invalid_code: 400,
  expired_code: 400,
  name_required: 400,
  account_blocked: 403,
  rate_limited: 429,
  email_send_failed: 500,
  server_error: 500,
};

export function extensionAuthError(
  code: ExtensionAuthErrorCode,
  details: Record<string, unknown> = {},
): ExtensionAuthError {
  return new ExtensionAuthError(code, STATUS_BY_CODE[code], code, details);
}

export function normalizeExtensionEmail(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('invalid_email');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw extensionAuthError('invalid_email');
  return email;
}

export function normalizeExtensionName(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('name_required');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw extensionAuthError('name_required');
  return name;
}

export function normalizeExtensionCode(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('invalid_code');
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) throw extensionAuthError('invalid_code');
  return code;
}

export function jsonForExtensionAuthError(err: unknown): Response {
  if (err instanceof ExtensionAuthError) {
    return Response.json(
      { error: err.code, ...err.details },
      { status: err.status },
    );
  }
  console.error('[extension-auth] unexpected error:', err);
  return Response.json({ error: 'server_error' }, { status: 500 });
}
```

- [ ] **Step 4: Run the server validation test**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: PASS for all validation tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/extension-auth.ts server/__tests__/extension-auth.test.ts
git commit -m "test(server): add extension auth validation helpers"
```

---

## Task 2: Server Request-Code Endpoint

**Files:**
- Modify: `server/lib/extension-auth.ts`
- Create: `server/app/api/extension-auth/request-code/route.ts`
- Test: `server/__tests__/extension-auth.test.ts`

- [ ] **Step 1: Add failing tests for request-code behavior**

Append to `server/__tests__/extension-auth.test.ts`:

```ts
import { requestExtensionAuthCode } from '../lib/extension-auth';

describe('requestExtensionAuthCode', () => {
  it('returns name_required for a new email without sending a code', async () => {
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async () => { throw new Error('should not send'); },
    };

    await expect(requestExtensionAuthCode({ email: 'new@example.com' }, deps))
      .rejects.toMatchObject({
        code: 'name_required',
        status: 400,
        details: { isNewUser: true },
      });
  });

  it('sends code for a new email when name is present', async () => {
    const sent: Array<{ email: string; name?: string }> = [];
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async (email: string, name?: string) => { sent.push({ email, name }); },
    };

    await expect(requestExtensionAuthCode({ email: 'NEW@Example.com', name: ' Eric ' }, deps))
      .resolves.toEqual({ ok: true, isNewUser: true });
    expect(sent).toEqual([{ email: 'new@example.com', name: 'Eric' }]);
  });

  it('sends code for an existing email without requiring name', async () => {
    const sent: string[] = [];
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', banned: false }),
      sendCode: async (email: string) => { sent.push(email); },
    };

    await expect(requestExtensionAuthCode({ email: 'old@example.com' }, deps))
      .resolves.toEqual({ ok: true, isNewUser: false });
    expect(sent).toEqual(['old@example.com']);
  });

  it('blocks banned existing users', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'blocked@example.com', name: 'Blocked User', banned: true }),
      sendCode: async () => { throw new Error('should not send'); },
    };

    await expect(requestExtensionAuthCode({ email: 'blocked@example.com' }, deps))
      .rejects.toMatchObject({ code: 'account_blocked', status: 403 });
  });
});
```

- [ ] **Step 2: Run the failing request-code tests**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: FAIL because `requestExtensionAuthCode` is not implemented.

- [ ] **Step 3: Implement request-code service**

Add to `server/lib/extension-auth.ts`:

```ts
type UserLookup = {
  id: string;
  email: string;
  name: string;
  banned: boolean | null;
};

export type RequestCodeDeps = {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  sendCode: (email: string, name?: string) => Promise<void>;
};

const pendingOtpNames = new Map<string, { name: string; expiresAt: number }>();

export function rememberPendingOtpName(email: string, name?: string): void {
  if (!name) return;
  pendingOtpNames.set(email, { name, expiresAt: Date.now() + 5 * 60_000 });
}

export function consumePendingOtpName(email: string): string | null {
  const pending = pendingOtpNames.get(email);
  if (!pending) return null;
  pendingOtpNames.delete(email);
  if (pending.expiresAt < Date.now()) return null;
  return pending.name;
}

export async function requestExtensionAuthCode(
  body: { email?: unknown; name?: unknown },
  deps: RequestCodeDeps,
): Promise<{ ok: true; isNewUser: boolean }> {
  const email = normalizeExtensionEmail(body.email);
  const existingUser = await deps.findUserByEmail(email);

  if (existingUser?.banned) throw extensionAuthError('account_blocked');

  if (!existingUser && body.name == null) {
    throw extensionAuthError('name_required', { isNewUser: true });
  }

  const name = existingUser ? undefined : normalizeExtensionName(body.name);
  try {
    await deps.sendCode(email, name);
  } catch (err) {
    console.error('[extension-auth] send code failed:', err);
    throw extensionAuthError('email_send_failed');
  }

  return { ok: true, isNewUser: !existingUser };
}
```

- [ ] **Step 4: Create the request-code route**

Create `server/app/api/extension-auth/request-code/route.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
import {
  jsonForExtensionAuthError,
  rememberPendingOtpName,
  requestExtensionAuthCode,
} from '@/lib/extension-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await requestExtensionAuthCode(body, {
      findUserByEmail: async (email) => {
        const [row] = await db.select().from(user).where(eq(user.email, email));
        return row ?? null;
      },
      sendCode: async (email, name) => {
        rememberPendingOtpName(email, name);
        await auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' },
          headers: request.headers,
        });
      },
    });

    return Response.json(result);
  } catch (err) {
    return jsonForExtensionAuthError(err);
  }
}
```

If TypeScript reports that `type: 'sign-in'` is not accepted by the installed better-auth version, inspect the generated type for `auth.api.sendVerificationOTP` and use the installed package's supported value. Preserve the public `/api/extension-auth/request-code` contract.

- [ ] **Step 5: Run server tests**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check/build the server**

Run:

```bash
cd server && npm run build
```

Expected: build succeeds. If this fails because required env vars are missing locally, create a temporary `.env.local` with development values and rerun.

- [ ] **Step 7: Commit**

```bash
git add server/lib/extension-auth.ts server/app/api/extension-auth/request-code/route.ts server/__tests__/extension-auth.test.ts
git commit -m "feat(server): add extension auth code request"
```

---

## Task 3: Server Verify-Code Endpoint

**Files:**
- Modify: `server/lib/extension-auth.ts`
- Create: `server/app/api/extension-auth/verify-code/route.ts`
- Test: `server/__tests__/extension-auth.test.ts`

- [ ] **Step 1: Add failing tests for verify-code behavior**

Append to `server/__tests__/extension-auth.test.ts`:

```ts
import { verifyExtensionAuthCode } from '../lib/extension-auth';

describe('verifyExtensionAuthCode', () => {
  it('requires name when verified email is new', async () => {
    const deps = {
      findUserByEmail: async () => null,
      verifyCode: async () => ({ token: 'tok', user: { id: 'u1', email: 'new@example.com', name: '', role: null, banned: false } }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'new@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'name_required', status: 400 });
  });

  it('returns token and user for a new verified email with name', async () => {
    let updated: { id: string; name: string } | null = null;
    const deps = {
      findUserByEmail: async () => null,
      verifyCode: async () => ({ token: 'tok', user: { id: 'u1', email: 'new@example.com', name: '', role: null, banned: false } }),
      updateUserName: async (id: string, name: string) => { updated = { id, name }; },
    };

    await expect(verifyExtensionAuthCode({ email: 'NEW@example.com', code: '123456', name: ' Eric ' }, deps))
      .resolves.toEqual({
        token: 'tok',
        user: { id: 'u1', email: 'new@example.com', name: 'Eric', role: 'user' },
      });
    expect(updated).toEqual({ id: 'u1', name: 'Eric' });
  });

  it('returns token and user for an existing verified email', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => ({ token: 'tok', user: { id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false } }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .resolves.toEqual({
        token: 'tok',
        user: { id: 'u1', email: 'old@example.com', name: 'Old User', role: 'user' },
      });
  });

  it('blocks banned users after verification', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'blocked@example.com', name: 'Blocked User', role: null, banned: true }),
      verifyCode: async () => ({ token: 'tok', user: { id: 'u1', email: 'blocked@example.com', name: 'Blocked User', role: null, banned: true } }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'blocked@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'account_blocked', status: 403 });
  });
});
```

- [ ] **Step 2: Run the failing verify-code tests**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: FAIL because `verifyExtensionAuthCode` is not implemented.

- [ ] **Step 3: Implement verify-code service**

Add to `server/lib/extension-auth.ts`:

```ts
type VerifiedSession = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string | null;
    banned: boolean | null;
  };
};

export type VerifyCodeDeps = {
  findUserByEmail: (email: string) => Promise<(UserLookup & { role: string | null }) | null>;
  verifyCode: (email: string, code: string, name?: string) => Promise<VerifiedSession>;
  updateUserName: (userId: string, name: string) => Promise<void>;
};

export async function verifyExtensionAuthCode(
  body: { email?: unknown; code?: unknown; name?: unknown },
  deps: VerifyCodeDeps,
): Promise<{ token: string; user: { id: string; email: string; name: string; role: string } }> {
  const email = normalizeExtensionEmail(body.email);
  const code = normalizeExtensionCode(body.code);
  const existingUser = await deps.findUserByEmail(email);

  if (existingUser?.banned) throw extensionAuthError('account_blocked');
  const nameForNewUser = existingUser ? undefined : normalizeExtensionName(body.name);

  let verified: VerifiedSession;
  try {
    verified = await deps.verifyCode(email, code, nameForNewUser);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('expired')) throw extensionAuthError('expired_code');
    throw extensionAuthError('invalid_code');
  }

  if (verified.user.banned) throw extensionAuthError('account_blocked');

  const finalName = existingUser?.name ?? nameForNewUser ?? verified.user.name ?? '';
  if (!existingUser && nameForNewUser) {
    await deps.updateUserName(verified.user.id, nameForNewUser);
  }

  return {
    token: verified.token,
    user: {
      id: verified.user.id,
      email: verified.user.email,
      name: finalName,
      role: verified.user.role ?? 'user',
    },
  };
}
```

- [ ] **Step 4: Create the verify-code route**

Create `server/app/api/extension-auth/verify-code/route.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
import {
  jsonForExtensionAuthError,
  verifyExtensionAuthCode,
} from '@/lib/extension-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await verifyExtensionAuthCode(body, {
      findUserByEmail: async (email) => {
        const [row] = await db.select().from(user).where(eq(user.email, email));
        return row ?? null;
      },
      verifyCode: async (email, code, name) => {
        const result = await auth.api.signInEmailOTP({
          body: { email, otp: code, name },
          headers: request.headers,
        });
        return {
          token: result.token,
          user: result.user,
        };
      },
      updateUserName: async (userId, name) => {
        await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId));
      },
    });

    return Response.json(result);
  } catch (err) {
    return jsonForExtensionAuthError(err);
  }
}
```

If the installed better-auth return shape differs, adapt only this route adapter so `verifyExtensionAuthCode` still receives `{ token, user }`.

- [ ] **Step 5: Run server tests**

Run:

```bash
cd server && npm test -- __tests__/extension-auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check/build server**

Run:

```bash
cd server && npm run build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add server/lib/extension-auth.ts server/app/api/extension-auth/verify-code/route.ts server/__tests__/extension-auth.test.ts
git commit -m "feat(server): add extension auth code verification"
```

---

## Task 4: Email Greetings

**Files:**
- Modify: `server/lib/email.ts`
- Modify: `server/lib/auth.ts`
- Test: `server/__tests__/email.test.ts`

- [ ] **Step 1: Add failing email greeting tests**

Append to `server/__tests__/email.test.ts`:

```ts
import { buildOtpEmail } from '../lib/email';

it('html includes greeting when recipient name is supplied', () => {
  const { html } = buildResultEmail('found', site, 'My Trip', 'Eric');
  expect(html).toContain('Hi Eric,');
});

it('html omits greeting when recipient name is missing', () => {
  const { html } = buildResultEmail('found', site, 'My Trip');
  expect(html).not.toContain('Hi ,');
});

it('OTP html includes greeting when recipient name is supplied', () => {
  const { html } = buildOtpEmail('123456', 'Eric');
  expect(html).toContain('Hi Eric,');
  expect(html).toContain('123456');
});

it('OTP html omits greeting when recipient name is missing', () => {
  const { html } = buildOtpEmail('123456');
  expect(html).not.toContain('Hi ,');
});
```

- [ ] **Step 2: Run failing email tests**

Run:

```bash
cd server && npm test -- __tests__/email.test.ts
```

Expected: FAIL because `buildResultEmail` does not accept recipient name and `buildOtpEmail` does not exist.

- [ ] **Step 3: Add optional greeting support to result and OTP emails**

Modify `server/lib/email.ts` so `buildResultEmail` signature becomes:

```ts
export function buildResultEmail(
  outcome: Outcome,
  site: MatchedSite | null,
  tripName: string,
  recipientName?: string | null,
): { subject: string; html: string } {
```

Add near the returned `html` body:

```ts
const greeting = recipientName?.trim()
  ? `<p>Hi ${recipientName.trim()},</p>`
  : '';
```

Then include `${greeting}` before `${bodies[outcome]}`.

Add `buildOtpEmail` to `server/lib/email.ts`:

```ts
export function buildOtpEmail(
  otp: string,
  recipientName?: string | null,
): { subject: string; html: string } {
  const greeting = recipientName?.trim()
    ? `<p>Hi ${recipientName.trim()},</p>`
    : '';

  return {
    subject: 'Your CampOsprey verification code',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:32px auto;color:#1a1a1a">
        <h2 style="color:#16a34a;margin-bottom:8px">Your verification code</h2>
        ${greeting}
        <p>Use this 6-digit code to sign in to CampOsprey. It expires in 5 minutes.</p>
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;
                    padding:16px 24px;text-align:center;font-size:32px;font-weight:700;
                    letter-spacing:8px;margin:16px 0;color:#1a1a1a">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:13px">
          If you do not see this email, check Spam, Junk, or Trash.
        </p>
      </div>
    `,
  };
}
```

- [ ] **Step 4: Pass recipient name from booking result route**

Modify `server/app/api/trips/[id]/result/route.ts`:

```ts
const { subject, html } = buildResultEmail(
  outcome,
  matchedSite ?? null,
  trip.name,
  session.user.name,
);
```

- [ ] **Step 5: Use pending signup name in OTP email**

Modify `server/lib/auth.ts` imports:

```ts
import { buildOtpEmail, sendEmail } from '@/lib/email';
import { consumePendingOtpName } from '@/lib/extension-auth';
```

Replace the inline `sendVerificationOTP` email body with:

```ts
sendVerificationOTP: async ({ email, otp }) => {
  const recipientName = consumePendingOtpName(email);
  const { subject, html } = buildOtpEmail(otp, recipientName);
  await sendEmail({ to: email, subject, html });
},
```

- [ ] **Step 6: Run email tests**

Run:

```bash
cd server && npm test -- __tests__/email.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/email.ts server/lib/auth.ts server/app/api/trips/[id]/result/route.ts server/__tests__/email.test.ts
git commit -m "feat(server): greet users in auth and result emails"
```

---

## Task 5: Extension Auth Storage

**Files:**
- Modify: `extension/src/types.ts`
- Modify: `extension/src/storage.ts`
- Test: `extension/tests/storage.test.ts`

- [ ] **Step 1: Add failing storage tests**

Append to `extension/tests/storage.test.ts`:

```ts
import { clearAuthSession, getAuth, saveAuth } from '../src/storage';

describe('auth storage', () => {
  it('defaults auth to signed out', async () => {
    const auth = await getAuth();
    expect(auth).toEqual({ token: null, user: null, lastEmail: null });
  });

  it('saves token, user, and lastEmail', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });

    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });
  });

  it('clears token and user while keeping lastEmail on sign out', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });

    await clearAuthSession();

    await expect(getAuth()).resolves.toEqual({
      token: null,
      user: null,
      lastEmail: 'user@example.com',
    });
  });
});
```

- [ ] **Step 2: Run failing extension storage tests**

Run:

```bash
cd extension && npm test -- tests/storage.test.ts
```

Expected: FAIL because auth types/helpers do not exist.

- [ ] **Step 3: Add auth types**

Modify `extension/src/types.ts`:

```ts
export interface ServerUser {
  id: string
  email: string
  name: string
  role: string
}

export interface AuthState {
  token: string | null
  user: ServerUser | null
  lastEmail: string | null
}
```

Add to `StorageData`:

```ts
auth: AuthState
```

- [ ] **Step 4: Add storage defaults and helpers**

Modify `extension/src/storage.ts`:

```ts
import type { AuthState, StorageData, Trip, PaymentConfig, Settings } from './types'
```

Add to `DEFAULTS`:

```ts
auth: { token: null, user: null, lastEmail: null },
```

Add helpers:

```ts
export async function getAuth(): Promise<AuthState> {
  const { auth } = await getStorage()
  return auth
}

export async function saveAuth(auth: AuthState): Promise<void> {
  await promisify<void>(cb => chrome.storage.local.set({ auth }, cb))
}

export async function clearAuthSession(): Promise<void> {
  const { auth } = await getStorage()
  await saveAuth({ token: null, user: null, lastEmail: auth.lastEmail })
}
```

- [ ] **Step 5: Run extension storage tests**

Run:

```bash
cd extension && npm test -- tests/storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/types.ts extension/src/storage.ts extension/tests/storage.test.ts
git commit -m "feat(extension): add server auth storage"
```

---

## Task 6: Extension Server API and Auth Client

**Files:**
- Create: `extension/src/serverApi.ts`
- Create: `extension/src/auth.ts`
- Test: `extension/tests/auth.test.ts`

- [ ] **Step 1: Write failing auth client tests**

Create `extension/tests/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestCode, signOut, validateAuth, verifyCode } from '../src/auth';
import { getAuth, saveAuth } from '../src/storage';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('extension auth client', () => {
  it('requests an email code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, isNewUser: false }), { status: 200 })));

    await expect(requestCode({ email: 'user@example.com' })).resolves.toEqual({ ok: true, isNewUser: false });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/extension-auth/request-code'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('stores auth after verifying code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
    }), { status: 200 })));

    await verifyCode({ email: 'user@example.com', code: '123456', name: 'Eric' });

    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });
  });

  it('validates a stored token with /api/user', async () => {
    await saveAuth({ token: 'tok', user: null, lastEmail: 'user@example.com' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'u1',
      email: 'user@example.com',
      name: 'Eric',
      role: 'user',
    }), { status: 200 })));

    await expect(validateAuth()).resolves.toBe(true);
    await expect(getAuth()).resolves.toEqual({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });
  });

  it('clears token and user when validation fails', async () => {
    await saveAuth({
      token: 'bad',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })));

    await expect(validateAuth()).resolves.toBe(false);
    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com' });
  });

  it('signs out while keeping lastEmail', async () => {
    await saveAuth({
      token: 'tok',
      user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' },
      lastEmail: 'user@example.com',
    });

    await signOut();

    await expect(getAuth()).resolves.toEqual({ token: null, user: null, lastEmail: 'user@example.com' });
  });
});
```

- [ ] **Step 2: Run failing auth client tests**

Run:

```bash
cd extension && npm test -- tests/auth.test.ts
```

Expected: FAIL because `extension/src/auth.ts` does not exist.

- [ ] **Step 3: Add server API wrapper**

Create `extension/src/serverApi.ts`:

```ts
import { getAuth } from './storage'

const DEFAULT_BASE_URL = 'http://localhost:3001'

export class ServerApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export function getServerBaseUrl(): string {
  return DEFAULT_BASE_URL
}

export async function serverFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  if (options.auth) {
    const { token } = await getAuth()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${getServerBaseUrl()}${path}`, {
    ...options,
    headers,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ServerApiError(response.status, String(data.error ?? 'server_error'))
  }
  return data as T
}
```

- [ ] **Step 4: Add auth client**

Create `extension/src/auth.ts`:

```ts
import type { ServerUser } from './types'
import { clearAuthSession, getAuth, saveAuth } from './storage'
import { serverFetch } from './serverApi'

export interface RequestCodeInput {
  email: string
  name?: string
}

export interface VerifyCodeInput {
  email: string
  code: string
  name?: string
}

export async function requestCode(input: RequestCodeInput): Promise<{ ok: true; isNewUser: boolean }> {
  return serverFetch('/api/extension-auth/request-code', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function verifyCode(input: VerifyCodeInput): Promise<{ token: string; user: ServerUser }> {
  const result = await serverFetch<{ token: string; user: ServerUser }>('/api/extension-auth/verify-code', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  await saveAuth({ token: result.token, user: result.user, lastEmail: result.user.email })
  return result
}

export async function validateAuth(): Promise<boolean> {
  const auth = await getAuth()
  if (!auth.token) return false

  try {
    const user = await serverFetch<ServerUser>('/api/user', { method: 'GET', auth: true })
    await saveAuth({ token: auth.token, user, lastEmail: user.email })
    return true
  } catch {
    await clearAuthSession()
    return false
  }
}

export async function signOut(): Promise<void> {
  await clearAuthSession()
}
```

- [ ] **Step 5: Run auth client tests**

Run:

```bash
cd extension && npm test -- tests/auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/serverApi.ts extension/src/auth.ts extension/tests/auth.test.ts
git commit -m "feat(extension): add server auth client"
```

---

## Task 7: Shared Start Auth Gate

**Files:**
- Create: `extension/src/startAuthGate.ts`
- Test: `extension/tests/startAuthGate.test.ts`

- [ ] **Step 1: Write failing start gate tests**

Create `extension/tests/startAuthGate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumePendingStartTripId, openAuthGateForTrip, requireServerAuthForStart } from '../src/startAuthGate';
import { saveAuth } from '../src/storage';

vi.mock('../src/auth', () => ({
  validateAuth: vi.fn(),
}));

import { validateAuth } from '../src/auth';

beforeEach(async () => {
  vi.clearAllMocks();
  await saveAuth({ token: null, user: null, lastEmail: null });
});

describe('start auth gate', () => {
  it('blocks start and records pending trip when signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(false);
    expect(consumePendingStartTripId()).toBe('trip-1');
  });

  it('allows start when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true);

    await expect(requireServerAuthForStart('trip-1')).resolves.toBe(true);
    expect(consumePendingStartTripId()).toBeNull();
  });

  it('can manually set pending trip for UI flows', () => {
    openAuthGateForTrip('trip-2');
    expect(consumePendingStartTripId()).toBe('trip-2');
    expect(consumePendingStartTripId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing start gate tests**

Run:

```bash
cd extension && npm test -- tests/startAuthGate.test.ts
```

Expected: FAIL because `startAuthGate.ts` does not exist.

- [ ] **Step 3: Implement start auth gate**

Create `extension/src/startAuthGate.ts`:

```ts
import { validateAuth } from './auth'

let pendingStartTripId: string | null = null
const listeners = new Set<() => void>()

export function onAuthGateChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  listeners.forEach(listener => listener())
}

export function openAuthGateForTrip(tripId: string | null): void {
  pendingStartTripId = tripId
  emit()
}

export function consumePendingStartTripId(): string | null {
  const tripId = pendingStartTripId
  pendingStartTripId = null
  emit()
  return tripId
}

export async function requireServerAuthForStart(tripId: string): Promise<boolean> {
  const ok = await validateAuth()
  if (ok) return true
  openAuthGateForTrip(tripId)
  return false
}
```

- [ ] **Step 4: Run start gate tests**

Run:

```bash
cd extension && npm test -- tests/startAuthGate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/startAuthGate.ts extension/tests/startAuthGate.test.ts
git commit -m "feat(extension): add start auth gate"
```

---

## Task 8: Popup Login UI and Start Gate

**Files:**
- Modify: `extension/src/popup/index.ts`
- Test: `extension/tests/popup.test.ts`

- [ ] **Step 1: Write failing popup behavior tests**

Create `extension/tests/popup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAuth, saveTrips } from '../src/storage';
import type { Trip } from '../src/types';

vi.mock('../src/background/login', () => ({ isLoggedIn: vi.fn(async () => true) }));
vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' } })),
  validateAuth: vi.fn(),
}));

import { validateAuth } from '../src/auth';

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
  };
}

beforeEach(async () => {
  document.body.innerHTML = `
    <a id="settings-link"></a>
    <button id="add-trip-btn"></button>
    <div id="global-alerts"></div>
    <div id="trips-container"></div>
  `;
  await saveTrips([trip()]);
  await saveAuth({ token: null, user: null, lastEmail: null });
  chrome.runtime.sendMessage = vi.fn();
  vi.resetModules();
});

describe('popup auth gate', () => {
  it('shows sign-in banner while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    await import('../src/popup/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.body.textContent).toContain('Sign in to start trips');
  });

  it('does not send SCAN_NOW when Start is clicked signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    await import('../src/popup/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'SCAN_NOW', tripId: 'trip-1' });
  });

  it('sends SCAN_NOW when auth validates', async () => {
    vi.mocked(validateAuth).mockResolvedValue(true);
    await import('../src/popup/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SCAN_NOW', tripId: 'trip-1' });
  });
});
```

- [ ] **Step 2: Run failing popup tests**

Run:

```bash
cd extension && npm test -- tests/popup.test.ts
```

Expected: FAIL because popup does not render server auth UI or gate Start.

- [ ] **Step 3: Add popup account rendering**

Modify `extension/src/popup/index.ts` imports:

```ts
import { getAuth } from '../storage'
import { requestCode, signOut, verifyCode } from '../auth'
import { consumePendingStartTripId, requireServerAuthForStart } from '../startAuthGate'
```

Add a helper near `render()`:

```ts
function accountPanelHTML(auth: Awaited<ReturnType<typeof getAuth>>): string {
  if (auth.user) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center">
      <span>Signed in as ${auth.user.name}</span>
      <button class="btn btn-stop" id="sign-out-btn">Sign out</button>
    </div>`
  }

  return `<div class="alert-warn" id="server-auth-panel">
    <strong>Sign in to start trips</strong><br>
    Get booking emails and keep your trips connected to your account.
    <div style="margin-top:8px">
      <input id="auth-email" class="auth-input" placeholder="Email" value="${auth.lastEmail ?? ''}">
      <input id="auth-name" class="auth-input" placeholder="Name" style="display:none;margin-top:6px">
      <button class="btn btn-start" id="auth-send-code">Sign in with email</button>
    </div>
    <div id="auth-code-row" style="display:none;margin-top:8px">
      <input id="auth-code" class="auth-input" placeholder="6-digit code">
      <div style="margin-top:6px;color:var(--text-muted);line-height:1.5">
        Cannot find the code? Check Spam, Junk, or Trash, and search your email for "CampOsprey".
      </div>
      <button class="btn btn-start" id="auth-verify-code">Verify</button>
    </div>
    <div id="auth-error" style="margin-top:6px;color:var(--red)"></div>
  </div>`
}
```

Add minimal popup CSS in `extension/popup/index.html`:

```css
.auth-input { width: 100%; background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; color: var(--text); font-size: 11px; margin-bottom: 6px; }
```

- [ ] **Step 4: Wire popup account events**

Inside `render()`, replace the current assignment to `globalAlertsEl.innerHTML` with:

```ts
const auth = await getAuth()
globalAlertsEl.innerHTML = accountPanelHTML(auth) + renderWarnings(getGlobalWarnings(trips, loggedIn))
bindAccountPanel()
```

Add below `render()`:

```ts
function setAuthError(message: string): void {
  const el = document.getElementById('auth-error')
  if (el) el.textContent = message
}

function authMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid email address.',
    name_required: 'Enter your name so we can set up your account.',
    invalid_code: 'That code did not work. Check the code and try again.',
    expired_code: 'That code expired. Send a new code.',
    rate_limited: 'Too many attempts. Wait a bit, then try again.',
    account_blocked: 'This account cannot use CampOsprey. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach CampOsprey right now. Try again in a moment.'
}

function bindAccountPanel(): void {
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    await signOut()
    await render()
  })

  document.getElementById('auth-send-code')?.addEventListener('click', async () => {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    const nameEl = document.getElementById('auth-name') as HTMLInputElement | null
    try {
      await requestCode({ email, name: nameEl?.style.display === 'none' ? undefined : nameEl?.value })
      document.getElementById('auth-code-row')!.style.display = 'block'
    } catch (err) {
      const code = err instanceof Error ? err.message : 'server_error'
      if (code === 'name_required' && nameEl) nameEl.style.display = 'block'
      setAuthError(authMessage(code))
    }
  })

  document.getElementById('auth-verify-code')?.addEventListener('click', async () => {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    const code = (document.getElementById('auth-code') as HTMLInputElement).value
    const name = (document.getElementById('auth-name') as HTMLInputElement | null)?.value
    try {
      await verifyCode({ email, code, name })
      const pendingTripId = consumePendingStartTripId()
      await render()
      if (pendingTripId) {
        await updateTrip(pendingTripId, { status: 'scanning', lastMatch: null, attempted: [] })
        chrome.storage.local.remove('campOspreyTarget')
        chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: pendingTripId })
      }
    } catch (err) {
      setAuthError(authMessage(err instanceof Error ? err.message : 'server_error'))
    }
  })
}
```

- [ ] **Step 5: Gate popup Start click**

In popup Start handler, before `updateTrip`, add:

```ts
if (action === 'start' && !(await requireServerAuthForStart(id))) {
  await render()
  return
}
```

- [ ] **Step 6: Run popup tests**

Run:

```bash
cd extension && npm test -- tests/popup.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/popup/index.ts extension/popup/index.html extension/tests/popup.test.ts
git commit -m "feat(extension): gate popup start on server login"
```

---

## Task 9: Options Login UI and Start Gate

**Files:**
- Modify: `extension/src/options/index.ts`
- Modify: `extension/options/index.html`
- Test: `extension/tests/options-auth.test.ts`

- [ ] **Step 1: Write failing options tests**

Create `extension/tests/options-auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAuth, saveTrips } from '../src/storage';
import type { Trip } from '../src/types';

vi.mock('../src/background/login', () => ({
  isLoggedIn: vi.fn(async () => true),
  watchLoginChanges: vi.fn(),
}));
vi.mock('../src/auth', () => ({
  requestCode: vi.fn(async () => ({ ok: true, isNewUser: false })),
  signOut: vi.fn(async () => undefined),
  validateAuth: vi.fn(),
  verifyCode: vi.fn(async () => ({ token: 'tok', user: { id: 'u1', email: 'user@example.com', name: 'Eric', role: 'user' } })),
}));

import { validateAuth } from '../src/auth';

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
  };
}

beforeEach(async () => {
  document.body.innerHTML = `
    <div class="tab active" data-tab="trips"></div>
    <div id="tab-trips"></div>
    <div id="tab-payment" class="hidden"></div>
    <div id="tab-settings" class="hidden"></div>
    <div id="global-alerts"></div>
    <div id="trip-list"></div>
    <button id="new-trip-btn"></button>
    <div id="trips-view"></div>
    <div id="trip-editor" class="hidden"></div>
    <button id="back-btn"></button>
    <button id="save-trip-btn"></button>
    <button id="delete-trip-btn"></button>
    <button id="save-payment-btn"></button>
    <button id="save-settings-btn"></button>
    <button id="test-notif-btn"></button>
    <button id="clear-log-btn"></button>
    <button id="copy-log-btn"></button>
    <input id="trip-name">
    <select id="trip-mode"><option value="notify">notify</option></select>
    <input id="filter-walkin" type="checkbox">
    <input id="filter-double" type="checkbox">
    <div id="editor-status-bar"></div><div id="editor-status-badge"></div>
    <div id="parks-list"></div><input id="park-search"><div id="park-results"></div>
    <div id="dates-list"></div>
    <div id="error-name"></div><div id="error-parks"></div><div id="error-dates"></div>
    <div id="section-name"></div><div id="section-parks"></div><div id="section-dates"></div>
    <button class="date-mode-btn active" data-mode="specific"></button>
    <button class="date-mode-btn" data-mode="recurring"></button>
    <div id="specific-inputs"></div><div id="recurring-inputs"></div>
    <input id="date-checkin"><input id="date-checkout"><button id="add-date-btn"></button>
    <select id="rec-start-day"><option value="4">Friday</option></select>
    <select id="rec-end-day"></select><select id="rec-month"><option value="7">July</option></select><select id="rec-year"></select>
    <div id="rec-preview"></div>
    <input id="card-number"><input id="card-holder"><input id="card-expiry"><input id="card-cvv"><input id="billing-address"><input id="billing-postal"><input id="party-size">
    <select id="poll-interval"><option value="60"></option></select>
    <input id="debug-mode" type="checkbox"><div id="debug-section"></div><div id="debug-log-box"></div>
  `;
  await saveTrips([trip()]);
  await saveAuth({ token: null, user: null, lastEmail: null });
  chrome.runtime.sendMessage = vi.fn();
  vi.resetModules();
});

describe('options auth gate', () => {
  it('shows sign-in banner while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    await import('../src/options/index');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Sign in to start trips');
  });

  it('does not start list trip while signed out', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    await import('../src/options/index');
    await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'SCAN_NOW', tripId: 'trip-1' });
  });
});
```

- [ ] **Step 2: Run failing options tests**

Run:

```bash
cd extension && npm test -- tests/options-auth.test.ts
```

Expected: FAIL because options UI does not render server auth banner or gate Start.

- [ ] **Step 3: Reuse popup account logic in options**

To avoid duplicating UI code, create `extension/src/authPanel.ts`:

```ts
import { requestCode, signOut, verifyCode } from './auth'
import { consumePendingStartTripId } from './startAuthGate'
import type { AuthState } from './types'

export function authPanelHTML(auth: AuthState): string {
  if (auth.user) {
    return `<div class="alert-warn" style="display:flex;justify-content:space-between;align-items:center">
      <span>Signed in as ${auth.user.name}</span>
      <button class="trip-action-btn" id="sign-out-btn">Sign out</button>
    </div>`
  }
  return `<div class="alert-warn" id="server-auth-panel">
    <strong>Sign in to start trips</strong><br>
    Get booking emails and keep your trips connected to your account.
    <div style="margin-top:8px">
      <input id="auth-email" class="input" placeholder="Email" value="${auth.lastEmail ?? ''}">
      <input id="auth-name" class="input" placeholder="Name" style="display:none;margin-top:6px">
      <button class="trip-action-btn" id="auth-send-code" style="margin-top:6px">Sign in with email</button>
    </div>
    <div id="auth-code-row" style="display:none;margin-top:8px">
      <input id="auth-code" class="input" placeholder="6-digit code">
      <div class="hint" style="margin-top:6px">Cannot find the code? Check Spam, Junk, or Trash, and search your email for "CampOsprey".</div>
      <button class="trip-action-btn" id="auth-verify-code" style="margin-top:6px">Verify</button>
    </div>
    <div id="auth-error" style="margin-top:6px;color:var(--red)"></div>
  </div>`
}

export function authMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_email: 'Enter a valid email address.',
    name_required: 'Enter your name so we can set up your account.',
    invalid_code: 'That code did not work. Check the code and try again.',
    expired_code: 'That code expired. Send a new code.',
    rate_limited: 'Too many attempts. Wait a bit, then try again.',
    account_blocked: 'This account cannot use CampOsprey. Contact support if this seems wrong.',
  }
  return map[code] ?? 'Cannot reach CampOsprey right now. Try again in a moment.'
}

export function bindAuthPanel(onSignedIn: (pendingTripId: string | null) => Promise<void>, onChanged: () => Promise<void>): void {
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
    const nameEl = document.getElementById('auth-name') as HTMLInputElement | null
    try {
      await requestCode({ email, name: nameEl?.style.display === 'none' ? undefined : nameEl?.value })
      document.getElementById('auth-code-row')!.style.display = 'block'
      setError('')
    } catch (err) {
      const code = err instanceof Error ? err.message : 'server_error'
      if (code === 'name_required' && nameEl) nameEl.style.display = 'block'
      setError(authMessage(code))
    }
  })

  document.getElementById('auth-verify-code')?.addEventListener('click', async () => {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value
    const code = (document.getElementById('auth-code') as HTMLInputElement).value
    const name = (document.getElementById('auth-name') as HTMLInputElement | null)?.value
    try {
      await verifyCode({ email, code, name })
      await onSignedIn(consumePendingStartTripId())
    } catch (err) {
      setError(authMessage(err instanceof Error ? err.message : 'server_error'))
    }
  })
}
```

Then refactor popup to import this helper and remove duplicated account panel functions if Task 8 added them inline.

- [ ] **Step 4: Render account panel in options**

Modify `extension/src/options/index.ts` imports:

```ts
import { getAuth } from '../storage'
import { authPanelHTML, bindAuthPanel } from '../authPanel'
import { requireServerAuthForStart } from '../startAuthGate'
```

In `renderTripList()`, before warnings:

```ts
const auth = await getAuth()
```

Set `globalAlertsEl.innerHTML` to:

```ts
globalAlertsEl.innerHTML = authPanelHTML(auth) + renderWarnings(getGlobalWarnings(trips, loggedIn))
bindAuthPanel(async pendingTripId => {
  await renderTripList()
  if (pendingTripId) {
    chrome.storage.local.remove('campOspreyTarget')
    await updateTrip(pendingTripId, { status: 'scanning', lastMatch: null, attempted: [] })
    chrome.runtime.sendMessage({ type: 'SCAN_NOW', tripId: pendingTripId })
  }
}, renderTripList)
```

- [ ] **Step 5: Gate options list Start**

In the options list Start handler, before BC Parks login checks and `SCAN_NOW`, add:

```ts
if (!(await requireServerAuthForStart(id))) {
  await renderTripList()
  return
}
```

- [ ] **Step 6: Gate save-and-start**

In `save-trip-btn` handler, after validation and before BC Parks login checks:

```ts
const startTripId = editingTripId ?? crypto.randomUUID()
if (!(await requireServerAuthForStart(startTripId))) {
  return
}
```

Use `startTripId` as `newId` for new trips so the pending auth gate starts the correct trip after verification. Do not generate a second UUID later in the handler.

- [ ] **Step 7: Run options tests**

Run:

```bash
cd extension && npm test -- tests/options-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run popup tests again after shared helper refactor**

Run:

```bash
cd extension && npm test -- tests/popup.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/src/authPanel.ts extension/src/options/index.ts extension/src/popup/index.ts extension/tests/options-auth.test.ts extension/tests/popup.test.ts
git commit -m "feat(extension): gate options start on server login"
```

---

## Task 10: Background Defense-in-Depth Auth Check

**Files:**
- Modify: `extension/src/background/index.ts`
- Test: `extension/tests/background/index.test.ts`

- [ ] **Step 1: Add failing background auth test**

Modify `extension/tests/background/index.test.ts` mock setup to include `validateAuth`:

```ts
vi.mock('../../src/auth', () => ({
  validateAuth: vi.fn(async () => true),
}));
```

Add a test:

```ts
import { validateAuth } from '../../src/auth';

it('skips scanning when CampOsprey server auth is invalid', async () => {
  vi.mocked(validateAuth).mockResolvedValue(false);
  await saveTrips([makeTrip({ status: 'scanning' })]);

  await triggerAlarm();

  expect(mockGetAvailability).not.toHaveBeenCalled();
});
```

Use the existing test helpers in `extension/tests/background/index.test.ts` for `makeTrip`, `saveTrips`, `triggerAlarm`, and `mockGetAvailability`; do not duplicate them if they already exist.

- [ ] **Step 2: Run failing background test**

Run:

```bash
cd extension && npm test -- tests/background/index.test.ts
```

Expected: FAIL because background scanning does not call `validateAuth`.

- [ ] **Step 3: Add background auth guard**

Modify `extension/src/background/index.ts` imports:

```ts
import { validateAuth } from '../auth'
```

Inside the loop over `scanningTrips`, before BC Parks login check:

```ts
const serverLoggedIn = await validateAuth()
if (!serverLoggedIn) {
  if (debug) await addDebugLog(`"${trip.name}" — CampOsprey login required, skipping scan`)
  await notify(
    'CampOsprey — Sign In Required',
    `Sign in to CampOsprey to start "${trip.name}"`,
  )
  continue
}
```

- [ ] **Step 4: Run background tests**

Run:

```bash
cd extension && npm test -- tests/background/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/index.ts extension/tests/background/index.test.ts
git commit -m "feat(extension): require server auth in background scanner"
```

---

## Task 11: End-to-End Verification

**Files:**
- No new files required.

- [ ] **Step 1: Run server test suite**

Run:

```bash
cd server && npm test
```

Expected: all server tests pass.

- [ ] **Step 2: Run server build**

Run:

```bash
cd server && npm run build
```

Expected: Next.js build succeeds.

- [ ] **Step 3: Run extension test suite**

Run:

```bash
cd extension && npm test
```

Expected: all extension Vitest tests pass.

- [ ] **Step 4: Run extension build**

Run:

```bash
cd extension && npm run build
```

Expected: extension build succeeds.

- [ ] **Step 5: Manual browser check**

Run server:

```bash
cd server && npm run dev
```

Run extension build/watch as the project normally requires:

```bash
cd extension && npm run build
```

Load the built extension unpacked in Chrome. Verify:

- Signed-out popup shows `Sign in to start trips`.
- Signed-out options page shows the same banner.
- Clicking Start while signed out does not start scanning.
- Entering a new email first asks for name.
- Code step shows the Spam/Junk/Trash hint.
- Successful verification stores auth and starts the pending trip.
- Sign out clears session and keeps the remembered email.
- Hold/Auto-pay still require BC Parks login after CampOsprey login succeeds.

- [ ] **Step 6: Final commit if any verification fixes were needed**

```bash
git status --short
git diff --name-only
git add docs/superpowers/plans/2026-05-26-extension-server-login.md
git commit -m "fix: complete extension server login verification"
```

If verification changed source or test files instead of the plan, replace the
`git add` path above with the exact paths printed by `git diff --name-only`.
