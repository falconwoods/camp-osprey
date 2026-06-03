import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  bookingPaymentEvents: {},
  bookingPointCharges: {},
  pointTransactions: {},
  userPointAccounts: {},
}));

describe('normalizeBookingPaymentEventBody', () => {
  it('preserves complete booking/payment metadata', async () => {
    const { normalizeBookingPaymentEventBody } = await import('../lib/booking-payment-events');
    const event = normalizeBookingPaymentEventBody({
      tripId: 'trip-1',
      clientEventId: 'client-event-1',
      provider: 'bc_parks',
      confirmationNumber: 'ABC123',
      providerReservationId: 'reservation-1',
      providerTransactionId: 'transaction-1',
      parkName: 'Alice Lake',
      campgroundName: 'Alice Lake Campground',
      sectionName: 'Main',
      siteName: '27',
      resourceId: 'site-27',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      paidAt: '2026-06-03T20:00:00.000Z',
      bookingUrl: 'https://camping.bcparks.ca/booking/ABC123',
      amountPaid: 6400,
      currency: 'CAD',
      rawProviderSnapshot: { receipt: true },
    });

    expect(event).toEqual({
      tripId: 'trip-1',
      clientEventId: 'client-event-1',
      idempotencyKey: 'bc_parks:confirmation:ABC123',
      provider: 'bc_parks',
      confirmationNumber: 'ABC123',
      providerReservationId: 'reservation-1',
      providerTransactionId: 'transaction-1',
      parkName: 'Alice Lake',
      campgroundName: 'Alice Lake Campground',
      sectionName: 'Main',
      siteName: '27',
      resourceId: 'site-27',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      paidAt: new Date('2026-06-03T20:00:00.000Z'),
      bookingUrl: 'https://camping.bcparks.ca/booking/ABC123',
      amountPaid: 6400,
      currency: 'CAD',
      rawProviderSnapshot: { receipt: true },
    });
  });

  it('builds fallback idempotency when confirmation number is unavailable', async () => {
    const { normalizeBookingPaymentEventBody } = await import('../lib/booking-payment-events');
    const event = normalizeBookingPaymentEventBody({
      provider: 'bc_parks',
      parkName: 'Alice Lake',
      siteName: '27',
      resourceId: 'site-27',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      paidAt: '2026-06-03T20:00:00.000Z',
    });

    expect(event.idempotencyKey).toBe('bc_parks:booking:site-27:2026-07-01:2026-07-03:2026-06-03T20:00:00.000Z');
  });

  it('rejects missing required metadata', async () => {
    const { normalizeBookingPaymentEventBody } = await import('../lib/booking-payment-events');
    expect(() => normalizeBookingPaymentEventBody({
      provider: 'bc_parks',
      parkName: 'Alice Lake',
      siteName: '',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
    })).toThrow('siteName');
  });
});
