# campsite-booking

Scans BC Parks for campsite cancellations and auto-books the moment one opens up.

## How it works

BC Parks campsites sell out instantly. This tool polls for cancellations on a configurable interval, applies your filters (no walk-in, no double sites), and books the first match — notifying you via terminal, desktop popup, and email.

## Features

- Chrome extension trip manager for creating, starting, pausing, and monitoring campsite scans.
- Passwordless CampOsprey sign-in is required before a trip can start, so usage can be tracked, booking emails can be connected to the right account, and blocked accounts can be prevented from scanning.
- Email-code registration and login:
  - New users enter a valid email and name, then verify with a 6-digit email code.
  - Returning users enter their email and code without needing a password.
  - The extension remembers the last login email locally to prefill the next sign-in attempt.
- Sign-in UI appears in the popup and options page with a short explanation of why login is needed, plus a reminder to check Spam, Junk, or Trash for the code.
- Signed-in users receive personalized emails, including greetings such as `Hi Eric`.
- Background scan cycles validate the server session before scanning, so expired, signed-out, or blocked users cannot continue running trips.
- Server extension-auth API supports requesting and verifying email codes, returning bearer tokens for extension API calls.
- Server booking result emails include the signed-in user's name when available.

## Setup

**1. Install**

```bash
cd python
python -m venv .venv
source .venv/bin/activate   # or: .venv/bin/activate.fish
pip install -e ".[dev]"
playwright install chromium
```

**2. Configure secrets**

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env   # then edit .env
```

```
BCPARKS_PASSWORD=your_bc_parks_password
CARD_NUMBER=4111111111111111
CARD_EXPIRY=12/28
CARD_CVV=123
EMAIL_PASSWORD=your_gmail_app_password
```

> Gmail requires an [App Password](https://myaccount.google.com/apppasswords) (not your regular password). Enable 2-Step Verification first.

Load secrets automatically on `cd` with direnv:

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc  # or hook fish
direnv allow .
```

**3. Create your config**

```bash
cp config.yaml.example config.yaml
```

Edit `config.yaml` — find your park IDs first:

```bash
campsite parks --search "alice"
# → -2147483647   Alice Lake   Alice Lake Provincial Park

campsite parks --search "garibaldi"
# → -2147483609   Garibaldi    Garibaldi Provincial Park
```

## Commands

### `campsite parks` — find park IDs

```bash
campsite parks --search "cultus"
campsite parks                         # list all 145 BC Parks campgrounds
campsite parks --output parks.json     # save to file
```

### `campsite config check` — validate your config

```bash
campsite config check --file config.yaml
# → Config is valid.
```

### `campsite check` — one-shot availability scan

Checks availability for all your campgrounds and dates. Does not book anything.

```bash
campsite check --file config.yaml
```

Example output:

```
→ Initializing cart session...
→ Fetching campground list...
→ Fetching site list for -2147483647...
→ Checking availability: Alice Lake | 2026-07-05 → 2026-07-06
  4 site(s) available

────────────────────────────────────────────────────────────
  4 site(s) available
────────────────────────────────────────────────────────────
  Alice Lake  │  B (Sites 56-96)  │  67  │  2026-07-05 → 2026-07-06 (1 night)
  Alice Lake  │  B (Sites 56-96)  │  71  │  2026-07-05 → 2026-07-06 (1 night)
  Alice Lake  │  B (Sites 56-96)  │  91  │  2026-07-05 → 2026-07-06 (1 night)
  Alice Lake  │  B (Sites 56-96)  │  95  │  2026-07-05 → 2026-07-06 (1 night)
────────────────────────────────────────────────────────────
```

### `campsite scan` — continuous polling loop

Polls every `poll_interval_seconds` until a site is booked (or Ctrl+C).
Set `auto_book: true` in config to book automatically.

```bash
campsite scan --file config.yaml
```

### `campsite discover` — record BC Parks API for a new campground

Run this once when setting up a new campground. Opens a real browser and records
the API calls and booking flow from your session.

```bash
campsite discover             # both phases
campsite discover --phase 1   # API recording only
campsite discover --phase 2   # booking flow recording only
```

## Config reference

```yaml
poll_interval_seconds: 60       # how often to check

campgrounds:
  - name: "Alice Lake"
    park_id: "-2147483647"      # from: campsite parks --search "alice"
    priority: 1                 # lower = checked first
  - name: "Cultus Lake"
    park_id: "-2147483623"
    priority: 2

dates:
  - "2026/07/05"                # single night (Jul 5 → 6)
  - "2026/07/05-07"             # range within month (Jul 5 → 7)
  - "2026/06/20-2026/06/23"     # full date range
  - "2026/07/FRI"               # all Fridays in July (one-night each)
  - "2026/07/FRIDAY-SUNDAY"     # all Fri→Sun spans in July

filters:
  no_walkin: true               # exclude walk-in / first-come sites
  no_double: true               # exclude sites that must be booked as a pair

credentials:
  bcparks_email: "you@example.com"
  bcparks_password: "${BCPARKS_PASSWORD}"
  party_size: 2
  vehicle_plate: "ABC 1234"

payment:
  card_number: "${CARD_NUMBER}"
  card_expiry: "${CARD_EXPIRY}"        # MM/YY
  card_cvv: "${CARD_CVV}"
  name_on_card: "Your Name"

notifications:
  terminal: true
  desktop: true                 # macOS only
  email:
    enabled: true
    smtp_host: "smtp.gmail.com"
    smtp_port: 587
    sender: "you@example.com"
    recipient: "you@example.com"
    password: "${EMAIL_PASSWORD}"

auto_book: false                # set true to book automatically when found
```

## How availability works

- `campsite check` / `campsite scan` call the BC Parks internal API directly
- Walk-in sites are detected by section name ("Walk-In") and site description
- Double sites are detected from the description ("must be booked as double site")
- Sites with `availability=0` in the daily availability API are genuinely free
- The booking step (Tasks 10–12) requires running `campsite discover` first
