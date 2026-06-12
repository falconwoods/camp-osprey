import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bookingPaymentEvents, pointTransactions, userPointAccounts } from '@/db/schema';
import { getPointPackage } from '@/lib/points-config';
import { logger } from './loki';

export type PointTransactionType =
  | 'stripe_purchase'
  | 'booking_charge'
  | 'stripe_refund'
  | 'stripe_dispute'
  | 'admin_adjustment'
  | 'recharge_code';

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
    logger.debug('points.transaction.duplicate_ignored', '[points] duplicate transaction ignored', {
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
      const account = (rows as unknown as Array<{ userId: string; balance: number }>)[0];
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
    details: string;
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
    metadata: pointTransactions.metadata,
    createdAt: pointTransactions.createdAt,
  }).from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt));

  const bookingEventIds = recentTransactions
    .filter(tx => tx.type === 'booking_charge' && tx.sourceType === 'booking_payment_event')
    .map(tx => Number(tx.sourceId))
    .filter(Number.isInteger);
  const bookingEvents = bookingEventIds.length > 0
    ? await db.select({
      id: bookingPaymentEvents.id,
      provider: bookingPaymentEvents.provider,
      parkName: bookingPaymentEvents.parkName,
      campgroundName: bookingPaymentEvents.campgroundName,
      sectionName: bookingPaymentEvents.sectionName,
      siteName: bookingPaymentEvents.siteName,
      checkIn: bookingPaymentEvents.checkIn,
      checkOut: bookingPaymentEvents.checkOut,
      confirmationNumber: bookingPaymentEvents.confirmationNumber,
    }).from(bookingPaymentEvents)
      .where(inArray(bookingPaymentEvents.id, bookingEventIds))
    : [];
  const bookingEventById = new Map(bookingEvents.map(event => [event.id, event]));

  return {
    balance: account?.balance ?? 0,
    recentTransactions: recentTransactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      pointsDelta: tx.pointsDelta,
      balanceAfter: tx.balanceAfter,
      sourceType: tx.sourceType,
      sourceId: tx.sourceId,
      details: pointTransactionDetails(tx, bookingEventById.get(Number(tx.sourceId))),
      createdAt: tx.createdAt,
    })),
  };
}

type PointTransactionSummaryRow = {
  type: string;
  pointsDelta: number;
  metadata: unknown;
};

type BookingDetailsSource = {
  provider?: string | null;
  parkName?: string | null;
  campgroundName?: string | null;
  sectionName?: string | null;
  siteName?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  confirmationNumber?: string | null;
};

export function pointTransactionDetails(tx: PointTransactionSummaryRow, bookingEvent?: BookingDetailsSource): string {
  const metadata = objectMetadata(tx.metadata);
  if (tx.type === 'booking_charge') {
    return bookingDetails({ ...bookingEvent, ...metadata });
  }

  const packageId = stringValue(metadata.packageId);
  const pointPackage = packageId ? getPointPackage(packageId) : null;
  const packageName = packageDisplayName(pointPackage?.name ?? (packageId ? titleCase(packageId) : null));
  if (tx.type === 'stripe_purchase') {
    return packageName ? `${packageName} purchase` : 'Point package purchase';
  }
  if (tx.type === 'stripe_refund') {
    return packageName ? `${packageName} refund` : 'Point package refund';
  }
  if (tx.type === 'stripe_dispute') return 'Payment dispute adjustment';
  if (tx.type === 'admin_adjustment') {
    const reason = stringValue(metadata.reason);
    const label = tx.pointsDelta >= 0 ? 'Manual points credit' : 'Manual points deduction';
    return reason ? `${label}: ${reason}` : label;
  }
  if (tx.type === 'recharge_code') return 'Recharge code redemption';
  return 'Account activity';
}

function packageDisplayName(name: string | null): string | null {
  if (!name) return null;
  return name.toLowerCase().includes('package') ? name : `${name} Package`;
}

function bookingDetails(source: BookingDetailsSource): string {
  const place = [source.parkName, source.campgroundName, source.sectionName]
    .map(value => stringValue(value))
    .filter(Boolean)
    .join(', ');
  const site = stringValue(source.siteName);
  const dates = bookingDateRange(stringValue(source.checkIn), stringValue(source.checkOut));
  const confirmation = stringValue(source.confirmationNumber);
  const parts = [
    place,
    site ? `Site ${site}` : null,
    dates,
    confirmation ? `Confirmation ${confirmation}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Successful booking deduction';
}

function bookingDateRange(checkIn: string | null, checkOut: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const start = dateFromYmd(checkIn);
  const end = dateFromYmd(checkOut);
  if (!start || !end) return `${checkIn} to ${checkOut}`;

  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) return `${monthDay.format(start)}-${end.getUTCDate()}`;
  return `${monthDay.format(start)}-${monthDay.format(end)}`;
}

function dateFromYmd(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}
