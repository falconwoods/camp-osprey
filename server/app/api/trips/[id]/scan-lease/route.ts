import { NextResponse } from 'next/server';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import { trips, user } from '@/db/schema';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointAccountSummary } from '@/lib/points-ledger';
import { getSuccessfulBookingPointCost } from '@/lib/points-config';
import { getSession } from '@/lib/session';
import { createScanLease } from '@/lib/scan-lease';

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
  const body = await request.json().catch(() => ({})) as { clientId?: unknown };
  const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : undefined;

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id), isNull(trips.deletedAt)));

  if (!trip) return withExtensionCors(request, NextResponse.json({ error: 'Not found' }, { status: 404 }));

  const [userLimits] = await db
    .select({ maxActiveTrips: user.maxActiveTrips })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  const maxActiveTrips = Math.max(1, userLimits?.maxActiveTrips ?? 1);

  const [activeTripCount] = await db
    .select({ count: count() })
    .from(trips)
    .where(and(
      eq(trips.userId, session.user.id),
      ne(trips.id, id),
      isNull(trips.deletedAt),
      inArray(trips.status, ['scanning', 'reserving']),
    ));

  if ((activeTripCount?.count ?? 0) >= maxActiveTrips) {
    return withExtensionCors(request, NextResponse.json({
      error: 'active_trip_exists',
      activeTripCount: activeTripCount?.count ?? 0,
      maxActiveTrips,
    }, { status: 409 }));
  }

  if (requiresBookingPoints(trip.mode)) {
    const requiredPoints = getSuccessfulBookingPointCost();
    const points = await getPointAccountSummary(session.user.id);
    if (points.balance < requiredPoints) {
      return withExtensionCors(request, NextResponse.json({
        error: 'insufficient_points',
        balance: points.balance,
        requiredPoints,
      }, { status: 402 }));
    }
  }

  const { lease, payload } = createScanLease({
    userId: session.user.id,
    trip,
    clientId,
  });

  return withExtensionCors(request, NextResponse.json({
    lease,
    leaseId: payload.leaseId,
    expiresAt: payload.expiresAt,
    tripHash: payload.tripHash,
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
