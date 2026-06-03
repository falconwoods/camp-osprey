# Payment Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe-backed point purchases, server-side point accounting, and idempotent booking-payment point charges.

**Architecture:** The Next.js server owns point balances through a Postgres account row plus append-only ledger. Stripe Checkout starts from authenticated API routes, Stripe webhooks credit/reverse points idempotently, and a new booking-payment endpoint records complete provider metadata before charging points. The extension displays balance/packages, starts checkout, and later reports paid booking events with full metadata.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, Postgres, Stripe Node SDK, Vitest, Chrome extension TypeScript.

---

## File Structure

- Modify `server/package.json` and `server/package-lock.json`: add Stripe SDK dependency.
- Modify `server/.env.example`: document Stripe and points configuration.
- Modify `server/db/schema.ts`: add point, checkout, webhook, and booking-payment tables.
- Create `server/lib/points-config.ts`: parse package and booking-cost config.
- Create `server/lib/points-ledger.ts`: transaction-safe point account and ledger operations.
- Create `server/lib/stripe.ts`: lazy Stripe client and Checkout helpers.
- Create `server/lib/booking-payment-events.ts`: normalize paid booking payloads and build idempotency keys.
- Create `server/app/api/points/route.ts`: authenticated balance/package API.
- Create `server/app/api/stripe/checkout/route.ts`: authenticated Checkout Session creation.
- Create `server/app/api/stripe/webhook/route.ts`: Stripe signature verification and webhook dispatch.
- Create `server/app/api/booking-payment-events/route.ts`: authenticated paid-booking event intake and point charge.
- Modify `extension/src/serverApi.ts`: add points, checkout, and booking-payment client calls.
- Modify `extension/src/options/settings/paymentPage.ts`: replace CampOsprey point purchase UI with balance/packages/checkout.
- Add focused server and extension tests for the new behavior.

---

### Task 1: Add Stripe Dependency And Runtime Config

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/.env.example`
- Create: `server/lib/points-config.ts`
- Test: `server/__tests__/points-config.test.ts`

- [ ] **Step 1: Install Stripe SDK**

Run:

```bash
cd server
npm install stripe
```

Expected: `server/package.json` includes `"stripe"` and `server/package-lock.json` is updated.

- [ ] **Step 2: Write package config tests**

Create `server/__tests__/points-config.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('points config', () => {
  it('parses configured point packages', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' },
    ]);
    process.env.SUCCESSFUL_BOOKING_POINT_COST = '100';

    const { getPointPackages, getSuccessfulBookingPointCost } = await import('../lib/points-config');

    expect(getPointPackages()).toEqual([
      { id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' },
    ]);
    expect(getSuccessfulBookingPointCost()).toBe(100);
  });

  it('rejects invalid package config', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: '', name: 'Starter', points: 0, stripePriceId: 'price_123' },
    ]);

    const { getPointPackages } = await import('../lib/points-config');

    expect(() => getPointPackages()).toThrow('POINT_PACKAGES');
  });
});
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
cd server
npm test -- points-config.test.ts
```

Expected: FAIL because `server/lib/points-config.ts` does not exist.

- [ ] **Step 4: Implement config parser**

Create `server/lib/points-config.ts`:

```ts
export interface PointPackage {
  id: string;
  name: string;
  points: number;
  stripePriceId: string;
}

let packageCache: PointPackage[] | null = null;

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function isPointPackage(value: unknown): value is PointPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pkg = value as Partial<PointPackage>;
  return typeof pkg.id === 'string' && pkg.id.trim().length > 0
    && typeof pkg.name === 'string' && pkg.name.trim().length > 0
    && Number.isInteger(pkg.points) && pkg.points > 0
    && typeof pkg.stripePriceId === 'string' && pkg.stripePriceId.trim().startsWith('price_');
}

export function getPointPackages(): PointPackage[] {
  if (packageCache) return packageCache;
  const raw = process.env.POINT_PACKAGES;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('POINT_PACKAGES must be valid JSON');
  }

  if (!Array.isArray(parsed) || !parsed.every(isPointPackage)) {
    throw new Error('POINT_PACKAGES must be an array of valid point packages');
  }

  const seen = new Set<string>();
  for (const pkg of parsed) {
    if (seen.has(pkg.id)) throw new Error(`POINT_PACKAGES contains duplicate id: ${pkg.id}`);
    seen.add(pkg.id);
  }

  packageCache = parsed.map(pkg => ({
    id: pkg.id.trim(),
    name: pkg.name.trim(),
    points: pkg.points,
    stripePriceId: pkg.stripePriceId.trim(),
  }));
  return packageCache;
}

export function getPointPackage(packageId: string): PointPackage | null {
  return getPointPackages().find(pkg => pkg.id === packageId) ?? null;
}

export function getSuccessfulBookingPointCost(): number {
  return parsePositiveInteger('SUCCESSFUL_BOOKING_POINT_COST', process.env.SUCCESSFUL_BOOKING_POINT_COST, 100);
}
```

- [ ] **Step 5: Update env example**

Add to `server/.env.example`:

```dotenv
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
STRIPE_SUCCESS_URL=http://localhost:3001/payment/success
STRIPE_CANCEL_URL=http://localhost:3001/payment/cancel
POINT_PACKAGES=[{"id":"starter","name":"Starter","points":500,"stripePriceId":"price_xxx"},{"id":"standard","name":"Standard","points":1200,"stripePriceId":"price_yyy"}]
SUCCESSFUL_BOOKING_POINT_COST=100
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd server
npm test -- points-config.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/package.json server/package-lock.json server/.env.example server/lib/points-config.ts server/__tests__/points-config.test.ts
git commit -m "Add points runtime config"
```

---

### Task 2: Add Database Schema And Migration

**Files:**
- Modify: `server/db/schema.ts`
- Create: generated Drizzle migration under `server/drizzle/`

- [ ] **Step 1: Add schema tables**

Modify `server/db/schema.ts` imports to include `uniqueIndex`:

```ts
import {
  pgTable, text, boolean, timestamp, serial,
  integer, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
```

Add tables after `userAuthEvents`:

```ts
export const userPointAccounts = pgTable('user_point_accounts', {
  userId:    text('userId').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  balance:   integer('balance').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const pointTransactions = pgTable('point_transactions', {
  id:             serial('id').primaryKey(),
  userId:         text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),
  pointsDelta:    integer('pointsDelta').notNull(),
  balanceAfter:   integer('balanceAfter').notNull(),
  sourceType:     text('sourceType').notNull(),
  sourceId:       text('sourceId').notNull(),
  idempotencyKey: text('idempotencyKey').notNull(),
  metadata:       jsonb('metadata'),
  createdAt:      timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('point_transactions_user_idx').on(t.userId),
  uniqueIndex('point_transactions_idempotency_idx').on(t.idempotencyKey),
]);

export const stripeCheckoutSessions = pgTable('stripe_checkout_sessions', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  packageId:             text('packageId').notNull(),
  stripePriceId:         text('stripePriceId').notNull(),
  stripeSessionId:       text('stripeSessionId').notNull(),
  stripePaymentIntentId: text('stripePaymentIntentId'),
  stripeCustomerId:      text('stripeCustomerId'),
  status:                text('status').notNull(),
  points:                integer('points').notNull(),
  amountTotal:           integer('amountTotal'),
  currency:              text('currency'),
  metadata:              jsonb('metadata'),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
  updatedAt:             timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('stripe_checkout_sessions_user_idx').on(t.userId),
  uniqueIndex('stripe_checkout_sessions_session_idx').on(t.stripeSessionId),
]);

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  stripeEventId: text('stripeEventId').primaryKey(),
  eventType:     text('eventType').notNull(),
  processedAt:   timestamp('processedAt'),
  status:        text('status').notNull(),
  error:         text('error'),
  createdAt:     timestamp('createdAt').notNull().defaultNow(),
  updatedAt:     timestamp('updatedAt').notNull().defaultNow(),
});

export const bookingPaymentEvents = pgTable('booking_payment_events', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tripId:                text('tripId').references(() => trips.id, { onDelete: 'set null' }),
  clientEventId:         text('clientEventId'),
  idempotencyKey:        text('idempotencyKey').notNull(),
  provider:              text('provider').notNull(),
  confirmationNumber:    text('confirmationNumber'),
  providerReservationId: text('providerReservationId'),
  providerTransactionId: text('providerTransactionId'),
  parkName:              text('parkName').notNull(),
  campgroundName:        text('campgroundName'),
  sectionName:           text('sectionName'),
  siteName:              text('siteName').notNull(),
  resourceId:            text('resourceId'),
  checkIn:               text('checkIn').notNull(),
  checkOut:              text('checkOut').notNull(),
  paidAt:                timestamp('paidAt'),
  bookingUrl:            text('bookingUrl'),
  amountPaid:            integer('amountPaid'),
  currency:              text('currency'),
  clientId:              text('clientId'),
  ipAddress:             text('ipAddress'),
  country:               text('country'),
  region:                text('region'),
  city:                  text('city'),
  userAgent:             text('userAgent'),
  platformOs:            text('platformOs'),
  platformArch:          text('platformArch'),
  extensionVersion:      text('extensionVersion'),
  rawProviderSnapshot:   jsonb('rawProviderSnapshot'),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_payment_events_user_idx').on(t.userId),
  index('booking_payment_events_trip_idx').on(t.tripId),
  uniqueIndex('booking_payment_events_idempotency_idx').on(t.idempotencyKey),
]);

export const bookingPointCharges = pgTable('booking_point_charges', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookingPaymentEventId: integer('bookingPaymentEventId').notNull().references(() => bookingPaymentEvents.id, { onDelete: 'cascade' }),
  pointTransactionId:    integer('pointTransactionId').references(() => pointTransactions.id, { onDelete: 'set null' }),
  pointsCharged:         integer('pointsCharged').notNull(),
  status:                text('status').notNull(),
  idempotencyKey:        text('idempotencyKey').notNull(),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_point_charges_user_idx').on(t.userId),
  uniqueIndex('booking_point_charges_idempotency_idx').on(t.idempotencyKey),
]);
```

- [ ] **Step 2: Generate migration**

Run:

```bash
cd server
npm run db:generate
```

Expected: one new SQL migration and `drizzle/meta` snapshot are created.

- [ ] **Step 3: Verify TypeScript schema compiles**

Run:

```bash
cd server
npm test -- --runInBand
```

Expected: Tests may fail for unrelated new missing services, but no syntax error in `db/schema.ts`. If `--runInBand` is unsupported by Vitest, run `npm test`.

- [ ] **Step 4: Commit schema**

Commit:

```bash
git add server/db/schema.ts server/drizzle
git commit -m "Add payment points database schema"
```

---

### Task 3: Implement Point Ledger Service

**Files:**
- Create: `server/lib/points-ledger.ts`
- Test: `server/__tests__/points-ledger.test.ts`

- [ ] **Step 1: Write ledger unit tests with a fake transaction dependency**

Create `server/__tests__/points-ledger.test.ts` covering:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyPointTransaction } from '../lib/points-ledger';

describe('applyPointTransaction', () => {
  it('applies a credit against the locked balance', async () => {
    const deps = {
      ensureAccount: vi.fn(async () => undefined),
      lockAccount: vi.fn(async () => ({ userId: 'user-1', balance: 10 })),
      findTransaction: vi.fn(async () => null),
      insertTransaction: vi.fn(async () => ({ id: 7 })),
      updateBalance: vi.fn(async () => undefined),
    };

    const result = await applyPointTransaction(deps, {
      userId: 'user-1',
      type: 'stripe_purchase',
      pointsDelta: 100,
      sourceType: 'stripe_checkout_session',
      sourceId: 'cs_123',
      idempotencyKey: 'stripe:checkout_session:cs_123:credit',
      metadata: { packageId: 'starter' },
    });

    expect(result).toEqual({ applied: true, transactionId: 7, balanceAfter: 110 });
    expect(deps.updateBalance).toHaveBeenCalledWith('user-1', 110);
  });

  it('returns the existing transaction for a duplicate idempotency key', async () => {
    const deps = {
      ensureAccount: vi.fn(async () => undefined),
      lockAccount: vi.fn(async () => ({ userId: 'user-1', balance: 10 })),
      findTransaction: vi.fn(async () => ({ id: 4, balanceAfter: 55 })),
      insertTransaction: vi.fn(),
      updateBalance: vi.fn(),
    };

    const result = await applyPointTransaction(deps, {
      userId: 'user-1',
      type: 'stripe_purchase',
      pointsDelta: 100,
      sourceType: 'stripe_checkout_session',
      sourceId: 'cs_123',
      idempotencyKey: 'stripe:checkout_session:cs_123:credit',
      metadata: {},
    });

    expect(result).toEqual({ applied: false, transactionId: 4, balanceAfter: 55 });
    expect(deps.insertTransaction).not.toHaveBeenCalled();
    expect(deps.updateBalance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd server
npm test -- points-ledger.test.ts
```

Expected: FAIL because `points-ledger.ts` does not exist.

- [ ] **Step 3: Implement dependency-injected ledger core plus DB adapter**

Create `server/lib/points-ledger.ts` with:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { pointTransactions, userPointAccounts } from '@/db/schema';

export type PointTransactionType =
  | 'stripe_purchase'
  | 'booking_charge'
  | 'stripe_refund'
  | 'stripe_dispute'
  | 'admin_adjustment';

export interface PointTransactionInput {
  userId: string;
  type: PointTransactionType;
  pointsDelta: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

export interface PointLedgerDeps {
  ensureAccount(userId: string): Promise<void>;
  lockAccount(userId: string): Promise<{ userId: string; balance: number }>;
  findTransaction(idempotencyKey: string): Promise<{ id: number; balanceAfter: number } | null>;
  insertTransaction(input: PointTransactionInput & { balanceAfter: number }): Promise<{ id: number }>;
  updateBalance(userId: string, balance: number): Promise<void>;
}

export async function applyPointTransaction(
  deps: PointLedgerDeps,
  input: PointTransactionInput,
): Promise<{ applied: boolean; transactionId: number; balanceAfter: number }> {
  await deps.ensureAccount(input.userId);
  const account = await deps.lockAccount(input.userId);
  const existing = await deps.findTransaction(input.idempotencyKey);
  if (existing) {
    console.debug('[points] duplicate transaction ignored', {
      event: 'points.transaction.duplicate_ignored',
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      pointTransactionId: existing.id,
    });
    return { applied: false, transactionId: existing.id, balanceAfter: existing.balanceAfter };
  }

  const balanceAfter = account.balance + input.pointsDelta;
  const inserted = await deps.insertTransaction({ ...input, balanceAfter });
  await deps.updateBalance(input.userId, balanceAfter);
  return { applied: true, transactionId: inserted.id, balanceAfter };
}

export async function applyPointTransactionInDb(
  input: PointTransactionInput,
): Promise<{ applied: boolean; transactionId: number; balanceAfter: number }> {
  return db.transaction(async (tx) => applyPointTransaction({
    ensureAccount: async (userId) => {
      await tx.insert(userPointAccounts)
        .values({ userId, balance: 0 })
        .onConflictDoNothing();
    },
    lockAccount: async (userId) => {
      const rows = await tx.execute(sql<{ userId: string; balance: number }>`
        select "userId", balance
        from user_point_accounts
        where "userId" = ${userId}
        for update
      `);
      const account = rows[0];
      if (!account) throw new Error(`Point account not found for user ${userId}`);
      return { userId: account.userId, balance: Number(account.balance) };
    },
    findTransaction: async (idempotencyKey) => {
      const [row] = await tx.select({
        id: pointTransactions.id,
        balanceAfter: pointTransactions.balanceAfter,
      }).from(pointTransactions).where(eq(pointTransactions.idempotencyKey, idempotencyKey));
      return row ?? null;
    },
    insertTransaction: async (entry) => {
      const [row] = await tx.insert(pointTransactions).values(entry).returning({ id: pointTransactions.id });
      return row;
    },
    updateBalance: async (userId, balance) => {
      await tx.update(userPointAccounts)
        .set({ balance, updatedAt: new Date() })
        .where(eq(userPointAccounts.userId, userId));
    },
  }, input));
}

export async function getPointAccountSummary(userId: string): Promise<{
  balance: number;
  recentTransactions: Array<{
    id: number;
    type: string;
    pointsDelta: number;
    balanceAfter: number;
    sourceType: string;
    sourceId: string;
    createdAt: Date;
  }>;
}> {
  await db.insert(userPointAccounts).values({ userId, balance: 0 }).onConflictDoNothing();
  const [account] = await db.select().from(userPointAccounts).where(eq(userPointAccounts.userId, userId));
  const recentTransactions = await db.select({
    id: pointTransactions.id,
    type: pointTransactions.type,
    pointsDelta: pointTransactions.pointsDelta,
    balanceAfter: pointTransactions.balanceAfter,
    sourceType: pointTransactions.sourceType,
    sourceId: pointTransactions.sourceId,
    createdAt: pointTransactions.createdAt,
  }).from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt))
    .limit(20);

  return { balance: account?.balance ?? 0, recentTransactions };
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server
npm test -- points-ledger.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/lib/points-ledger.ts server/__tests__/points-ledger.test.ts
git commit -m "Add point ledger service"
```

---

### Task 4: Add Points And Stripe Checkout APIs

**Files:**
- Create: `server/lib/stripe.ts`
- Create: `server/app/api/points/route.ts`
- Create: `server/app/api/stripe/checkout/route.ts`
- Test: `server/__tests__/points-route.test.ts`
- Test: `server/__tests__/stripe-checkout-route.test.ts`

- [ ] **Step 1: Write route tests**

Create tests that mock `getSession`, `getPointAccountSummary`, config, and Stripe session creation:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPointPackages: vi.fn(),
  getSuccessfulBookingPointCost: vi.fn(),
  getPointAccountSummary: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/points-config', () => ({
  getPointPackages: mocks.getPointPackages,
  getPointPackage: (id: string) => mocks.getPointPackages().find((pkg: { id: string }) => pkg.id === id) ?? null,
  getSuccessfulBookingPointCost: mocks.getSuccessfulBookingPointCost,
}));
vi.mock('@/lib/points-ledger', () => ({ getPointAccountSummary: mocks.getPointAccountSummary }));
vi.mock('@/lib/stripe', () => ({ createCheckoutSession: mocks.createCheckoutSession }));
vi.mock('@/lib/extension-cors', async () => await import('../lib/extension-cors'));

describe('points and checkout routes', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' } });
    mocks.getPointPackages.mockReturnValue([{ id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' }]);
    mocks.getSuccessfulBookingPointCost.mockReturnValue(100);
    mocks.getPointAccountSummary.mockResolvedValue({ balance: 50, recentTransactions: [] });
    mocks.createCheckoutSession.mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' });
  });

  it('returns balance and configured packages', async () => {
    const { GET } = await import('../app/api/points/route');
    const response = await GET(new Request('http://localhost/api/points'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      balance: 50,
      packages: [{ id: 'starter', name: 'Starter', points: 500 }],
      successfulBookingPointCost: 100,
      recentTransactions: [],
    });
  });

  it('creates checkout for a package', async () => {
    const { POST } = await import('../app/api/stripe/checkout/route');
    const response = await POST(new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId: 'starter' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checkoutUrl: 'https://checkout.stripe.com/cs_123', stripeSessionId: 'cs_123' });
  });
});
```

- [ ] **Step 2: Implement Stripe helper**

Create `server/lib/stripe.ts`:

```ts
import Stripe from 'stripe';
import { db } from '@/db';
import { stripeCheckoutSessions } from '@/db/schema';
import type { PointPackage } from '@/lib/points-config';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  stripeClient = new Stripe(key, { apiVersion: '2025-05-28.basil' });
  return stripeClient;
}

export async function createCheckoutSession(input: {
  userId: string;
  userEmail: string;
  pointPackage: PointPackage;
}): Promise<{ id: string; url: string }> {
  const stripe = getStripe();
  const successUrl = process.env.STRIPE_SUCCESS_URL ?? `${process.env.BETTER_AUTH_URL}/payment/success`;
  const cancelUrl = process.env.STRIPE_CANCEL_URL ?? `${process.env.BETTER_AUTH_URL}/payment/cancel`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: input.userEmail,
    line_items: [{ price: input.pointPackage.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId: input.userId,
      userEmail: input.userEmail,
      packageId: input.pointPackage.id,
    },
  });

  await db.insert(stripeCheckoutSessions).values({
    userId: input.userId,
    packageId: input.pointPackage.id,
    stripePriceId: input.pointPackage.stripePriceId,
    stripeSessionId: session.id,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
    status: 'created',
    points: input.pointPackage.points,
    amountTotal: session.amount_total,
    currency: session.currency,
    metadata: { url: session.url },
  });

  console.info('[points] checkout created', {
    event: 'points.checkout.created',
    userId: input.userId,
    userEmail: input.userEmail,
    packageId: input.pointPackage.id,
    stripeSessionId: session.id,
    stripePriceId: input.pointPackage.stripePriceId,
  });

  return { id: session.id, url: session.url ?? '' };
}
```

- [ ] **Step 3: Implement routes**

Create `server/app/api/points/route.ts` and `server/app/api/stripe/checkout/route.ts` using `getSession`, `withExtensionCors`, `extensionCorsPreflight`, config functions, and service helpers.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd server
npm test -- points-route.test.ts stripe-checkout-route.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/lib/stripe.ts server/app/api/points/route.ts server/app/api/stripe/checkout/route.ts server/__tests__/points-route.test.ts server/__tests__/stripe-checkout-route.test.ts
git commit -m "Add points and checkout APIs"
```

---

### Task 5: Add Stripe Webhook Processing

**Files:**
- Create: `server/app/api/stripe/webhook/route.ts`
- Create: `server/lib/stripe-webhooks.ts`
- Test: `server/__tests__/stripe-webhook.test.ts`

- [ ] **Step 1: Write webhook tests**

Tests should cover invalid signature, duplicate processed event, and successful checkout credit. Mock Stripe event construction, DB checkout lookup, webhook event claim/update, and `applyPointTransactionInDb`.

- [ ] **Step 2: Implement webhook handler**

Core behavior:

```ts
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe] webhook signature invalid', { event: 'stripe.webhook.signature_invalid', error: err });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await processStripeWebhookEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook processing failed', { event: 'stripe.webhook.error', stripeEventId: event.id, error: err });
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
```

`processStripeWebhookEvent` must claim `stripe_webhook_events`, process supported events, update `processed` on success, mark `failed` and throw on failure, and return success immediately for already processed events.

- [ ] **Step 3: Implement checkout completion credit**

For `checkout.session.completed`:

1. Find `stripe_checkout_sessions` by `session.id`.
2. Verify `session.payment_status === 'paid'`.
3. Verify package config still contains matching `packageId` and `stripePriceId`.
4. Update session status and payment IDs.
5. Call `applyPointTransactionInDb` with idempotency key `stripe:checkout_session:${session.id}:credit`.

- [ ] **Step 4: Implement reversal events**

For refund/dispute events, find the original checkout by payment intent when possible and apply a negative point transaction using a unique refund/dispute idempotency key.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd server
npm test -- stripe-webhook.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/app/api/stripe/webhook/route.ts server/lib/stripe-webhooks.ts server/__tests__/stripe-webhook.test.ts
git commit -m "Add Stripe webhook point processing"
```

---

### Task 6: Add Booking Payment Event Endpoint

**Files:**
- Create: `server/lib/booking-payment-events.ts`
- Create: `server/app/api/booking-payment-events/route.ts`
- Test: `server/__tests__/booking-payment-events.test.ts`

- [ ] **Step 1: Write normalization tests**

Test that required fields are validated, complete metadata is preserved, and fallback idempotency key is built from provider/resource/date/paidAt when confirmation number is missing.

- [ ] **Step 2: Implement normalizer**

Create `normalizeBookingPaymentEventBody(body)` returning validated fields:

```ts
{
  tripId?: string;
  clientEventId?: string;
  idempotencyKey: string;
  provider: 'bc_parks';
  confirmationNumber?: string;
  providerReservationId?: string;
  providerTransactionId?: string;
  parkName: string;
  campgroundName?: string;
  sectionName?: string;
  siteName: string;
  resourceId?: string;
  checkIn: string;
  checkOut: string;
  paidAt?: Date;
  bookingUrl?: string;
  amountPaid?: number;
  currency?: string;
  rawProviderSnapshot?: unknown;
}
```

- [ ] **Step 3: Implement route transaction**

Authenticated route behavior:

1. Build request context from existing `buildRequestContext`.
2. Insert `booking_payment_events`; on duplicate idempotency key, return existing charge/event result.
3. Apply booking charge with `applyPointTransactionInDb`, using `booking_payment:${id}:charge`.
4. Insert `booking_point_charges`.
5. Log `booking_payment.recorded`, `points.charge.applied`, or `points.charge.insufficient_balance` with `userId` and `userEmail`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd server
npm test -- booking-payment-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/lib/booking-payment-events.ts server/app/api/booking-payment-events/route.ts server/__tests__/booking-payment-events.test.ts
git commit -m "Add booking payment event point charges"
```

---

### Task 7: Add Extension API And Payment Page UI

**Files:**
- Modify: `extension/src/serverApi.ts`
- Modify: `extension/src/options/settings/paymentPage.ts`
- Test: `extension/tests/paymentPage.test.ts`

- [ ] **Step 1: Add API types and functions**

In `extension/src/serverApi.ts`, add:

```ts
export interface PointsSummary {
  balance: number;
  packages: Array<{ id: string; name: string; points: number }>;
  successfulBookingPointCost: number;
  recentTransactions: Array<{
    id: number;
    type: string;
    pointsDelta: number;
    balanceAfter: number;
    sourceType: string;
    sourceId: string;
    createdAt: string;
  }>;
}

export async function getPointsSummary(): Promise<PointsSummary> {
  return serverFetch('/api/points', { method: 'GET', auth: true });
}

export async function createPointCheckout(packageId: string): Promise<{ checkoutUrl: string; stripeSessionId: string }> {
  return serverFetch('/api/stripe/checkout', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ packageId }),
  });
}
```

- [ ] **Step 2: Replace point purchase UI**

Modify `PaymentPage` to render signed-in points UI:

- balance
- successful booking cost
- package buttons
- recent ledger
- sign-in prompt when unauthenticated

Keep any BC Parks local-card storage clearly separated or remove it from the CampOsprey points card.

- [ ] **Step 3: Verify checkout opens URL**

Use `chrome.tabs.create({ url: checkoutUrl })` when available, otherwise `window.open(checkoutUrl, '_blank')`.

- [ ] **Step 4: Run extension tests and commit**

Run:

```bash
cd extension
npm test -- paymentPage.test.ts
```

Expected: PASS.

Commit:

```bash
git add extension/src/serverApi.ts extension/src/options/settings/paymentPage.ts extension/tests/paymentPage.test.ts
git commit -m "Add extension points purchase UI"
```

---

### Task 8: Full Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run server tests**

Run:

```bash
cd server
npm test
```

Expected: PASS.

- [ ] **Step 2: Run server build**

Run:

```bash
cd server
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run extension tests**

Run:

```bash
cd extension
npm test
```

Expected: PASS.

- [ ] **Step 4: Run extension build if available**

Run:

```bash
cd extension
npm run build
```

Expected: PASS.

- [ ] **Step 5: Final commit if verification fixes were made**

Commit any verification-only fixes:

```bash
git add server extension
git commit -m "Stabilize payment points implementation"
```
