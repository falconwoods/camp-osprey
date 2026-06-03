# CampOsprey Payments And Points Design

**Date:** 2026-06-03
**Status:** Approved

## Overview

CampOsprey will integrate Stripe so signed-in users can buy point packages. Points are stored and accounted for by the server. The extension can display balances, start checkout, and report successful campsite payments, but it never decides whether points are credited or deducted.

The first version uses Stripe Checkout with point packages defined in server configuration, not database-managed products. Postgres stores the user balance, Stripe checkout/payment history, point ledger entries, booking payment events, and point charge records.

## Goals

- Let users buy predefined point packages through Stripe Checkout.
- Credit points only after Stripe confirms successful payment.
- Deduct points only after the extension confirms a campsite was actually paid/booked.
- Keep complete database records for payment, point, and booking-payment workflows.
- Make every credit and debit idempotent.
- Use database transactions and row locks to keep balances consistent.
- Log important workflow events with enough metadata to debug production issues.

## Non-Goals

- Building an admin UI for editing packages.
- Dynamically managing Stripe Products or Prices from CampOsprey.
- Charging points for non-booking actions in this phase.
- Replacing BC Parks auto-pay implementation details in this phase.

## Package Configuration

Point packages are defined in server configuration. Stripe Products and Prices are created manually in Stripe, then referenced by config.

Example shape:

```ts
export const POINT_PACKAGES = [
  {
    id: 'starter',
    name: 'Starter',
    points: 500,
    stripePriceId: 'price_...',
  },
  {
    id: 'standard',
    name: 'Standard',
    points: 1200,
    stripePriceId: 'price_...',
  },
  {
    id: 'pro',
    name: 'Pro',
    points: 3000,
    stripePriceId: 'price_...',
  },
];
```

The successful booking cost is also server-side configuration:

```ts
export const SUCCESSFUL_BOOKING_POINT_COST = 100;
```

Stripe prices should be treated as immutable. If price or currency changes, create a new Stripe Price and update the package config. Payment records snapshot `packageId`, `stripePriceId`, points, amount, and currency so history remains understandable after config changes.

## Database Model

### `user_point_accounts`

One row per user.

| Column | Notes |
|---|---|
| `userId` | Primary key, FK to `user.id` |
| `balance` | Current point balance |
| `createdAt` | Row creation time |
| `updatedAt` | Last balance change time |

### `point_transactions`

Append-only ledger for every balance change.

| Column | Notes |
|---|---|
| `id` | Primary key |
| `userId` | FK to `user.id` |
| `type` | `stripe_purchase`, `booking_charge`, `stripe_refund`, `stripe_dispute`, `admin_adjustment` |
| `pointsDelta` | Positive for credits, negative for debits |
| `balanceAfter` | Balance after applying this transaction |
| `sourceType` | Source table or workflow |
| `sourceId` | Source row ID or Stripe ID |
| `idempotencyKey` | Unique key preventing duplicate application |
| `metadata` | JSON snapshot for audit/debugging |
| `createdAt` | Ledger entry time |

### `stripe_checkout_sessions`

Tracks checkout attempts and package snapshots.

| Column | Notes |
|---|---|
| `id` | Primary key |
| `userId` | FK to `user.id` |
| `packageId` | Config package ID selected by user |
| `stripePriceId` | Stripe Price used for checkout |
| `stripeSessionId` | Unique Stripe Checkout Session ID |
| `stripePaymentIntentId` | PaymentIntent ID when known |
| `stripeCustomerId` | Stripe Customer ID when known |
| `status` | `created`, `paid`, `expired`, `refunded`, `disputed`, `failed` |
| `points` | Points snapshot from config |
| `amountTotal` | Amount snapshot from Stripe/session |
| `currency` | Currency snapshot |
| `metadata` | JSON for additional Stripe/session context |
| `createdAt` | Checkout creation time |
| `updatedAt` | Last status update |

### `stripe_webhook_events`

Stores processed Stripe event IDs.

| Column | Notes |
|---|---|
| `stripeEventId` | Primary key |
| `eventType` | Stripe event type |
| `processedAt` | Processing time |
| `status` | `processing`, `processed`, `ignored`, `failed` |
| `error` | Failure details when processing fails |

### `booking_payment_events`

Authoritative app-side record that a campsite was actually paid/booked. This table must not depend on `trips` having complete or trustworthy booking data. The existing `trips` table is reference/context only.

| Column | Notes |
|---|---|
| `id` | Primary key |
| `userId` | FK to `user.id` |
| `tripId` | Optional reference to `trips.id` |
| `clientEventId` | Extension-generated event ID |
| `idempotencyKey` | Unique key for this paid booking |
| `provider` | Example: `bc_parks` |
| `confirmationNumber` | Provider confirmation/reservation number when available |
| `providerReservationId` | Provider reservation ID when available |
| `providerTransactionId` | Provider payment/transaction ID when available |
| `parkName` | Park name snapshot |
| `campgroundName` | Campground name snapshot |
| `sectionName` | Section name snapshot |
| `siteName` | Site name snapshot |
| `resourceId` | Provider resource/site ID |
| `checkIn` | Booking check-in date |
| `checkOut` | Booking check-out date |
| `paidAt` | Provider payment confirmation time when detected |
| `bookingUrl` | Provider booking/receipt URL |
| `amountPaid` | Provider amount if detectable |
| `currency` | Provider currency if detectable |
| `clientId` | Extension client ID |
| `ipAddress`, `country`, `region`, `city` | Request context |
| `userAgent`, `platformOs`, `platformArch`, `extensionVersion` | Client context |
| `rawProviderSnapshot` | JSON payload/scraped facts needed for audit |
| `createdAt` | Server receive time |

### `booking_point_charges`

Links one booking payment event to one point deduction.

| Column | Notes |
|---|---|
| `id` | Primary key |
| `userId` | FK to `user.id` |
| `bookingPaymentEventId` | FK to `booking_payment_events.id` |
| `pointTransactionId` | FK to `point_transactions.id` when charged |
| `pointsCharged` | Configured cost snapshot |
| `status` | `charged`, `failed_insufficient_points`, `duplicate_ignored` |
| `idempotencyKey` | Unique charge key |
| `createdAt` | Charge attempt time |

## API Design

### `GET /api/points`

Authenticated. Returns the current point balance, configured packages, successful booking cost, and recent ledger rows.

### `POST /api/stripe/checkout`

Authenticated. Input is `packageId`.

Server behavior:

1. Look up the package in server config.
2. Create or reuse a Stripe Customer for the user when practical.
3. Create a Stripe Checkout Session using the configured `stripePriceId`.
4. Store a `stripe_checkout_sessions` row with package and price snapshot.
5. Return the Stripe Checkout URL.

Checkout session metadata should include `userId`, `userEmail`, and `packageId`. The server still validates all values from its own database/config during webhook processing.

### `POST /api/stripe/webhook`

Public Stripe webhook endpoint. It verifies the Stripe signature before reading or trusting the event.

Handled events:

- `checkout.session.completed`: marks checkout paid and credits points.
- `checkout.session.expired`: marks checkout expired.
- Refund/chargeback events: reverses previously credited points.

Server behavior:

1. Verify Stripe signature.
2. Claim `stripe_webhook_events.stripeEventId`; if it is already `processed`, return success.
3. Find the checkout/session/payment record.
4. Verify the paid session matches a known configured package and expected Stripe Price.
5. Apply point credit or reversal in a database transaction.

If processing fails after the event is claimed, mark the row `failed` with the error and return a non-2xx response so Stripe retries. A later retry can reclaim failed events, while successfully processed events remain ignored.

### `POST /api/booking-payment-events`

Authenticated extension endpoint. Records a confirmed paid campsite booking and attempts the point charge.

The request must include complete booking/payment metadata because `trips` is not authoritative. `tripId` may be included for context, but point charging must be based on this event payload and idempotency fields.

Server behavior:

1. Normalize and validate provider metadata.
2. Store `booking_payment_events` with the full metadata snapshot.
3. Deduct `SUCCESSFUL_BOOKING_POINT_COST` in the same transaction when possible.
4. Return whether points were charged, duplicate ignored, or insufficient.

The existing `POST /api/trips/:id/result` can continue to record `found`, `hold_placed`, and `failed` outcomes. `hold_placed` does not deduct points. Confirmed paid bookings should use `POST /api/booking-payment-events`.

## Idempotency And Consistency

### Stripe

- `stripe_webhook_events.stripeEventId` is unique.
- `stripe_checkout_sessions.stripeSessionId` is unique.
- Payment credit transactions use an idempotency key such as `stripe:checkout_session:<sessionId>:credit`.
- Refund/dispute reversals use unique keys based on Stripe refund/dispute IDs.

### Booking Payment Events

The extension sends a client-generated idempotency key. Best key:

```text
provider + confirmationNumber
```

Fallback key when confirmation number is unavailable:

```text
provider + resourceId + checkIn + checkOut + paidAt
```

The server should warn when a paid booking event lacks a strong provider confirmation identity. Duplicate events with the same idempotency key return the existing result and do not charge twice. Duplicate keys with materially conflicting metadata should log a warning.

### Point Ledger Updates

Every balance change runs inside a database transaction:

1. Ensure a `user_point_accounts` row exists.
2. Lock the account row with `SELECT ... FOR UPDATE`.
3. Insert the point ledger row using a unique `idempotencyKey`.
4. Update account balance from the locked current balance.
5. Store `balanceAfter` on the ledger row.

This guarantees concurrent Stripe webhooks, booking events, and future admin adjustments cannot corrupt the balance.

### Insufficient Balance

Before auto-pay or other future paid actions start, the app should check that `balance >= SUCCESSFUL_BOOKING_POINT_COST`.

After a campsite payment has already succeeded, the server should still record the `booking_payment_events` row even if points cannot be charged. The charge row is marked `failed_insufficient_points`, logs a warning, and returns a response that allows support/admin handling. This preserves the audit trail and avoids hiding successful external payments.

Refunds and chargebacks can make a balance negative. Future paid actions should be blocked until the user tops up enough points.

## Logging And Observability

Logs should be structured objects with stable event names. Important authenticated payment/points logs should include `userId` and `userEmail`. Stripe logs should include `stripeCustomerId`, `stripeSessionId`, `stripePaymentIntentId`, or `stripeEventId` where available.

Never log card data, auth tokens, Stripe secrets, full raw webhook bodies, or sensitive payment fields.

### Levels

- `info`: checkout created, webhook processed, points credited, refund reversed, booking payment event recorded, points charged, insufficient balance detected.
- `debug`: package lookup, normalized metadata, balance read result, duplicate webhook ignored, duplicate idempotency key returning an existing result.
- `warning`: unknown package, Stripe event for unknown session, paid booking event missing confirmation number, insufficient points after paid booking, duplicate event with conflicting metadata.
- `error`: Stripe signature verification failure, DB transaction failure, point ledger write failure, unexpected webhook processing failure.

### Event Names

- `points.checkout.created`
- `points.checkout.package_not_found`
- `stripe.webhook.received`
- `stripe.webhook.duplicate_ignored`
- `stripe.webhook.signature_invalid`
- `points.credit.applied`
- `points.refund.applied`
- `booking_payment.received`
- `booking_payment.recorded`
- `booking_payment.duplicate_ignored`
- `points.charge.applied`
- `points.charge.insufficient_balance`
- `points.ledger.error`

Example important log:

```ts
console.info('[points] charge applied', {
  event: 'points.charge.applied',
  userId,
  userEmail,
  tripId,
  bookingPaymentEventId,
  pointTransactionId,
  pointsCharged,
  balanceAfter,
  idempotencyKey,
});
```

## Extension UX And Flow

Payment settings should stop presenting CampOsprey point purchase as local card storage. For CampOsprey points, the UI should show:

- Current point balance.
- Available point packages.
- A button to open Stripe Checkout.
- Recent point activity.

BC Parks auto-pay card storage is a separate provider automation concern and should not be confused with Stripe point purchases. If it remains in the UI, label it separately from CampOsprey points and avoid implying CampOsprey stores or processes those card details server-side.

## Testing Strategy

Server tests should cover:

- Package lookup and checkout creation.
- Stripe webhook signature failure.
- Duplicate Stripe webhook event does not credit twice.
- Successful checkout credits exactly once and snapshots package data.
- Refund/chargeback reverses points exactly once.
- Booking payment event records full metadata without relying on `trips`.
- Booking payment duplicate does not charge twice.
- Concurrent point updates preserve correct balance.
- Insufficient balance after paid booking records the event and marks charge failure.

Extension tests should cover:

- Points page renders balance/packages.
- Checkout button calls the server and opens returned Stripe URL.
- Paid booking event payload includes complete provider/payment metadata and idempotency key.
