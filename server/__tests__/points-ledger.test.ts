import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  pointTransactions: {},
  userPointAccounts: {},
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
});
