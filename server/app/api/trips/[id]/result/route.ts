import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips, bookingResults } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { sendEmail, buildResultEmail } from '@/lib/email';

type Outcome = 'found' | 'hold_placed' | 'booked' | 'failed';

interface MatchedSite {
  parkName: string;
  siteName: string;
  sectionName: string;
  checkIn: string;
  checkOut: string;
  bookingUrl: string;
  resourceId: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)));

  if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json() as {
    outcome: Outcome;
    matchedSite?: MatchedSite;
    error?: string;
  };

  const { outcome, matchedSite, error: bookingError } = body;

  const statusMap: Record<Outcome, string> = {
    found:       trip.status as string,
    hold_placed: 'paused',
    booked:      'completed',
    failed:      'idle',
  };

  await db
    .update(trips)
    .set({
      status:    statusMap[outcome],
      lastMatch: matchedSite ?? trip.lastMatch,
      updatedAt: new Date(),
    })
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)));

  const [result] = await db
    .insert(bookingResults)
    .values({
      tripId:      id,
      userId:      session.user.id,
      outcome,
      matchedSite: matchedSite ?? null,
      error:       bookingError ?? null,
      emailSent:   false,
    })
    .returning();

  let emailSent = false;
  try {
    const { subject, html } = buildResultEmail(
      outcome,
      matchedSite ?? null,
      trip.name,
      session.user.name,
    );
    await sendEmail({ to: session.user.email, subject, html });
    emailSent = true;
    await db
      .update(bookingResults)
      .set({ emailSent: true })
      .where(eq(bookingResults.id, result.id));
  } catch (err) {
    console.error('[result] email send failed:', err);
  }

  return NextResponse.json({ ok: true, emailSent });
}
