import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { normalizeBookingPaymentEventBody, recordBookingPaymentEventInDb } from '@/lib/booking-payment-events';
import { getSuccessfulBookingPointCost } from '@/lib/points-config';
import { buildRequestContext, normalizeRequestClientInfo } from '@/lib/request-context';
import { getSession } from '@/lib/session';

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
    console.warn('[booking-payment] missing confirmation number', {
      event: 'booking_payment.missing_confirmation_number',
      userId: session.user.id,
      userEmail: session.user.email,
      idempotencyKey: event.idempotencyKey,
    });
  }

  console.info('[booking-payment] received', {
    event: 'booking_payment.received',
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
