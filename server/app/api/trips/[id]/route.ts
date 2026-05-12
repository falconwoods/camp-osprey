import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as Partial<{
    name: string;
    parks: unknown;
    dateRanges: unknown;
    filters: unknown;
    mode: string;
    status: string;
    lastMatch: unknown;
    attempted: string[];
  }>;

  const [trip] = await db
    .update(trips)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)))
    .returning();

  if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(trip);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [trip] = await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)))
    .returning();

  if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
