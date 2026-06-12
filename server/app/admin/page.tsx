import { db } from '@/db';
import {
  user,
  session,
  trips,
  bookingResults,
  bookingPaymentEvents,
  pointTransactions,
  userAuthEvents,
  userPointAccounts,
} from '@/db/schema';
import { count, desc, sql } from 'drizzle-orm';
import { AdminConsole } from './_components/AdminConsole';

export default async function AdminPage() {
  const users = await db
    .select({
      id:            user.id,
      name:          user.name,
      email:         user.email,
      emailVerified: user.emailVerified,
      role:          user.role,
      banned:        user.banned,
      createdAt:     user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  const tripCounts = await db
    .select({ userId: trips.userId, count: count() })
    .from(trips)
    .groupBy(trips.userId);

  const resultCounts = await db
    .select({ userId: bookingResults.userId, count: count() })
    .from(bookingResults)
    .groupBy(bookingResults.userId);

  const paidBookingCounts = await db
    .select({ userId: bookingPaymentEvents.userId, count: count() })
    .from(bookingPaymentEvents)
    .groupBy(bookingPaymentEvents.userId);

  const pointAccounts = await db
    .select({
      userId:    userPointAccounts.userId,
      balance:   userPointAccounts.balance,
      updatedAt: userPointAccounts.updatedAt,
    })
    .from(userPointAccounts);

  const pointStats = await db
    .select({
      userId:           pointTransactions.userId,
      transactionCount: count(),
      pointsEarned:     sql<number>`coalesce(sum(case when ${pointTransactions.pointsDelta} > 0 then ${pointTransactions.pointsDelta} else 0 end), 0)`,
      pointsSpent:      sql<number>`coalesce(sum(case when ${pointTransactions.pointsDelta} < 0 then abs(${pointTransactions.pointsDelta}) else 0 end), 0)`,
      lastTransactionAt: sql<Date | null>`max(${pointTransactions.createdAt})`,
    })
    .from(pointTransactions)
    .groupBy(pointTransactions.userId);

  const sessionStats = await db
    .select({
      userId:         session.userId,
      activeSessions: sql<number>`count(*) filter (where ${session.expiresAt} > now())`,
      lastSessionAt:  sql<Date | null>`max(${session.updatedAt})`,
    })
    .from(session)
    .groupBy(session.userId);

  const authStats = await db
    .select({
      userId:      userAuthEvents.userId,
      authEvents:  count(),
      lastAuthAt:  sql<Date | null>`max(${userAuthEvents.createdAt})`,
    })
    .from(userAuthEvents)
    .groupBy(userAuthEvents.userId);

  const tripCountMap = Object.fromEntries(tripCounts.map(r => [r.userId, r.count]));
  const resultCountMap = Object.fromEntries(resultCounts.map(r => [r.userId, r.count]));
  const paidBookingCountMap = Object.fromEntries(paidBookingCounts.map(r => [r.userId, r.count]));
  const pointAccountMap = new Map(pointAccounts.map(r => [r.userId, r]));
  const pointStatsMap = new Map(pointStats.map(r => [r.userId, r]));
  const sessionStatsMap = new Map(sessionStats.map(r => [r.userId, r]));
  const authStatsMap = new Map(authStats.map(r => [r.userId, r]));

  return <AdminConsole users={users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    role: u.role,
    banned: u.banned ?? false,
    createdAt: u.createdAt.toISOString(),
    trips: Number(tripCountMap[u.id] ?? 0),
    bookingResults: Number(resultCountMap[u.id] ?? 0),
    paidBookings: Number(paidBookingCountMap[u.id] ?? 0),
    pointBalance: Number(pointAccountMap.get(u.id)?.balance ?? 0),
    pointsEarned: Number(pointStatsMap.get(u.id)?.pointsEarned ?? 0),
    pointsSpent: Number(pointStatsMap.get(u.id)?.pointsSpent ?? 0),
    pointTransactions: Number(pointStatsMap.get(u.id)?.transactionCount ?? 0),
    activeSessions: Number(sessionStatsMap.get(u.id)?.activeSessions ?? 0),
    authEvents: Number(authStatsMap.get(u.id)?.authEvents ?? 0),
    lastActivityAt: latestIso([
      pointAccountMap.get(u.id)?.updatedAt,
      pointStatsMap.get(u.id)?.lastTransactionAt,
      sessionStatsMap.get(u.id)?.lastSessionAt,
      authStatsMap.get(u.id)?.lastAuthAt,
    ]),
  }))} />;
}

type DateLike = Date | string | number | null | undefined;

function latestIso(values: DateLike[]): string | null {
  const timestamps = values
    .map(toTimestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function toTimestamp(value: DateLike): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
