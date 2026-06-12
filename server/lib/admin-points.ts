import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { pointTransactions, user, userPointAccounts } from '@/db/schema';
import { logger } from '@/lib/loki';

export class AdminPointAdjustmentError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export type AdminPointDeductionInput = {
  userId: string;
  adminUserId: string;
  points: unknown;
  reason: unknown;
};

export async function deductUserPoints(input: AdminPointDeductionInput): Promise<{
  transactionId: number;
  userId: string;
  pointsDeducted: number;
  balanceAfter: number;
}> {
  const userId = normalizeUserId(input.userId);
  const adminUserId = normalizeUserId(input.adminUserId);
  const points = normalizePositiveInteger(input.points, 'points');
  const reason = normalizeReason(input.reason);
  const adjustmentId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    const [targetUser] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!targetUser) throw new AdminPointAdjustmentError('user_not_found', 404);

    await tx.insert(userPointAccounts)
      .values({ userId, balance: 0 })
      .onConflictDoNothing();

    const rows = await tx.execute(sql<{ userId: string; balance: number }>`
      select "userId", balance
      from user_point_accounts
      where "userId" = ${userId}
      for update
    `);
    const account = (rows as unknown as Array<{ userId: string; balance: number }>)[0];
    if (!account) throw new AdminPointAdjustmentError('point_account_not_found', 404);
    if (Number(account.balance) < points) throw new AdminPointAdjustmentError('insufficient_points');

    const balanceAfter = Number(account.balance) - points;
    const [transaction] = await tx.insert(pointTransactions).values({
      userId,
      type: 'admin_adjustment',
      pointsDelta: -points,
      balanceAfter,
      sourceType: 'admin_manual_deduction',
      sourceId: adjustmentId,
      idempotencyKey: `admin_manual_deduction:${adjustmentId}`,
      metadata: {
        reason,
        adminUserId,
        adjustmentId,
      },
    }).returning({ id: pointTransactions.id });

    await tx.update(userPointAccounts)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(userPointAccounts.userId, userId));

    logger.info('admin.points.deducted', '[admin] points deducted', {
      adminUserId,
      userId,
      pointsDeducted: points,
      balanceAfter,
      pointTransactionId: transaction.id,
    });

    return {
      transactionId: transaction.id,
      userId,
      pointsDeducted: points,
      balanceAfter,
    };
  });
}

function normalizeUserId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new AdminPointAdjustmentError('invalid_user');
  return value.trim();
}

function normalizePositiveInteger(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new AdminPointAdjustmentError(`invalid_${field}`);
  return number;
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') throw new AdminPointAdjustmentError('invalid_reason');
  const reason = value.trim();
  if (!reason) throw new AdminPointAdjustmentError('invalid_reason');
  return reason.slice(0, 500);
}
