# Extension Scan Rate Control

This document defines the proposed scan scheduling and rate-control model for
`app-extension/` when checking BC Parks availability.

## Problem

The current scanner can generate a high number of BC Parks availability requests
because the request count grows as a product of user-created data:

```text
active Trips x parks per Trip x date windows per Trip
```

There is currently no product limit on:

- number of Trips a user can create;
- number of parks in a Trip;
- number of date ranges or expanded date windows in a Trip.

The existing `DATE_WINDOW_DELAY_MS = 300` delay only spaces requests inside a
Trip. It does not cap total request volume. If a user configures many Trips,
parks, and date windows, one scan cycle can still issue a large burst of BC
Parks requests.

## Current Scan Shape

A Chrome alarm triggers a global scan cycle. The background worker scans Trips
sequentially, not in parallel:

```text
scan cycle
  Trip A
    park 1
      date window 1
      date window 2
    park 2
      date window 1
  Trip B
    park 1
    park 2
```

Inside one Trip, priority is based on user order:

- `trip.parks[0]` is the highest-priority park;
- `trip.dateRanges` are expanded and checked in order;
- the first available site stops that Trip's scan for the current cycle.

If a scan alarm fires while a previous cycle is still running, the background
worker already treats that as an in-progress scan and skips or queues the
request. That behavior should remain.

## Target Model

Use four separate concepts instead of relying on a fixed delay:

- **Interval**: how often the extension gets a scan opportunity.
- **Pacing**: minimum delay between any two BC Parks availability requests.
- **Budget**: maximum number of availability requests allowed in one scan cycle.
- **Cursor**: where scanning should resume if the previous cycle stopped before
  checking every Trip/park/date-window combination.

This changes scanning from "try to scan everything every cycle" to "process a
bounded queue continuously across cycles."

Example:

```text
interval: 2 minutes
request spacing: 2 seconds
max requests per cycle: 30
```

If a user has 200 possible availability checks, the extension does not issue all
200 requests in one cycle. It checks up to 30, then continues in later cycles.

## Client Settings vs Remote Policy

The user-facing interval can remain a client setting because it represents user
preference:

```text
Every 1 minute
Every 2 minutes (recommended)
Every 3 minutes
Every 5 minutes
```

The effective runtime behavior must be constrained by the server-provided remote
config. The extension should calculate:

```text
effectiveIntervalSeconds =
  clamp(userIntervalSeconds, scanPolicy.minIntervalSeconds, scanPolicy.maxIntervalSeconds)
```

If the server raises the minimum interval, older clients or clients with stored
short intervals should automatically run at the safer server-defined rate.

## Remote Config

The scanner policy should be returned by the existing
`POST /api/extension/config` endpoint. The server can load these values from the
database at startup or per request, depending on backend implementation needs.
The important requirement is that changing the backend config can adjust scanner
behavior without requiring users to update the extension.

Do not reuse the existing `ExtensionRemoteConfig.pollIntervalSeconds` for scan
intervals. That field currently controls how often the extension refreshes its
remote config. Keep that meaning, or rename it in a future cleanup.

The current implementation reads dynamic scanner and log-upload settings from
`extension_configs.extraConfig` on the server, normalizes them, and returns them
as top-level fields in `/api/extension/config`:

- `scanPolicy`
- `logSyncMinLevel`

This avoids a database migration while still allowing runtime changes from the
server.

Proposed additional field:

```ts
interface ExtensionRemoteConfig {
  // Existing fields...
  pollIntervalSeconds: number // remote config refresh interval
  logSyncMinLevel: 'debug' | 'info' | 'warning' | 'error'
  scanPolicy?: ExtensionScanPolicy
}

interface ExtensionScanPolicy {
  minIntervalSeconds: number
  maxIntervalSeconds: number
  defaultIntervalSeconds: number
  allowedIntervalSeconds: number[]

  requestSpacingMs: number
  maxRequestsPerCycle: number
  maxRequestsPerTripPerCycle: number

  backoff: {
    errorBaseSeconds: number
    rateLimitBaseSeconds: number
    maxSeconds: number
  }
}
```

Suggested initial backend values:

```json
{
  "logSyncMinLevel": "info",
  "scanPolicy": {
    "minIntervalSeconds": 60,
    "maxIntervalSeconds": 300,
    "defaultIntervalSeconds": 120,
    "allowedIntervalSeconds": [60, 120, 180, 300],
    "requestSpacingMs": 2000,
    "maxRequestsPerCycle": 30,
    "maxRequestsPerTripPerCycle": 8,
    "backoff": {
      "errorBaseSeconds": 300,
      "rateLimitBaseSeconds": 600,
      "maxSeconds": 1800
    }
  }
}
```

If BC Parks load or error rates become a concern, the backend can raise
`minIntervalSeconds`, `requestSpacingMs`, or lower request budgets immediately.
The backend can also change `logSyncMinLevel` to control which extension logs
are queued for server upload without exposing that control in the extension UI.

Example production override for reduced log volume:

```json
{
  "logSyncMinLevel": "warning",
  "scanPolicy": {
    "minIntervalSeconds": 120,
    "maxIntervalSeconds": 300,
    "defaultIntervalSeconds": 120,
    "allowedIntervalSeconds": [120, 180, 300],
    "requestSpacingMs": 3000,
    "maxRequestsPerCycle": 20,
    "maxRequestsPerTripPerCycle": 6,
    "backoff": {
      "errorBaseSeconds": 300,
      "rateLimitBaseSeconds": 900,
      "maxSeconds": 1800
    }
  }
}
```

When this config is saved on the server, existing extension clients pick it up
on the next extension-config refresh. The extension also re-schedules its scan
alarm when cached `extensionConfig` changes.

## Local Debug Logs

The Logs page is local-development-only UI. It is compiled in only when the
extension is built with:

```text
import.meta.env.MODE === 'development'
```

Use one of these commands from `app-extension/`:

```bash
npm run dev
npm run build:development
```

Then load or reload the generated unpacked extension in Chrome and open the
extension Options page. In a development build:

- the sidebar shows a `Logs` tab by default;
- debug scan logging is enabled automatically;
- there is no Settings toggle for Debug mode.

Production builds intentionally do not include the Logs tab, the Debug mode
setting, or the LogsPanel-specific CSS:

```bash
npm run build:production
```

Production background scanning does not have a user-controlled debug flag, so
local storage cannot re-enable debug scan logs in production.

## Request Pacing

Pacing must be global inside the extension background worker, not per Trip.

Correct:

```text
Trip A request 1
wait 2s
Trip A request 2
wait 2s
Trip B request 1
wait 2s
Trip B request 2
```

Incorrect:

```text
Trip A has its own 2s limiter
Trip B has its own 2s limiter
Trip C has its own 2s limiter
```

Per-Trip limiters would allow request rate to grow with Trip count, which is the
main issue this design is meant to prevent.

## Scan Budget

Each scan cycle should stop when either budget is reached:

- `maxRequestsPerCycle`
- `maxRequestsPerTripPerCycle`

When budget is exhausted:

- do not mark the Trip failed;
- do not clear scanning state;
- record a debug/info log such as `Scan budget exhausted; continuing next cycle`;
- continue from the saved cursor on a later cycle.

The per-Trip budget prevents one large Trip from starving every other Trip. The
global budget protects BC Parks from total request volume.

## Cursor

The scanner should eventually persist cursor state so it can continue where the
previous cycle stopped:

```ts
interface TripScanCursor {
  tripId: string
  parkIndex: number
  dateRangeIndex: number
  windowIndex: number
  updatedAt: string
}
```

The cursor should advance after each attempted availability request. When the
scanner reaches the end of a Trip, wrap the cursor back to the first eligible
combination for that Trip.

Cursor persistence can be stored locally first. Server persistence can be added
later if cross-device continuity becomes important.

## Backoff

The extension should enter temporary backoff when BC Parks responses suggest
service pressure, rate limiting, or repeated transient failures.

Initial behavior:

- ordinary network/API error: pause BC Parks availability checks for
  `backoff.errorBaseSeconds`;
- rate limit or overrun-like response: pause for
  `backoff.rateLimitBaseSeconds`;
- repeated failures increase the delay up to `backoff.maxSeconds`.

Backoff should apply before starting new availability requests. It should not
cancel a successful match flow that is already reserving or paying.

## Recommended Implementation Phases

Phase 1: safer interval options.

- Replace `10s` and `30s` settings options with `60s`, `120s`, `180s`, `300s`.
- Default new installs to `120s`.
- Keep old stored values but clamp them through remote policy before scheduling
  alarms.

Phase 2: remote scan policy.

- Add `scanPolicy` to the backend extension config response.
- Normalize and cache `scanPolicy` in `app-extension/src/extensionConfig.ts`.
- Use remote policy to render allowed interval options and calculate effective
  alarm interval.

Phase 3: global request limiter and budgets.

- Remove the fixed `DATE_WINDOW_DELAY_MS = 300` strategy.
- Route all BC Parks availability checks through a global limiter.
- Enforce `requestSpacingMs`, `maxRequestsPerCycle`, and
  `maxRequestsPerTripPerCycle`.

Phase 4: cursor continuation.

- Persist per-Trip cursor state.
- Stop scanning when budget is exhausted and resume from the cursor on the next
  cycle.

Phase 5: backoff.

- Detect rate-limit/overrun-like responses and repeated transient failures.
- Apply server-configured backoff before issuing more availability checks.

## Product Defaults

Recommended user-facing default:

```text
Every 2 minutes
```

Recommended options:

```text
Every 1 minute
Every 2 minutes (recommended)
Every 3 minutes
Every 5 minutes
```

One minute is useful for urgent Trips, but it should not be the default because
request volume can grow quickly with multiple Trips, parks, and date windows.
Two minutes gives users a competitive scan cadence while leaving room for
request pacing and per-cycle budgets.
