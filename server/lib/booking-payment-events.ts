import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  bookingPaymentEvents,
  bookingPointCharges,
  pointTransactions,
  userPointAccounts,
} from '@/db/schema';
import type { RequestContext } from '@/lib/request-context';
import { logger } from './loki';
import { decodeProvider, decodeRawProviderSnapshot } from './extension-protocol';

type BookingProvider = 'bc_parks' | 'parks_canada';

export interface NormalizedBookingPaymentEvent {
  tripId?: string;
  clientEventId?: string;
  idempotencyKey: string;
  provider: BookingProvider;
  confirmationNumber?: string;
  providerReservationId?: string;
  providerTransactionId?: string;
  parkName: string;
  campgroundName?: string;
  sectionName?: string;
  siteName: string;
  resourceId?: string;
  checkIn: string;
  checkOut: string;
  paidAt?: Date;
  bookingUrl?: string;
  amountPaid?: number;
  currency?: string;
  rawProviderSnapshot?: unknown;
}

function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('body must be an object');
  }
  return body as Record<string, unknown>;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = optionalString(body, field);
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function optionalInteger(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
  return parsed;
}

function optionalDate(body: Record<string, unknown>, field: string): Date | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${field} must be a date`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date`);
  return parsed;
}

function providerFromBody(body: Record<string, unknown>): BookingProvider {
  const provider = decodeProvider(body);
  if (!provider) throw new Error('provider must be a supported booking provider');
  return provider;
}

export function normalizeBookingPaymentEventBody(body: unknown): NormalizedBookingPaymentEvent {
  const input = readObject(body);
  const provider = providerFromBody(input);
  const confirmationNumber = optionalString(input, 'confirmationNumber');
  const resourceId = optionalString(input, 'resourceId');
  const checkIn = requiredString(input, 'checkIn');
  const checkOut = requiredString(input, 'checkOut');
  const paidAt = optionalDate(input, 'paidAt');
  const explicitIdempotencyKey = optionalString(input, 'idempotencyKey');

  const idempotencyKey = explicitIdempotencyKey
    ?? (confirmationNumber
      ? `${provider}:confirmation:${confirmationNumber}`
      : `${provider}:booking:${resourceId ?? 'unknown-resource'}:${checkIn}:${checkOut}:${paidAt?.toISOString() ?? 'unknown-paid-at'}`);

  return {
    tripId: optionalString(input, 'tripId'),
    clientEventId: optionalString(input, 'clientEventId'),
    idempotencyKey,
    provider,
    confirmationNumber,
    providerReservationId: optionalString(input, 'providerReservationId'),
    providerTransactionId: optionalString(input, 'providerTransactionId'),
    parkName: requiredString(input, 'parkName'),
    campgroundName: optionalString(input, 'campgroundName'),
    sectionName: optionalString(input, 'sectionName'),
    siteName: requiredString(input, 'siteName'),
    resourceId,
    checkIn,
    checkOut,
    paidAt,
    bookingUrl: optionalString(input, 'bookingUrl'),
    amountPaid: optionalInteger(input, 'amountPaid'),
    currency: optionalString(input, 'currency')?.toUpperCase(),
    rawProviderSnapshot: decodeRawProviderSnapshot(input.rawProviderSnapshot),
  };
}

export async function recordBookingPaymentEventInDb(input: {
  userId: string;
  userEmail: string;
  event: NormalizedBookingPaymentEvent;
  pointCost: number;
  requestContext: RequestContext;
}): Promise<{
  bookingPaymentEventId: number;
  chargeStatus: 'charged' | 'failed_insufficient_points' | 'duplicate_ignored';
  pointTransactionId: number | null;
  balanceAfter: number | null;
  duplicate: boolean;
}> {
  return db.transaction(async (tx) => {
    const [insertedEvent] = await tx.insert(bookingPaymentEvents).values({
      userId: input.userId,
      tripId: input.event.tripId ?? null,
      clientEventId: input.event.clientEventId ?? null,
      idempotencyKey: input.event.idempotencyKey,
      provider: input.event.provider,
      confirmationNumber: input.event.confirmationNumber ?? null,
      providerReservationId: input.event.providerReservationId ?? null,
      providerTransactionId: input.event.providerTransactionId ?? null,
      parkName: input.event.parkName,
      campgroundName: input.event.campgroundName ?? null,
      sectionName: input.event.sectionName ?? null,
      siteName: input.event.siteName,
      resourceId: input.event.resourceId ?? null,
      checkIn: input.event.checkIn,
      checkOut: input.event.checkOut,
      paidAt: input.event.paidAt ?? null,
      bookingUrl: input.event.bookingUrl ?? null,
      amountPaid: input.event.amountPaid ?? null,
      currency: input.event.currency ?? null,
      rawProviderSnapshot: input.event.rawProviderSnapshot ?? null,
      ...input.requestContext,
    }).onConflictDoNothing().returning({ id: bookingPaymentEvents.id });

    if (!insertedEvent) {
      const [existingEvent] = await tx.select({ id: bookingPaymentEvents.id })
        .from(bookingPaymentEvents)
        .where(eq(bookingPaymentEvents.idempotencyKey, input.event.idempotencyKey));
      if (!existingEvent) throw new Error('duplicate booking payment event was not found');

      const [existingCharge] = await tx.select({
        status: bookingPointCharges.status,
        pointTransactionId: bookingPointCharges.pointTransactionId,
      }).from(bookingPointCharges).where(eq(bookingPointCharges.bookingPaymentEventId, existingEvent.id));

      logger.info('booking_payment.duplicate_ignored', '[booking-payment] duplicate ignored', {
        userId: input.userId,
        userEmail: input.userEmail,
        bookingPaymentEventId: existingEvent.id,
        idempotencyKey: input.event.idempotencyKey,
      });

      return {
        bookingPaymentEventId: existingEvent.id,
        chargeStatus: 'duplicate_ignored' as const,
        pointTransactionId: existingCharge?.pointTransactionId ?? null,
        balanceAfter: null,
        duplicate: true,
      };
    }

    logger.info('booking_payment.recorded', '[booking-payment] recorded', {
      userId: input.userId,
      userEmail: input.userEmail,
      bookingPaymentEventId: insertedEvent.id,
      tripId: input.event.tripId,
      confirmationNumber: input.event.confirmationNumber,
      idempotencyKey: input.event.idempotencyKey,
    });

    await tx.insert(userPointAccounts)
      .values({ userId: input.userId, balance: 0 })
      .onConflictDoNothing();

    const rows = await tx.execute(sql<{ userId: string; balance: number }>`
      select "userId", balance
      from user_point_accounts
      where "userId" = ${input.userId}
      for update
    `);
    const account = (rows as unknown as Array<{ userId: string; balance: number }>)[0];
    if (!account) throw new Error(`Point account not found for user ${input.userId}`);

    if (Number(account.balance) < input.pointCost) {
      const [charge] = await tx.insert(bookingPointCharges).values({
        userId: input.userId,
        bookingPaymentEventId: insertedEvent.id,
        pointTransactionId: null,
        pointsCharged: input.pointCost,
        status: 'failed_insufficient_points',
        idempotencyKey: `booking_payment:${insertedEvent.id}:charge`,
      }).returning({ id: bookingPointCharges.id });

      logger.warn('points.charge.insufficient_balance', '[points] charge insufficient balance', {
        userId: input.userId,
        userEmail: input.userEmail,
        bookingPaymentEventId: insertedEvent.id,
        bookingPointChargeId: charge.id,
        pointCost: input.pointCost,
        balance: Number(account.balance),
      });

      return {
        bookingPaymentEventId: insertedEvent.id,
        chargeStatus: 'failed_insufficient_points' as const,
        pointTransactionId: null,
        balanceAfter: Number(account.balance),
        duplicate: false,
      };
    }

    const balanceAfter = Number(account.balance) - input.pointCost;
    const [transaction] = await tx.insert(pointTransactions).values({
      userId: input.userId,
      type: 'booking_charge',
      pointsDelta: -input.pointCost,
      balanceAfter,
      sourceType: 'booking_payment_event',
      sourceId: String(insertedEvent.id),
      idempotencyKey: `booking_payment:${insertedEvent.id}:charge`,
      metadata: {
        tripId: input.event.tripId,
        provider: input.event.provider,
        confirmationNumber: input.event.confirmationNumber,
        parkName: input.event.parkName,
        siteName: input.event.siteName,
        checkIn: input.event.checkIn,
        checkOut: input.event.checkOut,
      },
    }).returning({ id: pointTransactions.id });

    await tx.update(userPointAccounts)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(userPointAccounts.userId, input.userId));

    await tx.insert(bookingPointCharges).values({
      userId: input.userId,
      bookingPaymentEventId: insertedEvent.id,
      pointTransactionId: transaction.id,
      pointsCharged: input.pointCost,
      status: 'charged',
      idempotencyKey: `booking_payment:${insertedEvent.id}:charge`,
    });

    logger.info('points.charge.applied', '[points] charge applied', {
      userId: input.userId,
      userEmail: input.userEmail,
      tripId: input.event.tripId,
      bookingPaymentEventId: insertedEvent.id,
      pointTransactionId: transaction.id,
      pointsCharged: input.pointCost,
      balanceAfter,
      idempotencyKey: input.event.idempotencyKey,
    });

    return {
      bookingPaymentEventId: insertedEvent.id,
      chargeStatus: 'charged' as const,
      pointTransactionId: transaction.id,
      balanceAfter,
      duplicate: false,
    };
  });
}
