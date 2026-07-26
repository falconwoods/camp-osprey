import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    userId: 'user-1',
    clientId: 'client-1',
    name: 'Weekend',
    parks: [{ id: 'park-1', name: 'Park 1' }],
    dateRanges: [{ type: 'specific', checkIn: '2026-07-04', checkOut: '2026-07-05' }],
    filters: { noWalkin: false, noDouble: false },
    mode: 'autopay',
    status: 'scanning',
    ...overrides,
  };
}

describe('scan lease verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
    process.env.SCAN_LEASE_SECRET = 'test-scan-lease-secret';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SCAN_LEASE_SECRET;
  });

  it('accepts a fresh lease for the same user, trip, client, mode, and trip hash', async () => {
    const { createScanLease, verifyScanLease } = await import('../lib/scan-lease');
    const sourceTrip = trip();
    const { lease, payload } = createScanLease({
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
    });

    expect(verifyScanLease({
      lease,
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
    })).toMatchObject({
      leaseId: payload.leaseId,
      userId: 'user-1',
      tripId: 'trip-1',
      mode: 'autopay',
    });
  });

  it('rejects missing leases', async () => {
    const { verifyScanLease } = await import('../lib/scan-lease');

    expect(() => verifyScanLease({
      lease: undefined,
      userId: 'user-1',
      trip: trip(),
      clientId: 'client-1',
    })).toThrow('scan_lease_required');
  });

  it('rejects expired leases', async () => {
    const { createScanLease, verifyScanLease } = await import('../lib/scan-lease');
    const sourceTrip = trip();
    const { lease } = createScanLease({
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
      ttlSeconds: 60,
    });

    vi.setSystemTime(new Date('2026-06-05T12:02:00.000Z'));

    expect(() => verifyScanLease({
      lease,
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
    })).toThrow('expired_scan_lease');
  });

  it('rejects stale leases when trip identity fields change', async () => {
    const { createScanLease, verifyScanLease } = await import('../lib/scan-lease');
    const sourceTrip = trip();
    const { lease } = createScanLease({
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
    });

    expect(() => verifyScanLease({
      lease,
      userId: 'user-1',
      trip: trip({ parks: [{ id: 'park-2', name: 'Park 2' }] }),
      clientId: 'client-1',
    })).toThrow('stale_scan_lease');
  });

  it('allows status changes between scanning, reserving, and paid for the same trip definition', async () => {
    const { createScanLease, verifyScanLease } = await import('../lib/scan-lease');
    const sourceTrip = trip({ status: 'scanning' });
    const { lease } = createScanLease({
      userId: 'user-1',
      trip: sourceTrip,
      clientId: 'client-1',
    });

    expect(verifyScanLease({
      lease,
      userId: 'user-1',
      trip: trip({ status: 'paid' }),
      clientId: 'client-1',
    })).toMatchObject({ tripId: 'trip-1' });
  });
});
