import { desc, eq, sql } from 'drizzle-orm';
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
  await db.insert(userPointAccounts)
    .values({ userId, balance: 0 })
    .onConflictDoNothing();

  const [account] = await db
    .select({ balance: userPointAccounts.balance })
    .from(userPointAccounts)
    .where(eq(userPointAccounts.userId, userId));

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
