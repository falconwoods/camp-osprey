# Site Automation Notes

Lessons learned automating specific websites. Useful for debugging, writing content scripts, and Playwright scripts.

---

## camping.bcparks.ca

### Angular SPA — content script navigation

BC Parks uses Angular with client-side routing (`pushState`). Clicking Reserve navigates from `/results` to `/reservationmessages` **without a page reload**. Content scripts injected at `document_idle` are NOT re-injected on SPA route changes.

**Fix:** poll for URL changes inside the content script and re-dispatch when the URL changes:
```typescript
let lastUrl = window.location.href
const watcher = setInterval(() => {
  const url = window.location.href
  if (url === lastUrl) return
  lastUrl = url
  dispatchForUrl(target, url)  // re-run handler for new route
}, 300)
setTimeout(() => clearInterval(watcher), 15 * 60 * 1000)
```

---

### Angular Material — clicking elements

BC Parks is an Angular app using Angular Material components. Native DOM `.click()` on form controls often bypasses Angular's event binding and has no effect.

**Rule: always click the `<label>`, not the `<input>`.**

This applies to:
- `mat-checkbox` — click `label[for="${input.id}"]`, not the `<input type="checkbox">`
- `mat-radio-button` — click the inner `<label>`, not the `<mat-radio-button>` or `<input type="radio">`

Example:
```typescript
// Wrong — Angular ignores this
checkbox.click()

// Correct — triggers Angular change detection
const label = checkbox.id
  ? document.querySelector(`label[for="${checkbox.id}"]`)
  : checkbox.closest('label')
;(label ?? checkbox).click()
```

Confirmed by Playwright: `label.click()` sets `input.checked = true` and enables dependent buttons. Direct `input.click()` does not.

---

### Filter dialog structure

The Filters dialog (opened by `#filters-button-desktop`) uses `<app-single-selection-filter>` components, one per filter group. Each has:
- An `<h3>` heading identifying the group (e.g. "Walk In", "Double Site", "Electrical Service")
- A `<mat-radio-group>` with three `<mat-radio-button>` children: No Preference / Yes / No

**Do not** use `[class*="filter-option"]` with index-based selection — `<p class="filter-option">` elements for Electrical Service checkboxes are mixed in, and the count varies by park.

**Correct approach:** find the `<app-single-selection-filter>` whose `<h3>` text contains the keyword, then find the `<mat-radio-button>` with text "No" inside it:
```typescript
const groups = document.querySelectorAll('app-single-selection-filter')
for (const group of groups) {
  const h3 = group.querySelector('h3')
  if (!h3?.textContent?.toLowerCase().includes('walk')) continue
  const noRadio = Array.from(group.querySelectorAll('mat-radio-button'))
    .find(r => r.textContent?.trim().toLowerCase() === 'no')
  noRadio?.querySelector('label')?.click()
}
```

---

### Availability API fields

`GET /api/availability/resourcedailyavailability` returns an array of daily entries:
```json
{ "availability": 0, "processedAvailability": 0, "remainingQuota": null }
```

- **`availability`** — whether the slot is unoccupied (`0` = unbooked, `1` = booked). Does NOT indicate reservability.
- **`processedAvailability`** — the true bookability status:
  - `0` = Available (green on map) — genuinely reservable
  - `1` = Occupied (red)
  - `3` = Restrictions (yellow) — unoccupied but not reservable (seasonal closure, permit required, etc.)

**Always check `processedAvailability === 0`**, not `availability === 0`. Using `availability` alone returns restricted/yellow sites as false positives.

---

### `definedAttributes` field

`GET /api/resourcelocation/resources` returns site resources with a `definedAttributes` array. Attribute IDs:
- `-32764` — Walk-in
- `-32722` — Double Site

`values[0] === 1` appears on **normal, reservable campground sites** for both IDs — the encoding is not a simple Yes/No flag. Do not use `definedAttributes` to filter walk-in or double sites.

**Correct approach:**
- Walk-in: use section membership from `/api/maps` (section title contains "walk") + description keywords ("first-come", "first come")
- Double: use description keywords ("double site") + `linkedResources.length > 0`

---

### List view — Details button before Reserve

BC Parks list view uses a two-step expand:
1. Click `mat-expansion-panel-header` → panel expands showing a "Details" button
2. Click "Details" → Reserve button appears (may be in a sidebar outside the panel element)

After clicking "Details", use `document.querySelector('button.reserve-button')` at the document level, not `panel.querySelector(...)`.

---

### "Not reservable" vs "Not available" errors

After clicking Reserve, two distinct inline error messages can appear:
- `"X is not available for any of the requested dates"` — site was booked between scan and click (race condition)
- `"X is not reservable. Select a reservable location to continue."` — site has restrictions, can't be reserved regardless

Both should be detected and treated the same way: skip the panel and continue to the next site.

---

### Checkout wizard — confirmed step sequence and button text

After "Confirm reservation details", the checkout wizard navigates through these steps, each on a new page. Detect the current step by looking for its unique button text:

| Step | Button to click |
|---|---|
| Surcharges (reservationmessages) | `"Proceed to checkout"` |
| Acknowledgements | Check all `input[type="checkbox"]` via label, then `"Confirm acknowledgements"` |
| Account details | `"Confirm account details"` |
| Occupant | `"Confirm occupant"` |
| Party information | `"Confirm party information"` |
| Additional information | `"Confirm additional information"` |
| Add-ons | `"Skip add ons"` |
| Payment | Fill fields, then `"Apply credit card payment,"` |

The extension does not require or store a party size for Auto-pay. It advances through the party information step using the booking flow defaults; users can adjust or pay for extra people on site when applicable.

Payment form field selectors (confirmed from live DOM inspection — fields use `id`, NOT `aria-label`):
- Card number: `#cardNumber`
- Name on card: `#cardHolderName`
- Expiry: `#cardExpiry` (placeholder "MM/YY")
- CVV: `#cardCvv`
- Street address: `#street-field-0`
- Postal/zip: `#postal-code-field-0`
- Unit (optional): `#unit-field-0`
- City (optional): `#city-field-0`

Playwright's `get_by_role("textbox", name="Card #")` finds these via their `<label for="...">` elements, but CSS `[aria-label="Card #"]` returns nothing — the inputs have no `aria-label` attribute.

---

### URL routing for content script

- Results page: `/create-booking/results`
- Reservation review: URL contains `reservationmessages`
- All checkout steps: any `/create-booking/` URL that is not `results` or `reservationmessages`

Use a broad catch for checkout: `url.includes('/create-booking/') && !url.includes('/results') && !url.includes('reservationmessages')`
