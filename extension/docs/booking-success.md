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

## Extension Detection

The extension should treat a booking as paid only after detecting the BC Parks confirmation page, not just after clicking the payment button.

Current reliable checks:

1. URL contains `/create-booking/confirmation/`.
2. DOM contains `app-checkout-confirmation`.
3. `#pageTitle` or `h1` text is exactly `Success!`.
4. `#confirmationMessage_*` text includes `successfully made a reservation`.
5. `.success-reference-number` or `#referenceNumber_*` contains `Reservation Number:`.

The confirmation number is parsed from the reservation-number element.

## Notes

The previous broad selector `[class*="reference-number"]` happened to match the recorded page because BC Parks renders `.success-reference-number`, but it was not specific enough to prove the user reached the paid booking confirmation page.
