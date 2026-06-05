import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { stripeCheckoutSessions, stripeWebhookEvents } from '@/db/schema';
import { getPointPackage, type PointPackage } from '@/lib/points-config';
import { applyPointTransactionInDb, type PointTransactionInput } from '@/lib/points-ledger';
import { logger } from './loki';

type WebhookClaim = 'new' | 'processed' | 'retry';

interface CheckoutRecord {
  id: number;
  userId: string;
  packageId: string;
  stripePriceId: string;
  stripeSessionId: string;
  points: number;
}

export interface StripeWebhookDeps {
  claimWebhookEvent(stripeEventId: string, eventType: string): Promise<WebhookClaim>;
  markWebhookEventProcessed(stripeEventId: string, status: 'processed' | 'ignored'): Promise<void>;
  markWebhookEventFailed(stripeEventId: string, error: string): Promise<void>;
  findCheckoutBySessionId(stripeSessionId: string): Promise<CheckoutRecord | null>;
  findCheckoutByPaymentIntentId(stripePaymentIntentId: string): Promise<CheckoutRecord | null>;
  updateCheckoutPaid(input: {
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    stripeCustomerId: string | null;
    amountTotal: number | null;
    currency: string | null;
  }): Promise<void>;
  updateCheckoutStatus(stripeSessionId: string, status: string): Promise<void>;
  applyPointTransaction(input: PointTransactionInput): Promise<{ applied: boolean; transactionId: number; balanceAfter: number }>;
  getPointPackage(packageId: string): PointPackage | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function objectId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

async function handleCheckoutCompleted(deps: StripeWebhookDeps, event: Pick<Stripe.Event, 'id' | 'type' | 'data'>): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') {
    logger.debug('stripe.webhook.checkout_unpaid_ignored', '[stripe] checkout session completed before payment', {
      stripeEventId: event.id,
      stripeSessionId: session.id,
      paymentStatus: session.payment_status,
    });
    await deps.markWebhookEventProcessed(event.id, 'ignored');
    return;
  }

  const checkout = await deps.findCheckoutBySessionId(session.id);
  if (!checkout) throw new Error(`unknown checkout session ${session.id}`);

  const pointPackage = deps.getPointPackage(checkout.packageId);
  if (!pointPackage || pointPackage.stripePriceId !== checkout.stripePriceId || pointPackage.points !== checkout.points) {
    throw new Error(`checkout package mismatch for session ${session.id}`);
  }

  const stripePaymentIntentId = objectId(session.payment_intent);
  const stripeCustomerId = objectId(session.customer);
  await deps.updateCheckoutPaid({
    stripeSessionId: session.id,
    stripePaymentIntentId,
    stripeCustomerId,
    amountTotal: session.amount_total,
    currency: session.currency,
  });

  const result = await deps.applyPointTransaction({
    userId: checkout.userId,
    type: 'stripe_purchase',
    pointsDelta: checkout.points,
    sourceType: 'stripe_checkout_session',
    sourceId: session.id,
    idempotencyKey: `stripe:checkout_session:${session.id}:credit`,
    metadata: {
      packageId: checkout.packageId,
      stripePriceId: checkout.stripePriceId,
      stripeSessionId: session.id,
      stripePaymentIntentId,
      amountTotal: session.amount_total,
      currency: session.currency,
    },
  });

  logger.info('points.credit.applied', '[points] credit applied', {
    userId: checkout.userId,
    stripeSessionId: session.id,
    stripePaymentIntentId,
    pointTransactionId: result.transactionId,
    pointsCredited: checkout.points,
    balanceAfter: result.balanceAfter,
    applied: result.applied,
  });

  await deps.markWebhookEventProcessed(event.id, 'processed');
}

async function handleCheckoutExpired(deps: StripeWebhookDeps, event: Pick<Stripe.Event, 'id' | 'data'>): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  await deps.updateCheckoutStatus(session.id, 'expired');
  await deps.markWebhookEventProcessed(event.id, 'processed');
}

async function handleChargeRefunded(deps: StripeWebhookDeps, event: Pick<Stripe.Event, 'id' | 'data'>): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = objectId(charge.payment_intent);
  if (!paymentIntentId) {
    await deps.markWebhookEventProcessed(event.id, 'ignored');
    return;
  }

  const checkout = await deps.findCheckoutByPaymentIntentId(paymentIntentId);
  if (!checkout) throw new Error(`unknown payment intent ${paymentIntentId}`);

  const result = await deps.applyPointTransaction({
    userId: checkout.userId,
    type: 'stripe_refund',
    pointsDelta: -checkout.points,
    sourceType: 'stripe_charge',
    sourceId: charge.id,
    idempotencyKey: `stripe:charge:${charge.id}:refund`,
    metadata: {
      stripeChargeId: charge.id,
      stripePaymentIntentId: paymentIntentId,
      stripeSessionId: checkout.stripeSessionId,
      packageId: checkout.packageId,
    },
  });

  await deps.updateCheckoutStatus(checkout.stripeSessionId, 'refunded');
  logger.info('points.refund.applied', '[points] refund applied', {
    userId: checkout.userId,
    stripeSessionId: checkout.stripeSessionId,
    stripePaymentIntentId: paymentIntentId,
    pointTransactionId: result.transactionId,
    pointsReversed: checkout.points,
    balanceAfter: result.balanceAfter,
    applied: result.applied,
  });

  await deps.markWebhookEventProcessed(event.id, 'processed');
}

export async function processStripeWebhookEvent(
  deps: StripeWebhookDeps,
  event: Pick<Stripe.Event, 'id' | 'type' | 'data'>,
): Promise<void> {
  const claim = await deps.claimWebhookEvent(event.id, event.type);
  if (claim === 'processed') {
    logger.debug('stripe.webhook.duplicate_ignored', '[stripe] duplicate webhook ignored', {
      stripeEventId: event.id,
      stripeEventType: event.type,
    });
    return;
  }

  logger.info('stripe.webhook.received', '[stripe] webhook received', {
    stripeEventId: event.id,
    stripeEventType: event.type,
  });

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(deps, event);
      return;
    }
    if (event.type === 'checkout.session.expired') {
      await handleCheckoutExpired(deps, event);
      return;
    }
    if (event.type === 'charge.refunded') {
      await handleChargeRefunded(deps, event);
      return;
    }

    await deps.markWebhookEventProcessed(event.id, 'ignored');
  } catch (err) {
    const message = errorMessage(err);
    await deps.markWebhookEventFailed(event.id, message);
    throw err;
  }
}

export async function processStripeWebhookEventInDb(event: Stripe.Event): Promise<void> {
  await processStripeWebhookEvent({
    claimWebhookEvent: async (stripeEventId, eventType) => {
      const [inserted] = await db.insert(stripeWebhookEvents)
        .values({ stripeEventId, eventType, status: 'processing' })
        .onConflictDoNothing()
        .returning({ stripeEventId: stripeWebhookEvents.stripeEventId });

      if (inserted) return 'new';

      const [existing] = await db.select({
        status: stripeWebhookEvents.status,
      }).from(stripeWebhookEvents).where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));

      if (existing?.status === 'processed' || existing?.status === 'ignored') return 'processed';

      await db.update(stripeWebhookEvents)
        .set({ status: 'processing', error: null, updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
      return 'retry';
    },
    markWebhookEventProcessed: async (stripeEventId, status) => {
      await db.update(stripeWebhookEvents)
        .set({ status, processedAt: new Date(), error: null, updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
    },
    markWebhookEventFailed: async (stripeEventId, error) => {
      await db.update(stripeWebhookEvents)
        .set({ status: 'failed', error, updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
    },
    findCheckoutBySessionId: async (stripeSessionId) => {
      const [row] = await db.select({
        id: stripeCheckoutSessions.id,
        userId: stripeCheckoutSessions.userId,
        packageId: stripeCheckoutSessions.packageId,
        stripePriceId: stripeCheckoutSessions.stripePriceId,
        stripeSessionId: stripeCheckoutSessions.stripeSessionId,
        points: stripeCheckoutSessions.points,
      }).from(stripeCheckoutSessions).where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId));
      return row ?? null;
    },
    findCheckoutByPaymentIntentId: async (stripePaymentIntentId) => {
      const [row] = await db.select({
        id: stripeCheckoutSessions.id,
        userId: stripeCheckoutSessions.userId,
        packageId: stripeCheckoutSessions.packageId,
        stripePriceId: stripeCheckoutSessions.stripePriceId,
        stripeSessionId: stripeCheckoutSessions.stripeSessionId,
        points: stripeCheckoutSessions.points,
      }).from(stripeCheckoutSessions).where(eq(stripeCheckoutSessions.stripePaymentIntentId, stripePaymentIntentId));
      return row ?? null;
    },
    updateCheckoutPaid: async (input) => {
      await db.update(stripeCheckoutSessions)
        .set({
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeCustomerId: input.stripeCustomerId,
          amountTotal: input.amountTotal,
          currency: input.currency,
          status: 'paid',
          updatedAt: new Date(),
        })
        .where(eq(stripeCheckoutSessions.stripeSessionId, input.stripeSessionId));
    },
    updateCheckoutStatus: async (stripeSessionId, status) => {
      await db.update(stripeCheckoutSessions)
        .set({ status, updatedAt: new Date() })
        .where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId));
    },
    applyPointTransaction: applyPointTransactionInDb,
    getPointPackage,
  }, event);
}
