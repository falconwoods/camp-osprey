import { NextResponse } from 'next/server';
import { db } from '@/db';
import { trips, bookingResults } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { sendEmail, buildResultEmail } from '@/lib/email';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';

type Outcome = 'found' | 'hold_placed' | 'booked' | 'failed';

interface MatchedSite {
  parkName: string;
  siteName: string;
  sectionName?: string;
  checkIn: string;
  checkOut: string;
  bookingUrl: string;
  resourceId: string;
  foundAt?: string;
  reservedAt?: string;
  paidAt?: string;
}

interface TripSnapshot {
  name: string;
  parks: unknown;
  dateRanges: unknown;
  filters: unknown;
  mode: string;
  status?: string;
  attempted?: string[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  const { id } = await params;

  const body = await request.json() as {
    outcome: Outcome;
    matchedSite?: MatchedSite;
    error?: string;
    tripSnapshot?: TripSnapshot;
  };

  const { outcome, matchedSite, error: bookingError, tripSnapshot } = body;
  let [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)));

  if (!trip && tripSnapshot) {
    [trip] = await db.insert(trips).values({
      id,
      userId:     session.user.id,
      name:       tripSnapshot.name,
      parks:      tripSnapshot.parks,
      dateRanges: tripSnapshot.dateRanges,
      filters:    tripSnapshot.filters,
      mode:       tripSnapshot.mode,
      status:     tripSnapshot.status ?? 'idle',
      lastMatch:  matchedSite ?? null,
      attempted:  tripSnapshot.attempted ?? [],
    }).returning();

    console.info('[result] created missing trip from result payload:', {
      tripId: id,
      userId: session.user.id,
      name: trip.name,
    });
  }

  if (!trip) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Not found' }, { status: 404 }),
    );
  }
  const resultContext = {
    tripId: id,
    userId: session.user.id,
    outcome,
    parkName: matchedSite?.parkName,
    sectionName: matchedSite?.sectionName,
    siteName: matchedSite?.siteName,
    checkIn: matchedSite?.checkIn,
    checkOut: matchedSite?.checkOut,
  };

  console.info('[result] received booking result:', resultContext);

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
    console.info('[result] email sent:', {
      ...resultContext,
      bookingResultId: result.id,
      to: session.user.email,
      subject,
    });
    await db
      .update(bookingResults)
      .set({ emailSent: true })
      .where(eq(bookingResults.id, result.id));
  } catch (err) {
    console.error('[result] email send failed:', {
      ...resultContext,
      bookingResultId: result.id,
      to: session.user.email,
      error: err,
    });
  }

  return withExtensionCors(request, NextResponse.json({ ok: true, emailSent }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
