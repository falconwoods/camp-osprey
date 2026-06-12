import { db } from '@/db';
import { user, trips, bookingResults } from '@/db/schema';
import { count, desc } from 'drizzle-orm';
import { AdminConsole } from './_components/AdminConsole';

export default async function AdminPage() {
  const users = await db
    .select({
      id:        user.id,
      email:     user.email,
      createdAt: user.createdAt,
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

  const tripCountMap = Object.fromEntries(tripCounts.map(r => [r.userId, r.count]));
  const resultCountMap = Object.fromEntries(resultCounts.map(r => [r.userId, r.count]));

  return <AdminConsole users={users.map(u => ({
    id: u.id,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    trips: Number(tripCountMap[u.id] ?? 0),
    bookingResults: Number(resultCountMap[u.id] ?? 0),
  }))} />;
}
