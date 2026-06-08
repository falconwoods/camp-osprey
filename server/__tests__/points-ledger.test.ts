import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  bookingPaymentEvents: {},
  pointTransactions: {},
  userPointAccounts: {},
}));

vi.mock('@/lib/points-config', () => ({
  getPointPackage: (id: string) => id === 'starter'
    ? { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' }
    : null,
}));

describe('applyPointTransaction', () => {
  it('applies a credit against the locked balance', async () => {
    const { applyPointTransaction } = await import('../lib/points-ledger');
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
    expect(deps.ensureAccount).toHaveBeenCalledWith('user-1');
    expect(deps.lockAccount).toHaveBeenCalledWith('user-1');
    expect(deps.updateBalance).toHaveBeenCalledWith('user-1', 110);
  });

  it('returns the existing transaction for a duplicate idempotency key', async () => {
    const { applyPointTransaction } = await import('../lib/points-ledger');
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

  it('formats user-facing transaction details', async () => {
    const { pointTransactionDetails } = await import('../lib/points-ledger');

    expect(pointTransactionDetails({
      type: 'stripe_purchase',
      pointsDelta: 500,
      metadata: { packageId: 'starter' },
    })).toBe('Starter Package purchase');

    expect(pointTransactionDetails({
      type: 'stripe_purchase',
      pointsDelta: 1000,
      metadata: { packageId: 'standard' },
    })).toBe('Standard Package purchase');

    expect(pointTransactionDetails({
      type: 'booking_charge',
      pointsDelta: -100,
      metadata: {
        parkName: 'Gold Creek',
        campgroundName: 'Main',
        siteName: '27',
        checkIn: '2026-06-12',
        checkOut: '2026-06-14',
      },
    })).toBe('Gold Creek, Main · Site 27 · Jun 12-14');
  });
});
