# Extension Account Login Redesign — Design Spec

**Date:** 2026-05-26
**Status:** Approved for implementation planning

## Overview

CampOsprey extension login will move out of the popup and Trips alerts into a
dedicated Account tab inside the Options UI. The popup and Trips tab will show
only lightweight account status and sign-in calls to action. The full
passwordless email-code flow will live in Account, which gives the product a
natural place to show account details later.

The login flow will no longer ask for a name during registration. Registration
and login will use the same email-code UI: enter email, receive code, verify
code. If the email is new, the server creates the account during verification
using email-only account data for now.

## Goals

- Make CampOsprey login a dedicated account-management surface.
- Remove embedded email/code forms from popup and Trips alerts.
- Add an Account tab to Options for login, sign-out, and future account info.
- Keep signed-out Start behavior smooth by resuming the requested trip after
  login succeeds.
- Use the same email-code UI for both registration and login.
- Stop collecting name in the extension for now.
- Preserve the existing BC Parks login checks for Hold and Auto-pay modes.

## Non-Goals

- Do not add plan, billing, usage, or connected-trip account details yet.
- Do not replace BC Parks login with CampOsprey login.
- Do not introduce passwords.
- Do not store OTP codes.
- Do not sync trips to the server as part of this redesign.

## Current Context

The extension currently renders the full CampOsprey server auth panel in both:

- popup global alerts
- Options Trips global alerts

That panel is implemented by `extension/src/authPanel.ts` and bound directly in
popup and options. It works for the immediate login gate, but it makes login
feel like an alert embedded inside unrelated screens. It also duplicates a full
form in surfaces that are too small or too task-focused for account management.

The current pending-start helper keeps `pendingStartTripId` in module memory.
That is not enough for the new flow because the popup closes when Options opens.
The pending trip intent must be shared through extension storage or an
equivalent cross-document state.

## Navigation

Options will add a first-class Account tab alongside the existing tabs:

- Trips
- Payment
- Settings
- Account

The Account tab owns the full CampOsprey server login flow. It also owns
sign-out and future account summary content.

The Options page should support direct navigation to Account through a stable
route such as `options/index.html#account`. The tab initialization logic should
read the hash on load and select Account when present.

Popup account actions should open Options directly to Account rather than
rendering a form in the popup.

## User Flows

### Manual Sign-In

1. User clicks a Sign in or Account action from popup, Trips, or Options nav.
2. Extension opens Options directly to the Account tab.
3. Account tab shows the email-code login flow.
4. User verifies the code.
5. Account tab switches to signed-in account summary.

No trip starts automatically unless there is a pending trip intent.

### Start While Signed Out

1. User clicks Start on a trip from popup or Options.
2. Extension validates CampOsprey server auth.
3. If auth is valid, the trip starts normally.
4. If auth is missing or invalid, extension stores the pending trip ID in shared
   extension state.
5. Extension opens Options directly to the Account tab.
6. User completes email-code login.
7. Account tab consumes the pending trip ID.
8. Extension starts the originally requested trip automatically.

The scanner must not start before CampOsprey server auth succeeds.

### Signed-Out Popup

The popup should show a compact signed-out state, not the full auth form. It can
say that sign-in is required to start trips and provide a button to open
Options Account. Start buttons may remain clickable, but clicking Start while
signed out must route through the Account tab and preserve the pending trip.

### Signed-Out Trips Tab

The Trips tab should show a lightweight warning or CTA when signed out. It
should not contain email or code inputs. Its action opens Account.

### Signed-In Account Tab

The Account tab should show a compact account summary:

- email as the primary account identity
- optional role/status if useful and already available
- Sign out action

The layout should leave room for future account details, but those details are
out of scope for this change.

## Account Login UI

The signed-out Account tab has a single flow for both registration and login.

### Email Step

Fields:

- email

Primary action:

- Send code

The extension may prefill the last successful email from `auth.lastEmail`.

### Code Step

Fields:

- 6-digit code

Copy:

> We sent a 6-digit code to {email}. No password needed.

Troubleshooting hint:

> Cannot find the code? Check Spam, Junk, or Trash, and search your email for
> "CampOsprey".

Primary action labels:

- Verify and start trip, when a pending trip exists
- Verify, when there is no pending trip

### Name Collection

The extension will not collect name during login or registration. Request and
verify calls from the extension should not send `name`.

If the server still has name-related account fields internally, those fields
must not block extension registration. The server should create or return an
email-only account identity for this flow.

## Data And State

The existing `auth` storage shape can remain backward-compatible:

```ts
interface AuthState {
  token: string | null
  user: {
    id: string
    email: string
    name?: string
    role: string
  } | null
  lastEmail: string | null
}
```

Signed-in UI should display `user.email` first. `user.name` may be used only if
present, but it should not be required.

Pending trip intent should be storage-backed, for example:

```ts
interface PendingAuthState {
  pendingStartTripId: string | null
}
```

This can be implemented as a small storage helper or as a field in existing
extension storage. The important requirement is that popup, options, and service
worker code can observe the same pending trip intent.

Pending start state must be cleared after:

- successful consumption and trip start
- explicit sign-out
- the pending trip no longer exists

## Extension API Calls

Extension auth calls should be email/code only:

```ts
requestCode({ email })
verifyCode({ email, code })
```

The extension should not send `name`.

The server routes remain product-stable extension routes:

- `POST /api/extension-auth/request-code`
- `POST /api/extension-auth/verify-code`

The server behavior should allow both existing and new emails through the same
request/verify flow.

## Component Boundaries

The popup should depend on a compact account-status renderer or simple local
markup, not the full login form.

The Options Account tab should own:

- login form rendering
- code-step rendering
- sign-out rendering
- pending-start-aware primary button copy
- post-verify pending trip consumption

Shared auth helpers should own:

- requesting codes
- verifying codes
- validating tokens
- signing out
- storage-backed pending-start helpers

Trip start logic should remain in popup/options orchestration, with the same
auth gate applied before scanner messages are sent.

## Error Handling

Account login errors should map existing extension auth error codes to friendly
messages:

- invalid email
- invalid or expired code
- rate limited
- blocked account
- server unavailable

Errors should render only inside Account login UI. Popup and Trips alerts should
not need detailed auth form errors because they do not host the form.

If a pending trip cannot be found after login, Account should clear the pending
state and show the signed-in summary. It should not attempt to start an unknown
trip.

## Testing

Update or add extension tests for:

- popup signed-out Start opens Options Account and does not send `SCAN_NOW`
  immediately
- options signed-out Start switches or opens Account and stores pending trip
- successful code verification starts the pending trip exactly once
- signed-out popup and Trips banners do not contain email or code inputs
- Account tab renders the email/code flow while signed out
- Account tab renders email and Sign out while signed in
- extension auth calls do not send `name`
- pending start state survives popup closure because it is storage-backed

Existing server auth tests should be updated if they currently require `name`
for new extension users.
