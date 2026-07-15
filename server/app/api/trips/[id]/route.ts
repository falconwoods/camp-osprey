import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { decodeDateRanges, decodeTripMode, decodeTripStatus } from '@/lib/extension-protocol';

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const { id } = await params;
  const body = await request.json() as Partial<{
    clientId: string;
    name: string;
    provider: string;
    parks: unknown;
    dateRanges: unknown;
    filters: unknown;
    mode: string;
    modeCode: number;
    status: string;
    statusCode: number;
    lastMatch: unknown;
    attempted: string[];
    createdAt: string | number;
    updatedAt: string | number;
    deletedAt: string | number | null;
  }>;

  const { clientId, name, provider, parks, dateRanges, filters, lastMatch, attempted } = body;
  const input = body as Record<string, unknown>;
  const mode = decodeTripMode(input, body.mode);
  const status = decodeTripStatus(input, body.status);
  const createdAt = parseDate(body.createdAt) ?? new Date();
  const updatedAt = parseDate(body.updatedAt) ?? new Date();
  const deletedAt = body.deletedAt === null ? null : parseDate(body.deletedAt);

  const [trip] = await db
    .update(trips)
    .set({ clientId, name, provider: provider ?? 'bc_parks', parks, dateRanges: decodeDateRanges(dateRanges), filters, mode, status, lastMatch, attempted, deletedAt, updatedAt })
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)))
    .returning();

  if (trip) return withExtensionCors(request, NextResponse.json(trip));

  if (!name || !parks || !dateRanges || !filters || !mode) {
    return withExtensionCors(request, NextResponse.json({ error: 'Not found' }, { status: 404 }));
  }

  const [createdTrip] = await db.insert(trips).values({
    id,
    userId: session.user.id,
    clientId,
    name,
    provider: provider ?? 'bc_parks',
    parks,
    dateRanges: decodeDateRanges(dateRanges),
    filters,
    mode,
    status: status ?? 'idle',
    lastMatch: lastMatch ?? null,
    attempted: attempted ?? [],
    deletedAt,
    createdAt,
    updatedAt,
  }).returning();

  return withExtensionCors(request, NextResponse.json(createdTrip, { status: 201 }));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    clientId?: string;
    deletedAt?: string | number;
  };
  const deletedAt = parseDate(body.deletedAt) ?? new Date();

  const [trip] = await db
    .update(trips)
    .set({ clientId: body.clientId, deletedAt, status: 'paused', updatedAt: deletedAt })
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)))
    .returning();

  if (!trip) return withExtensionCors(request, NextResponse.json({ error: 'Not found' }, { status: 404 }));
  return withExtensionCors(request, NextResponse.json({ ok: true }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
