# BC Parks Booking Success Detection

Captured from a live Playwright-assisted checkout recording saved under:

```text
dump/bcparks-checkout-recordings/2026-06-05T02-50-57-036Z/
```

The recording script saved sanitized DOM snapshots and network metadata. The final snapshot was:

```text
dom-snapshots/038-manual-finish.html
```

## Success Route

After `POST /api/payment` returned `200`, BC Parks navigated to:

```text
/create-booking/confirmation/<cartUid>/<cartTransactionUid>
```

The page title changed from `Payment` to:

```text
Success!
```

## Reliable DOM Signals

The final success page used this structure:

```html
<app-checkout-confirmation>
  <h1 id="pageTitle">Success!</h1>
  <div id="confirmationMessage_1">
    You have successfully made a reservation ...
  </div>
  <div class="success-reference" id="referenceNumber_1">
    <p class="success-reference-number">
      Reservation Number: ...
    </p>
  </div>
</app-checkout-confirmation>
```

Other observed success-page controls:

```text
#viewThisReservation_1
#printConfirmationLetter_1
button text: View payment receipt
#reserveAgainButton_1
```

## Network Signals

The relevant network sequence was:

```text
POST /api/payment                                -> 200
GET  /assets/locales/checkout-confirmation.component.en-CA.json -> 200
GET  /api/booking/confirmationpage?cartUid=...&bookingUid=...    -> 200
```

The confirmation API response included a `bookingNumber`.

Google Analytics also emitted purchase/create-confirmation events, but those should not be used as app logic.

## Failed Payment Signals

Captured failed-payment recording:

```text
dump/bcparks-checkout-recordings/fail/2026-06-05T03-27-55-401Z/
```

Final snapshot:

```text
dom-snapshots/036-manual-finish.html
```

The failed-payment flow stayed on:

```text
/create-booking/payment/create-booking%252Fconfirmation
```

The page title remained:

```text
Payment
```

The payment API returned:

```text
POST /api/payment -> 400
{"messageKey":"PAYMENTFAILED","messageLocales":{}}
```

The final DOM contained:

```html
<app-payment>
  <h1 id="pageTitle">Payment</h1>
  <div role="alert" aria-live="assertive" class="alert-box error-box">
    <div class="alert-box-title">Payment was unsuccessful</div>
    <div>The payment was unsuccessful. Please try again.</div>
  </div>
</app-payment>
```

## Extension Detection

The extension should treat a booking as paid only after detecting the BC Parks confirmation page, not just after clicking the payment button.

Current reliable checks:

1. URL contains `/create-booking/confirmation/`.
2. DOM contains `app-checkout-confirmation`.
3. `#pageTitle` or `h1` text is exactly `Success!`.
4. `#confirmationMessage_*` text includes `successfully made a reservation`.
5. `.success-reference-number` or `#referenceNumber_*` contains `Reservation Number:`.

The confirmation number is parsed from the reservation-number element.

The extension should treat a booking as failed only after detecting the recorded payment failure page:

1. URL contains `/create-booking/payment/`.
2. DOM contains `app-payment`.
3. `#pageTitle` or `h1` text is exactly `Payment`.
4. A `role="alert"` / `.alert-box.error-box` element contains `Payment was unsuccessful`.
5. The same alert contains `Please try again`.

## Local Debug Harness

Use the fake success harness to test this flow without paying BC Parks:

```bash
cd extension
npm run build:development
npm run debug:booking-success
```

For CI-style verification that closes Chromium after success:

```bash
cd extension
npm run build:development
npm run debug:booking-success -- --once
```

The harness:

1. Loads the built Chrome extension from `extension/dist`.
2. Seeds `chrome.storage.local` with a fake autopay trip and `campOspreyTarget`.
3. Intercepts `https://camping.bcparks.ca/create-booking/confirmation/fake-cart/fake-transaction`.
4. Serves `extension/fixtures/bcparks/booking-success.html`.
5. Waits for the real content script/background flow to mark the trip `paid`.

Expected `--once` result:

```json
{
  "tripStatus": "paid",
  "targetExists": false,
  "paidLog": {
    "event": "booking_paid",
    "status": "paid",
    "confirmationNumber": "BCIN123456B1"
  }
}
```

Use the fake failure harness to test the declined/failed payment path:

```bash
cd extension
npm run build:development
npm run debug:booking-fail
```

For CI-style verification:

```bash
cd extension
npm run build:development
npm run debug:booking-fail -- --once
```

Expected `--once` result:

```json
{
  "tripStatus": "failed",
  "targetExists": false,
  "failedLog": {
    "event": "booking_failed",
    "status": "failed",
    "error": "Payment was unsuccessful The payment was unsuccessful. Please try again."
  },
  "paidLog": null
}
```

## Notes

The previous broad selector `[class*="reference-number"]` happened to match the recorded page because BC Parks renders `.success-reference-number`, but it was not specific enough to prove the user reached the paid booking confirmation page.
