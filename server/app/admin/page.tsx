import { db } from '@/db';
import { user, trips, bookingResults } from '@/db/schema';
import { count, desc } from 'drizzle-orm';

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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Users ({users.length})</h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="pb-2 pr-4">Email</th>
            <th className="pb-2 pr-4">Trips</th>
            <th className="pb-2 pr-4">Booking results</th>
            <th className="pb-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-900">{u.email}</td>
              <td className="py-2 pr-4 text-gray-600">{tripCountMap[u.id] ?? 0}</td>
              <td className="py-2 pr-4 text-gray-600">{resultCountMap[u.id] ?? 0}</td>
              <td className="py-2 text-gray-400">{u.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
