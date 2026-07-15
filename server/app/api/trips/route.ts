import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { decodeDateRanges, decodeTripMode, decodeTripStatus } from '@/lib/extension-protocol';

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const rows = await db
    .select()
    .from(trips)
    .where(includeDeleted ? eq(trips.userId, session.user.id) : and(eq(trips.userId, session.user.id), isNull(trips.deletedAt)))
    .orderBy(desc(trips.createdAt));
  return withExtensionCors(request, NextResponse.json(rows));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const body = await request.json() as {
    id: string;
    clientId?: string;
    name: string;
    provider?: string;
    parks: unknown;
    dateRanges: unknown;
    filters: unknown;
    mode?: string;
    modeCode?: number;
    status?: string;
    statusCode?: number;
    lastMatch?: unknown;
    attempted?: string[];
    createdAt?: string | number;
    updatedAt?: string | number;
    deletedAt?: string | number | null;
  };
  const createdAt = parseDate(body.createdAt) ?? new Date();
  const updatedAt = parseDate(body.updatedAt) ?? createdAt;
  const deletedAt = body.deletedAt === null ? null : parseDate(body.deletedAt);
  const input = body as unknown as Record<string, unknown>;
  const mode = decodeTripMode(input, body.mode);
  if (!mode) return withExtensionCors(request, NextResponse.json({ error: 'invalid_trip_mode' }, { status: 400 }));
  const tripStatus = decodeTripStatus(input, body.status) ?? 'idle';

  try {
    const [trip] = await db.insert(trips).values({
      id:         body.id,
      userId:     session.user.id,
      clientId:   body.clientId,
      name:       body.name,
      provider:   body.provider ?? 'bc_parks',
      parks:      body.parks,
      dateRanges: decodeDateRanges(body.dateRanges),
      filters:    body.filters,
      mode,
      status:     tripStatus,
      lastMatch:  body.lastMatch ?? null,
      attempted:  body.attempted ?? [],
      deletedAt,
      createdAt,
      updatedAt,
    }).returning();

    return withExtensionCors(request, NextResponse.json(trip, { status: 201 }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      return withExtensionCors(request, NextResponse.json({ error: 'Trip ID already exists' }, { status: 409 }));
    }
    throw err;
  }
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
