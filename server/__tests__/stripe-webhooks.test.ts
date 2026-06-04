import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  stripeCheckoutSessions: {},
  stripeWebhookEvents: {},
}));

vi.mock('@/lib/points-config', () => ({
  getPointPackage: vi.fn(),
}));

vi.mock('@/lib/points-ledger', () => ({
  applyPointTransactionInDb: vi.fn(),
}));

describe('processStripeWebhookEvent', () => {
  it('ignores already processed Stripe events', async () => {
    const { processStripeWebhookEvent } = await import('../lib/stripe-webhooks');
    const deps = {
      claimWebhookEvent: vi.fn(async () => 'processed' as const),
      markWebhookEventProcessed: vi.fn(),
      markWebhookEventFailed: vi.fn(),
      findCheckoutBySessionId: vi.fn(),
      findCheckoutByPaymentIntentId: vi.fn(),
      updateCheckoutPaid: vi.fn(),
      updateCheckoutStatus: vi.fn(),
      applyPointTransaction: vi.fn(),
      getPointPackage: vi.fn(),
    };

    await processStripeWebhookEvent(deps, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1' } },
    });

    expect(deps.findCheckoutBySessionId).not.toHaveBeenCalled();
    expect(deps.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('credits points for a paid checkout session exactly once', async () => {
    const { processStripeWebhookEvent } = await import('../lib/stripe-webhooks');
    const deps = {
      claimWebhookEvent: vi.fn(async () => 'new' as const),
      markWebhookEventProcessed: vi.fn(async () => undefined),
      markWebhookEventFailed: vi.fn(async () => undefined),
      findCheckoutBySessionId: vi.fn(async () => ({
        id: 3,
        userId: 'user-1',
        packageId: 'starter',
        stripePriceId: 'price_123',
        stripeSessionId: 'cs_123',
        points: 500,
      })),
      findCheckoutByPaymentIntentId: vi.fn(),
      updateCheckoutPaid: vi.fn(async () => undefined),
      updateCheckoutStatus: vi.fn(async () => undefined),
      applyPointTransaction: vi.fn(async () => ({ applied: true, transactionId: 8, balanceAfter: 500 })),
      getPointPackage: vi.fn(() => ({
        id: 'starter',
        name: 'Starter',
        points: 500,
        priceLabel: 'CAD 5',
        stripePriceId: 'price_123',
      })),
    };

    await processStripeWebhookEvent(deps, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          amount_total: 2500,
          currency: 'cad',
          payment_intent: 'pi_123',
          customer: 'cus_123',
        },
      },
    });

    expect(deps.applyPointTransaction).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'stripe_purchase',
      pointsDelta: 500,
      sourceType: 'stripe_checkout_session',
      sourceId: 'cs_123',
      idempotencyKey: 'stripe:checkout_session:cs_123:credit',
      metadata: expect.objectContaining({
        packageId: 'starter',
        stripePriceId: 'price_123',
        stripePaymentIntentId: 'pi_123',
      }),
    });
    expect(deps.markWebhookEventProcessed).toHaveBeenCalledWith('evt_1', 'processed');
  });

  it('marks failed events and rethrows so Stripe retries', async () => {
    const { processStripeWebhookEvent } = await import('../lib/stripe-webhooks');
    const deps = {
      claimWebhookEvent: vi.fn(async () => 'new' as const),
      markWebhookEventProcessed: vi.fn(),
      markWebhookEventFailed: vi.fn(async () => undefined),
      findCheckoutBySessionId: vi.fn(async () => null),
      findCheckoutByPaymentIntentId: vi.fn(),
      updateCheckoutPaid: vi.fn(),
      updateCheckoutStatus: vi.fn(),
      applyPointTransaction: vi.fn(),
      getPointPackage: vi.fn(),
    };

    await expect(processStripeWebhookEvent(deps, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_missing', payment_status: 'paid' } },
    })).rejects.toThrow('unknown checkout session');

    expect(deps.markWebhookEventFailed).toHaveBeenCalledWith('evt_1', expect.stringContaining('unknown checkout session'));
  });
});
