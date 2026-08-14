import { NextResponse } from 'next/server';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { trips, user, userPointAccounts } from '@/db/schema';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getSuccessfulBookingPointCost } from '@/lib/points-config';
import { getSession } from '@/lib/session';
import { createScanLease } from '@/lib/scan-lease';

class StartTripError extends Error {
  constructor(
    public readonly code: 'active_trip_exists' | 'insufficient_points' | 'trip_already_active',
    public readonly details: Record<string, number> = {},
  ) {
    super(code);
  }
}

function requiresBookingPoints(mode: string): boolean {
  return mode === 'reserve' || mode === 'autopay';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { clientId?: unknown; reconnect?: unknown };
  const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : undefined;
  const reconnect = body.reconnect === true;

  try {
    const result = await db.transaction(async (tx) => {
      // Every operation that changes a user's active-trip count locks this row.
      await tx.execute(sql`select "id" from "user" where "id" = ${session.user.id} for update`);

      const [trip] = await tx
        .select()
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.userId, session.user.id), isNull(trips.deletedAt)));

      if (!trip) return null;
      const alreadyActive = ['scanning', 'reserving'].includes(trip.status);
      if (alreadyActive && !reconnect) {
        throw new StartTripError('trip_already_active');
      }
      const reconnecting = alreadyActive && reconnect;

      const [activeTripCount] = await tx
        .select({ count: count() })
        .from(trips)
        .where(and(
          eq(trips.userId, session.user.id),
          ne(trips.id, id),
          isNull(trips.deletedAt),
          inArray(trips.status, ['scanning', 'reserving']),
        ));
      const activeCount = Number(activeTripCount?.count ?? 0);
      const [activeBookingTripCount] = await tx
        .select({ count: count() })
        .from(trips)
        .where(and(
          eq(trips.userId, session.user.id),
          ne(trips.id, id),
          isNull(trips.deletedAt),
          inArray(trips.status, ['scanning', 'reserving']),
          inArray(trips.mode, ['reserve', 'autopay']),
        ));
      const activeBookingCount = Number(activeBookingTripCount?.count ?? 0);

      const [userLimits] = await tx
        .select({ maxActiveTrips: user.maxActiveTrips })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);
      const maxActiveTrips = Math.max(1, userLimits?.maxActiveTrips ?? 5);

      if (activeCount >= maxActiveTrips) {
        throw new StartTripError('active_trip_exists', { activeTripCount: activeCount, maxActiveTrips });
      }

      let balance: number | null = null;
      if (requiresBookingPoints(trip.mode)) {
        await tx.insert(userPointAccounts)
          .values({ userId: session.user.id, balance: 0 })
          .onConflictDoNothing();
        const pointRows = await tx.execute(sql<{ balance: number }>`
          select balance from user_point_accounts where "userId" = ${session.user.id} for update
        `);
        balance = Number((pointRows as unknown as Array<{ balance: number }>)[0]?.balance ?? 0);
        const requiredPoints = getSuccessfulBookingPointCost();
        const availablePoints = balance - activeBookingCount * requiredPoints;
        if (availablePoints < requiredPoints) {
          throw new StartTripError('insufficient_points', {
            balance,
            activeBookingTripCount: activeBookingCount,
            occupiedPoints: activeBookingCount * requiredPoints,
            requiredPoints,
          });
        }
      }

      const { lease, payload } = createScanLease({ userId: session.user.id, trip, clientId });
      const [startedTrip] = await tx
        .update(trips)
        .set({
          status: 'scanning',
          ...(reconnecting ? {} : { lastMatch: null, attempted: [] }),
          updatedAt: new Date(),
        })
        .where(eq(trips.id, id))
        .returning({ updatedAt: trips.updatedAt });

      return { lease, payload, updatedAt: startedTrip?.updatedAt ?? new Date(), balance };
    });

    if (!result) return withExtensionCors(request, NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withExtensionCors(request, NextResponse.json({
      lease: result.lease,
      leaseId: result.payload.leaseId,
      expiresAt: result.payload.expiresAt,
      tripHash: result.payload.tripHash,
      updatedAt: result.updatedAt,
    }));
  } catch (err) {
    if (err instanceof StartTripError) {
      const status = err.code === 'insufficient_points' ? 402 : 409;
      return withExtensionCors(request, NextResponse.json({ error: err.code, ...err.details }, { status }));
    }
    throw err;
  }
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
