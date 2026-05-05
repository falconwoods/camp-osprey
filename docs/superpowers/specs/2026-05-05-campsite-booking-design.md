# Campsite Booking Scanner — Design Spec

**Date:** 2026-05-05  
**Status:** Approved

## Overview

A Python CLI that continuously polls the BC Parks camping website for campsite cancellations, then automatically books a site the moment one becomes available. The user configures a priority-ordered list of campgrounds and dates; the tool does the rest — scanning, booking, and notifying across multiple channels.

## Problem

BC Parks campsites sell out immediately during summer. Cancellations happen frequently but are snapped up within minutes. Manual checking is impractical; this tool automates the watch-and-grab loop.

## Architecture

```
config.yaml
    │
    ▼
┌─────────────┐     httpx      ┌──────────────────┐
│   Scanner   │ ─────────────► │  BC Parks API    │
│  (polling)  │ ◄───────────── │  (internal REST) │
└──────┬──────┘                └──────────────────┘
       │ match found
       ▼
┌─────────────┐   Playwright   ┌──────────────────┐
│   Booker    │ ─────────────► │ camping.bcparks  │
│             │ ◄───────────── │   .ca (browser)  │
└──────┬──────┘                └──────────────────┘
       │ result
       ▼
┌─────────────┐
│  Notifier   │ ──► terminal + desktop popup + email
└─────────────┘
```

**Hybrid approach:** `httpx` handles all availability polling (fast, lightweight). Playwright is only launched when a match is found and booking must happen. This keeps polling cheap and booking reliable.

## File Structure

```
campsite/
  cli.py          # Click entry point — all CLI commands
  config.py       # Pydantic v2 config loader + env var resolution
  models.py       # DateRange, SiteFilter, Campground, BookingResult
  scanner.py      # httpx polling loop + priority iteration
  booker.py       # Playwright booking flow
  notifier.py     # terminal / desktop / email dispatch
  api.py          # BC Parks API client (httpx)
docs/
  api-notes.md    # discovered API endpoints (populated by campsite discover)
  booking-flow.py # auto-generated Playwright script from discover session
```

**Stack:** Python 3.11+, Click, Pydantic v2, httpx, Playwright, pytest

## Configuration (`config.yaml`)

```yaml
poll_interval_seconds: 60

campgrounds:
  - name: "Garibaldi Lake"
    park_id: 1234          # discovered via campsite discover
    priority: 1
  - name: "Cultus Lake"
    park_id: 5678
    priority: 2

dates:
  - "2026/06/20-2026/06/23"       # specific range: one stay
  - "2026/07/FRIDAY-SUNDAY"        # all Fri→Sun spans in July
  - "2026/07/FRI"                  # all Fridays in July (one-night Fri→Sat)
  - "2026/07/05"                   # single specific night (Jul 5→6)
  - "2026/07/05-07"                # shorthand range within same month

filters:
  no_walkin: true
  no_double: true

credentials:
  bcparks_email: "you@example.com"
  bcparks_password: "${BCPARKS_PASSWORD}"
  party_size: 4
  vehicle_plate: "ABC 1234"

payment:
  card_number: "${CARD_NUMBER}"
  card_expiry: "${CARD_EXPIRY}"
  card_cvv: "${CARD_CVV}"
  name_on_card: "Eric Wang"

notifications:
  terminal: true
  desktop: true
  email:
    enabled: true
    smtp_host: "smtp.gmail.com"
    smtp_port: 587
    from: "you@example.com"
    to: "you@example.com"
    password: "${EMAIL_PASSWORD}"

auto_book: true
```

Sensitive values use `${VAR_NAME}` syntax and are resolved from environment variables at runtime. The config file itself is safe to version-control.

When `auto_book: false`, the scanner notifies on match but does not launch the Booker — useful for monitoring without committing to automated payment.

## Date Expression Parser (`models.py`)

Turns human-friendly date expressions into concrete `(check_in, check_out)` date pairs using only the Python `datetime` stdlib.

| Expression | Meaning | Expands To |
|---|---|---|
| `2026/06/20-2026/06/23` | Specific range | One stay: Jun 20–23 |
| `2026/07/FRIDAY-SUNDAY` | All Fri→Sun spans in July | ~4 stays |
| `2026/07/FRI` | All Fridays in July (one-night) | ~4 stays of Fri→Sat |
| `2026/07/05` | Single specific night | One stay: Jul 5–6 |
| `2026/07/05-07` | Shorthand range same month | One stay: Jul 5–7 |

Day names are case-insensitive and support both full (`FRIDAY`) and abbreviated (`FRI`) forms.

## Priority Ordering

Campground is the outer priority, date is the inner priority:

```
Check campground #1, date #1 → available + passes filters? → book, done
Check campground #1, date #2 → available + passes filters? → book, done
...
Check campground #2, date #1 → available + passes filters? → book, done
...
```

When multiple slots are available simultaneously, the highest-priority `(campground, date)` pair wins. Once a booking succeeds, scanning stops.

## Scanner (`scanner.py`)

Runs a polling loop on `poll_interval_seconds`. Each cycle:

1. Expands all date expressions into concrete pairs
2. Iterates campground × date in priority order
3. Calls `api.py` (httpx) — applies `no_walkin` and `no_double` filters
4. On first match: hands off to Booker
5. Deduplicates: skips `(campground, check_in, check_out)` tuples already attempted for booking this session

## API Client (`api.py`)

Wraps the BC Parks internal REST API discovered via `campsite discover`. Endpoint URLs, required headers, and response schemas are documented in `docs/api-notes.md` (populated at discovery time). Raises a structured `APIError` on unexpected responses so the scanner can distinguish transient failures from permanent ones.

## Booker (`booker.py`)

Triggered only when Scanner finds a match:

1. Launches Playwright (non-headless — visible browser)
2. Logs in with BC Parks credentials
3. Navigates to the matched site + dates
4. Fills party info, vehicle plate, contact details from config
5. Enters payment details from env vars
6. Submits and waits for confirmation page
7. **On failure** (site taken mid-flow): signals Scanner to try next campground in priority order
8. **On success**: returns confirmation details to Notifier, scanning stops

## Discovery Command (`campsite discover`)

Run once before anything else. Opens a visible Playwright browser, intercepts all network traffic, and records the user's manual session:

- **Network recording** → `docs/api-notes.md` (API endpoints, headers, request/response schemas)
- **Interaction recording** → `docs/booking-flow.py` (Playwright script auto-generated from clicks and form fills)

Re-run if the BC Parks site changes its API or checkout flow.

## CLI Commands

```
campsite discover       # record API + booking flow (run once to set up)
campsite scan           # start polling loop (runs until booked or Ctrl+C)
campsite check          # one-shot availability check, no booking
campsite config check   # validate config.yaml without running
```

## Notifications (`notifier.py`)

Fires on three events: **match found**, **booking succeeded**, **booking failed**. All enabled channels fire simultaneously:

- **Terminal**: coloured stdout with site name, dates, status
- **Desktop**: macOS `osascript` notification popup (no extra dependency; macOS only)
- **Email**: SMTP with booking confirmation details in body

## Error Handling

| Scenario | Behaviour |
|---|---|
| BC Parks API returns error | Log, skip cycle, retry next poll |
| Site taken mid-booking | Try next campground in priority order |
| Payment fails | Notify user, pause scanning, wait for intervention |
| Config invalid | Fail fast at startup with clear error message |
| Network timeout | Retry with exponential backoff, log warning |

## Testing

- **Unit tests**: date parser (all expression formats), config loader (env var resolution, validation errors), filter logic
- **Integration tests**: scanner loop with a mocked API client, booker flow with Playwright in headed mode against a test fixture
- `campsite check` serves as a manual smoke test against the live site
