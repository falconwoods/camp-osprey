# CampSniper Chrome Extension — Design Spec

_Date: 2026-05-06_

## Overview

A Chrome extension that scans BC Parks for campsite cancellations and automatically reserves or pays for a site when one is found. Users configure independent "Trips" — each with its own parks, dates, filters, and action mode. The extension runs silently in the background using the user's existing BC Parks browser session.

---

## Goals

- Scan BC Parks availability across multiple parks and date ranges
- Notify, auto-reserve, or auto-pay when a site is found
- Support multiple independent trips running simultaneously
- Be publishable on the Chrome Web Store
- Each user runs on their own IP (no shared backend required)
- Designed so a cloud backend and points-based monetization can be added later without a rewrite

**Out of scope for now:** other booking providers, backend/cloud scanning, monetization

---

## Architecture

### Tech Stack

- **Language:** TypeScript
- **Bundler:** Vite with `vite-plugin-chrome-extension` or CRXJS
- **Manifest:** V3
- **Tests:** Vitest (unit), Playwright (E2E against the built extension)

### Components

| Component | File(s) | What it does |
|---|---|---|
| Service worker | `src/background/index.ts` | Polling via `chrome.alarms`, BC Parks API calls, notifications |
| Popup | `src/popup/` | Trip list with status, start/stop per trip, link to Options |
| Options page | `src/options/` | Trip editor — parks, dates, filters, mode, payment config |
| Content script | `src/content/bcparks.ts` | Injected into `camping.bcparks.ca` to drive checkout for Auto-pay |
| BC Parks provider | `src/providers/bcparks.ts` | All BC Parks API logic (named as a provider for future extensibility) |
| Storage | `src/storage.ts` | Typed wrappers around `chrome.storage.local` |

### Key Design Principle: Session Sharing

The service worker's `fetch()` calls share Chrome's cookie jar automatically. The user's existing BC Parks session (`prime-session`, `XSRF-TOKEN`, `isLoggedIn` cookies) is used without storing any credentials. This eliminates the session transfer problem that exists in the Python CLI.

---

## Trips Model

A **Trip** is the core data entity — an independent scanning goal with its own configuration and lifecycle.

```typescript
interface Trip {
  id: string
  name: string
  parks: Park[]          // priority ordered — index 0 = highest priority
  dateRanges: DateRange[]
  filters: {
    noWalkin: boolean
    noDouble: boolean
  }
  mode: "notify" | "hold" | "autopay"
  status: "idle" | "scanning" | "paused" | "completed"
  lastMatch: MatchedSite | null  // set when a site is found (all modes); shown in popup
  attempted: string[]    // "parkId|checkIn|checkOut" dedup keys
  createdAt: number
}

interface MatchedSite {
  parkName: string
  siteName: string
  checkIn: string
  checkOut: string
  bookingUrl: string
}

interface Park {
  id: string             // BC Parks resourceLocationId
  name: string           // display name
}

interface DateRange {
  type: "specific" | "recurring"
  // specific:
  checkIn?: string       // ISO date
  checkOut?: string      // ISO date
  // recurring:
  year?: number
  month?: number         // 1-12
  startDay?: number      // 0=Mon … 6=Sun
  endDay?: number
}
```

Multiple trips run simultaneously and stop independently when their goal is fulfilled.

---

## Storage Schema

All state lives in `chrome.storage.local` (Chrome encrypts this on disk).

```typescript
{
  trips: Trip[]
  payment: {             // shared across all auto-pay trips
    cardNumber: string
    cardHolder: string
    cardExpiry: string   // "MM/YY"
    cardCvv: string
    partySize: number
  } | null
  settings: {
    pollIntervalSeconds: 30 | 60 | 120
  }
}
```

---

## UX: Popup

The popup (320px wide, opens on extension icon click) shows the trip list at a glance:

- Each trip shows: name, status badge (Scanning / Match! / Paused / Completed), brief summary (parks + dates), and a Start/Stop/Resume button
- When status is **Match!**: a "Reserve Now →" button appears (for Notify mode, links to BC Parks; for Hold, opens checkout tab)
- A **"+ New Trip"** button at the bottom opens the Options page pre-focused on the new trip form
- A **"Settings ›"** link opens the Options page for payment config

**Login warning:** If mode is Hold or Auto-pay and `isLoggedIn` cookie is absent, the trip card shows: *"Log in to BC Parks to use this mode"* with an "Open BC Parks →" link. The trip downgrades to Notify-only silently and restores automatically when login is detected via `chrome.cookies.onChanged`.

---

## UX: Options Page

Opens in a full browser tab. Two sections:

### Trip Editor
- Trip name (editable text field)
- **Parks:** drag-to-reorder list with live search by name (queries `/api/resourceLocation`, filtered client-side). Add/remove parks.
- **Date Ranges:** list of added ranges with remove buttons. "Add Date Range" opens an inline form:
  - Simple mode: check-in / check-out date pickers
  - Recurring mode: dropdowns — *"Every [Friday ▾] to [Sunday ▾] in [July ▾] [2026 ▾]"* with a plain-English preview below
- **On Match:** dropdown — Notify only / Auto-reserve / Auto-pay
- **Filters:** No walk-in checkbox, No double site checkbox
- **Start Scanning / Stop** button

### Payment Settings (global)
- Card number, cardholder name, expiry, CVV
- Party size
- Only shown/required when any trip uses Auto-pay mode

---

## Core Scanning Flow

```
chrome.alarms fires (every 30–120s, configurable)
  ↓
For each trip where status === "scanning":
  Check isLoggedIn cookie
  For each park in priority order:
    For each expanded date range:
      Skip if already in trip.attempted
      GET /api/cart            → initialize session, get XSRF token (cached)
      GET /api/resourcelocation/resources  → site list (cached per park)
      GET /api/maps            → walk-in/double section data (cached per park)
      GET /api/availability/resourcedailyavailability  → per site, ≤10 parallel
      Apply filters (no walk-in, no double)
      → Match found: execute on-match action for this trip
      → No match: continue to next park/date
```

**One action per trip per cycle** — when mode is Hold or Auto-pay, only the single highest-priority match is acted on per alarm cycle to avoid burst cart commits.

**Deduplication** — sites already attempted are stored in `trip.attempted` and skipped in subsequent cycles.

**Caching** — park site lists and section maps are cached in service worker memory. Cache is cold on wake-up (MV3 workers can be suspended) — first cycle after suspension re-fetches automatically.

---

## On-Match Actions

### Notify
1. `chrome.notifications.create()` with site name, park, dates, and a direct booking URL
2. Trip `lastMatch` is set — popup shows a "Reserve Now →" link to BC Parks
3. Trip status stays `"scanning"` — continues looking for more options

### Auto-reserve (Hold)
1. `POST /api/cart/commit` ×2 to hold site for 15 minutes (same flow as Python CLI)
2. `chrome.notifications.create()` — "Site held! Complete payment in BC Parks"
3. Opens a new tab to `https://camping.bcparks.ca/create-booking/reservationmessages`
4. Trip status → `"found"`, scanning pauses
5. If hold fails with `ResourceUnavailable`: mark attempted, continue scanning

### Auto-pay
1. Hold site (same as above)
2. Open checkout tab — content script takes over:
   - Step 5 (surcharges): click Continue
   - Step 6 (occupant details): fill party size, click Continue
   - Step 7 (payment): fill `#cardNumber`, `#cardHolderName`, `#cardExpiry`, `#cardCvv`, click `#applyPaymentButton`
3. Content script sends confirmation number back to service worker via `chrome.runtime.sendMessage`
4. Notification: "Booking confirmed — [confirmation number]"
5. Trip status → `"completed"`, scanning stops

---

## Login State Handling

| State | Notify | Hold | Auto-pay |
|---|---|---|---|
| Logged in | ✅ Full | ✅ Full | ✅ Full |
| Not logged in | ✅ Availability still public | ⚠ Downgrades to Notify | ⚠ Downgrades to Notify |
| Cookie expires mid-scan | ✅ Continues | ⚠ Pauses, notifies user | ⚠ Pauses, notifies user |

Detection via `chrome.cookies.get({ url: "https://camping.bcparks.ca", name: "isLoggedIn" })` before each alarm cycle. Auto-recovery via `chrome.cookies.onChanged` — when `isLoggedIn` cookie appears, full mode is restored without user action in the extension.

---

## Provider Pattern

All BC Parks API logic lives in `src/providers/bcparks.ts` as a `BCParksProvider` class. The service worker imports only the provider interface. This naming convention (not abstraction overhead) makes adding a second provider (e.g. ReserveAmerica) a clean addition rather than a retrofit.

---

## Error Handling

| Error | Behaviour |
|---|---|
| API 429 / rate limit | Exponential backoff, skip this cycle |
| API 5xx | Skip this cycle, log to `chrome.storage` for debugging |
| Cart commit `ResourceUnavailable` | Mark site as attempted, continue scanning |
| Cart commit other error | Notify user, pause trip |
| Content script payment failure | Notify user with error, leave checkout tab open for manual recovery |
| Chrome minimized / display sleep | Service worker and alarms continue unaffected |

---

## Testing

- **Unit (Vitest):** Provider API logic, date range expansion, filter logic, storage schema validation
- **E2E (Playwright):** Load built extension in Chromium, mock BC Parks API responses, verify popup renders trips, verify scanning starts/stops correctly
- **Manual:** Full auto-pay flow against a real low-cost booking

---

## Future Considerations

- **Cloud backend:** Add optional server-side scanning (for when Chrome is closed) as a premium feature. Extension design supports this — the service worker polling loop can be replaced by a WebSocket listener without changing the rest of the extension.
- **Points system:** Gate Auto-reserve / Auto-pay behind a points balance. Backend validates points before allowing the action.
- **Multiple providers:** Add `src/providers/reserveamerica.ts` implementing the same provider interface.
