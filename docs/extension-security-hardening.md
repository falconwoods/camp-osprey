# Chrome Extension Security Hardening

This document records the client hardening work added to `app-extension/` and
`server/` to raise the cost of modifying the extension for unpaid use.

## Security Model

Chrome extension source cannot be fully hidden from users. The extension package
is delivered to the user's machine, so a motivated user can unpack, inspect,
debug, and patch JavaScript. Encryption is not a reliable protection boundary
because code must be decrypted locally before it can run, and Manifest V3 does
not allow arbitrary decrypted string code execution through `eval` or remote
hosted code.

The practical goal is therefore:

- keep Trip data and account state authoritative on the server;
- require a server-issued authorization artifact before local scan/payment
  automation can produce billable events;
- reject result/payment reports that are not tied to a valid server-issued scan
  session;
- make website-distributed builds harder to inspect with post-build
  obfuscation.

This does not make cracking impossible. It changes the attack from "delete one
payment-reporting function" into "understand and reproduce a signed, trip-bound,
time-bound protocol while preserving server-side consistency."

## Scan Lease

The server now issues a signed scan lease before a Trip can be scanned.

Implementation:

- `server/lib/scan-lease.ts`
- `server/app/api/trips/[id]/scan-lease/route.ts`

The lease is an HMAC-signed payload. It binds:

- `userId`
- `tripId`
- `clientId`
- Trip `mode`
- a stable hash of Trip fields
- issue time
- expiry time

The default TTL is 2 hours. This is long enough for BC Parks checkout retries and
queued payment reporting, while still limiting reuse.

`SCAN_LEASE_SECRET` should be set in production. If it is missing, the server
falls back to `BETTER_AUTH_SECRET`, but a separate secret is preferred.

## Server Enforcement

The server verifies `scanLease` on these routes:

- `server/app/api/trips/[id]/result/route.ts`
- `server/app/api/booking-payment-events/route.ts`

Result reports require a valid scan lease for:

- `found`
- `hold_placed`
- `booked`
- `failed`

Booking payment events also require:

- a `tripId`;
- a Trip that belongs to the authenticated user;
- a valid scan lease matching that Trip.

If the lease is missing, expired, stale, signed with the wrong secret, bound to a
different Trip/user/client, or generated for a different Trip hash, the server
returns `403`.

## Extension Flow

Before starting a Trip scan, the extension requests a lease:

- `app-extension/src/react/tripActions.ts`
- `app-extension/src/serverApi.ts`

The background worker also refreshes/caches leases during scan cycles:

- `app-extension/src/background/index.ts`

When a match is found, the background worker writes the lease into
`campOspreyTarget` so the content script can carry it through the BC Parks flow.

The content script sends the lease back with:

- `BOOKING_RESERVED`
- `BOOKING_CONFIRMED`
- `BOOKING_FAILED`

Relevant file:

- `app-extension/src/content/bcparks.ts`

The background worker includes the lease in:

- found result reports;
- hold placed reports;
- booked result reports;
- failed result reports;
- booking payment event reports.

## What This Protects Against

This blocks simple patches where a user:

- logs in normally;
- uses the server to create/manage Trips;
- lets the extension scan and auto-pay locally;
- removes or forges the final payment/result report without a valid server scan
  authorization chain.

It also lets the server distinguish between normal authenticated Trip activity
and result/payment reports that were not preceded by a valid lease.

## Remaining Limits

The lease is not secret once delivered to the extension. A patched client can
read it while it is valid. The value is in binding and expiry, not secrecy.

A sophisticated attacker can still patch the extension to request leases and
reuse them inside a modified flow. Additional server-side behavioral checks can
raise cost further:

- record scan lease issuance events in the database;
- track scan-start, site-found, hold-start, hold-placed, payment-start, and
  payment-confirmed sequence consistency;
- rate-limit leases by user, Trip, client, IP, extension version, and channel;
- flag repeated scan leases with no corresponding result/payment events;
- require fresh auth for suspicious clients.

## Secure Website Build

For website-distributed builds, use:

```bash
cd app-extension
npm run build:website:secure
```

This command:

1. removes `.output/chrome-mv3`;
2. builds the extension with `VITE_EXTENSION_CHANNEL=website`;
3. post-processes JavaScript output with `javascript-obfuscator`.

Files:

- `app-extension/scripts/clean-output.mjs`
- `app-extension/scripts/obfuscate-output.mjs`
- `app-extension/package.json`

The obfuscation config uses:

- compact output;
- control-flow flattening;
- dead-code injection;
- hexadecimal identifiers;
- string arrays;
- base64 string encoding;
- string splitting.

Avoid using this build for Chrome Web Store submission unless policy is reviewed
again. Chrome Web Store generally allows minification but disallows obfuscation
that hides extension behavior.

## Verification Commands

Commands used after implementation:

```bash
cd app-extension
npm run compile
npm run build
npm run build:website:secure
for f in $(find .output/chrome-mv3 -type f -name '*.js' | sort); do node --check "$f" >/dev/null || exit 1; done
find .output/chrome-mv3 -type f -name '*.map' -print
```

```bash
cd server
npm run build
```

`server` full `npx tsc --noEmit` was not used as the completion gate because
existing test typing issues currently fail in:

- `server/__tests__/next-with-env.test.ts`
- `server/__tests__/stripe-webhooks.test.ts`

The Next production build passed and includes:

- `/api/trips/[id]/scan-lease`
- `/api/trips/[id]/result`
- `/api/booking-payment-events`

