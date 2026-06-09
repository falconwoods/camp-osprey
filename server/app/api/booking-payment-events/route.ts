import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { trips } from '@/db/schema';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { normalizeBookingPaymentEventBody, recordBookingPaymentEventInDb } from '@/lib/booking-payment-events';
import { getSuccessfulBookingPointCost } from '@/lib/points-config';
import { buildRequestContext, normalizeRequestClientInfo } from '@/lib/request-context';
import { getSession } from '@/lib/session';
import { logger } from '../../../lib/loki';
import { verifyScanLease } from '../../../lib/scan-lease';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const body = await request.json().catch(() => ({}));
  let event;
  try {
    event = normalizeBookingPaymentEventBody(body);
  } catch (err) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: err instanceof Error ? err.message : 'invalid_payload' }, { status: 400 }),
    );
  }

  if (!event.confirmationNumber) {
    logger.warn('booking_payment.missing_confirmation_number', '[booking-payment] missing confirmation number', {
      userId: session.user.id,
      userEmail: session.user.email,
      idempotencyKey: event.idempotencyKey,
    });
  }

  logger.info('booking_payment.received', '[booking-payment] received', {
    userId: session.user.id,
    userEmail: session.user.email,
    tripId: event.tripId,
    confirmationNumber: event.confirmationNumber,
    idempotencyKey: event.idempotencyKey,
  });

  const requestContext = await buildRequestContext(
    request,
    typeof (body as { clientId?: unknown }).clientId === 'string' ? (body as { clientId: string }).clientId : undefined,
    normalizeRequestClientInfo(body),
  );
  const clientId = typeof (body as { clientId?: unknown }).clientId === 'string'
    ? (body as { clientId: string }).clientId
    : undefined;

  if (!event.tripId) {
    return withExtensionCors(request, NextResponse.json({ error: 'tripId_required' }, { status: 400 }));
  }

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, event.tripId), eq(trips.userId, session.user.id)));

  if (!trip) {
    return withExtensionCors(request, NextResponse.json({ error: 'Trip not found' }, { status: 404 }));
  }

  try {
    verifyScanLease({
      lease: (body as { scanLease?: unknown }).scanLease,
      userId: session.user.id,
      trip,
      clientId,
    });
  } catch (err) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: err instanceof Error ? err.message : 'invalid_scan_lease' }, { status: 403 }),
    );
  }

  const result = await recordBookingPaymentEventInDb({
    userId: session.user.id,
    userEmail: session.user.email,
    event,
    pointCost: getSuccessfulBookingPointCost(),
    requestContext,
  });

  return withExtensionCors(request, NextResponse.json({
    ok: true,
    bookingPaymentEventId: result.bookingPaymentEventId,
    chargeStatus: result.chargeStatus,
    pointTransactionId: result.pointTransactionId,
    balanceAfter: result.balanceAfter,
    duplicate: result.duplicate,
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
