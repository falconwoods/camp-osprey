import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db.select().from(trips).where(eq(trips.userId, session.user.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    id: string;
    name: string;
    parks: unknown;
    dateRanges: unknown;
    filters: unknown;
    mode: string;
  };

  try {
    const [trip] = await db.insert(trips).values({
      id:         body.id,
      userId:     session.user.id,
      name:       body.name,
      parks:      body.parks,
      dateRanges: body.dateRanges,
      filters:    body.filters,
      mode:       body.mode,
      status:     'idle',
      lastMatch:  null,
      attempted:  [],
    }).returning();

    return NextResponse.json(trip, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      return NextResponse.json({ error: 'Trip ID already exists' }, { status: 409 });
    }
    throw err;
  }
}
