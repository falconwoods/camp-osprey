# Extension Server Login Gate — Design Spec

**Date:** 2026-05-26
**Status:** Approved for implementation planning

## Overview

CampOsprey will require users to sign in to the CampOsprey server before any
trip can start scanning. The extension will guide unauthenticated users through
a passwordless email-code flow, explain why sign-in is useful, and only start
the requested trip after server authentication succeeds.

This is separate from BC Parks login. BC Parks login is still required for Hold
and Auto-pay booking actions. CampOsprey server login is required for all trip
modes so the product can send account-based emails, associate trips with users,
track usage, and enforce bans when needed.

## Goals

- Require CampOsprey server login before starting any trip mode.
- Make login feel reasonable by explaining the user-facing benefit.
- Use passwordless email-code auth so users do not need to remember passwords.
- Collect `name` for friendly account and email greetings, such as "Hi Eric".
- Remember the last successful email locally to make future login easier.
- Keep the extension API stable and separate from better-auth's default routes.
- Preserve current BC Parks login checks for Hold and Auto-pay.

## Non-Goals

- Do not infer gender or other demographics from name.
- Do not require passwords.
- Do not store OTP codes.
- Do not replace BC Parks login with CampOsprey login.
- Do not implement broader trip sync in this feature beyond auth-ready API
  boundaries.

## Current Context

The server already has better-auth configured with:

- email OTP plugin
- bearer token plugin
- admin plugin with user role/ban fields
- `/api/user`
- auth-required trip and booking-result APIs

The extension currently stores trips locally and checks BC Parks login through
cookies. Options page Start already blocks Hold and Auto-pay when BC Parks login
is missing, but server login is not wired into the extension yet. Popup Start
does not currently gate on any login state.

## User Flow

### Signed-out trip list

When the user is not signed in to CampOsprey, both popup and options trip list
show a persistent banner above trips.

Copy:

> **Sign in to start trips**  
> Get booking emails and keep your trips connected to your account.

Primary action:

> Sign in with email

Start buttons are blocked while signed out. The UI may render them disabled or
intercept clicks, but the scanner must not start until server login succeeds.

### Start click while signed out

1. User clicks Start on a trip.
2. Extension checks CampOsprey server auth.
3. If auth is missing or invalid, the login panel opens.
4. The requested trip ID is saved in memory as `pendingStartTripId`.
5. Scanner does not start.
6. User completes email-code login.
7. Extension stores auth state.
8. Extension starts the originally requested trip automatically.

The "automatic start" happens only after successful server login. It avoids a
second Start click, but it never bypasses authentication.

### Email step

The login panel asks for email. If the email was used successfully before, it is
prefilled from `auth.lastEmail`.

The first request can send only email. If the server reports that this is a new
email and name is required, the UI expands to show the name field, then sends the
code request again with `email` and `name`. The name is used for display and
friendly email greetings.

### Code step

The code screen shows:

> We sent a 6-digit code to {email}. No password needed.

Troubleshooting hint:

> Cannot find the code? Check Spam, Junk, or Trash, and search your email for
> "CampOsprey".

Primary button labels:

- `Verify and start trip` when login was triggered by Start.
- `Verify` when login was opened from the account banner.

### Signed-in state

The banner is replaced by a compact account row:

> Signed in as {name}

Actions:

- Sign out
- Use another email, when the login panel is showing a remembered email

On sign-out, clear `auth.token` and `auth.user`, but keep `auth.lastEmail` so
future login is easier.

## Extension Storage

Add an `auth` object to `chrome.storage.local`:

```ts
interface AuthState {
  token: string | null
  user: {
    id: string
    email: string
    name: string
    role: string
  } | null
  lastEmail: string | null
}
```

Rules:

- Save `lastEmail` only after successful code verification.
- Keep `lastEmail` after sign-out.
- Never store OTP codes.
- Send `Authorization: Bearer <token>` to server APIs when `token` exists.

## Server API

better-auth keeps its default routes under `/api/auth/*`. The extension calls
stable product routes under `/api/extension-auth/*` instead.

### `POST /api/extension-auth/request-code`

Request:

```json
{
  "email": "user@example.com",
  "name": "Eric"
}
```

Behavior:

- Normalize and validate email.
- Check whether a user already exists.
- If the email is new and `name` is missing, return `name_required` and
  `isNewUser: true` without sending an email.
- If the email is new and `name` is present, send the code.
- If the email exists, ignore `name`.
- Send a 6-digit email code through the existing better-auth email OTP path.
- Do not create an account yet.
- Return a simple extension-friendly response.

Response:

```json
{
  "ok": true,
  "isNewUser": true
}
```

Error examples:

- `400 invalid_email`
- `400 name_required` with `{ "isNewUser": true }`
- `403 account_blocked`
- `429 rate_limited`
- `500 email_send_failed`

### `POST /api/extension-auth/verify-code`

Request:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "name": "Eric"
}
```

Behavior:

- Validate email and code format.
- Verify the OTP through better-auth.
- If email belongs to an existing account, sign in that user.
- If email is new and the OTP is valid, create the user with `name`.
- If the user is banned, reject login with `account_blocked`.
- Return a bearer token and user profile for extension storage.

Response:

```json
{
  "token": "session-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "Eric",
    "role": "user"
  }
}
```

Error examples:

- `400 invalid_email`
- `400 invalid_code`
- `400 expired_code`
- `400 name_required`
- `403 account_blocked`

### `GET /api/user`

Already exists. The extension uses this endpoint to validate stored tokens on
startup and before starting a trip.

## Auth Check Before Start

The extension start path must call a shared helper before scanning:

```ts
async function requireServerAuthForStart(tripId: string): Promise<boolean>
```

Behavior:

1. Read `auth.token`.
2. If missing, open login UI and return `false`.
3. If present, call `GET /api/user`.
4. If valid, refresh `auth.user` and return `true`.
5. If invalid, clear `auth.token`/`auth.user`, keep `lastEmail`, open login UI,
   and return `false`.

Both popup Start and options Start must use this helper. Background scanning
should also skip trips if a server-authenticated scan is not available, as a
defense-in-depth guard.

## Trip and Result APIs

Existing trip and booking-result APIs remain bearer-token protected:

- `GET /api/trips`
- `POST /api/trips`
- `PUT /api/trips/:id`
- `DELETE /api/trips/:id`
- `POST /api/trips/:id/result`

This feature only gates local trip starting on server login. Full server-primary
trip sync can build on the same token and API later.

## Email Behavior

OTP emails:

- Use existing Resend delivery.
- Use "Hi {name}" when a new user's name is available.
- Keep the code clear and prominent.

Booking/result emails:

- Use `user.name` for greeting when available.
- Continue sending to the signed-in user's email.

## Error Handling

Extension UI should show concise inline messages:

- Invalid email: "Enter a valid email address."
- Name required: "Enter your name so we can set up your account."
- Invalid code: "That code did not work. Check the code and try again."
- Expired code: "That code expired. Send a new code."
- Rate limited: "Too many attempts. Wait a bit, then try again."
- Blocked account: "This account cannot use CampOsprey. Contact support if this seems wrong."
- Network/server issue: "Cannot reach CampOsprey right now. Try again in a moment."

The scanner must not start on any auth error.

## Testing

Server tests:

- New email requires name before code request succeeds.
- Existing email does not require name.
- Verify valid code creates a new account with name.
- Verify valid code signs in an existing account.
- Banned users cannot authenticate.
- Invalid/expired code returns extension-friendly errors.

Extension tests:

- Signed-out trip list shows the sign-in banner.
- Start while signed out opens login and does not send `SCAN_NOW`.
- Successful verify stores `token`, `user`, and `lastEmail`.
- Successful verify after a Start click sends `SCAN_NOW` for the pending trip.
- Last email is prefilled on later login.
- Logout clears token/user but keeps last email.
- Code step includes Spam/Junk/Trash hint.
- Popup and options Start paths both use the same server-auth gate.
