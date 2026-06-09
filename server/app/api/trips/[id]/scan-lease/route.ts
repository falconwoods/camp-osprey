import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getSession } from '@/lib/session';
import { createScanLease } from '@/lib/scan-lease';

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
