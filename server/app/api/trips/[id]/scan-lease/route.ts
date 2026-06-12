import { NextResponse } from 'next/server';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import { trips } from '@/db/schema';
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

  const [activeTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.userId, session.user.id),
      ne(trips.id, id),
      isNull(trips.deletedAt),
      inArray(trips.status, ['scanning', 'reserving']),
    ))
    .limit(1);

  if (activeTrip) {
    return withExtensionCors(request, NextResponse.json({ error: 'active_trip_exists' }, { status: 409 }));
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
