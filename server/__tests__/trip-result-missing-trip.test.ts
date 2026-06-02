import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tripsTable = { table: 'trips' };
  const bookingResultsTable = { table: 'bookingResults' };
  let selectedTrips: unknown[] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => selectedTrips),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          if (table === tripsTable) return [{ ...values, createdAt: new Date(), updatedAt: new Date() }];
          return [{ id: 1, ...values, createdAt: new Date() }];
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === tripsTable) return [{ id: 'trip-1', name: 'Alice Lake', ...values }];
            return [{ id: 1, ...values }];
          }),
        })),
      })),
    })),
  };

  return {
    db,
    tripsTable,
    bookingResultsTable,
    getSession: vi.fn(),
    buildResultEmail: vi.fn(),
    sendEmail: vi.fn(),
    setSelectedTrips: (rows: unknown[]) => { selectedTrips = rows; },
  };
});

vi.mock('@/db', () => ({
  db: mocks.db,
}));

vi.mock('@/db/schema', () => ({
  trips: mocks.tripsTable,
  bookingResults: mocks.bookingResultsTable,
}));

vi.mock('@/lib/session', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/lib/email', () => ({
  buildResultEmail: mocks.buildResultEmail,
  sendEmail: mocks.sendEmail,
}));

vi.mock('@/lib/extension-cors', async () => {
  return await import('../lib/extension-cors');
});

describe('trip result route missing trip recovery', () => {
  beforeEach(() => {
    mocks.db.select.mockClear();
    mocks.db.insert.mockClear();
    mocks.db.update.mockClear();
    mocks.setSelectedTrips([]);
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'Eric' },
    });
    mocks.buildResultEmail.mockReturnValue({ subject: 'Campsite held', html: '<p>Held</p>' });
    mocks.sendEmail.mockResolvedValue({ id: 'email-1' });
  });

  it('creates a missing server trip from the result payload snapshot', async () => {
    const { POST } = await import('../app/api/trips/[id]/result/route');
    const request = new Request('http://localhost:4000/api/trips/trip-1/result', {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj',
        'x-forwarded-for': '203.0.113.10',
        'x-vercel-ip-country': 'CA',
        'x-vercel-ip-country-region': 'BC',
        'x-vercel-ip-city': 'Vancouver',
      },
      body: JSON.stringify({
        outcome: 'hold_placed',
        clientId: 'client-1',
        clientInfo: {
          userAgent: 'test-agent',
          platformOs: 'mac',
          platformArch: 'arm',
          extensionVersion: '0.1.0',
        },
        matchedSite: {
          parkName: 'Alice Lake',
          sectionName: 'Main',
          siteName: '27',
          checkIn: '2026-06-03',
          checkOut: '2026-06-04',
          bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
          resourceId: 'site-27',
          reservedAt: '2026-05-26T17:21:23.000Z',
        },
        tripSnapshot: {
          name: 'Alice Lake',
          parks: [{ id: 'park-1', name: 'Alice Lake' }],
          dateRanges: [{ type: 'specific', checkIn: '2026-06-03', checkOut: '2026-06-04' }],
          filters: { noWalkin: false, noDouble: false },
          mode: 'hold',
          status: 'reserved',
          attempted: [],
        },
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'trip-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, emailSent: true });
    expect(mocks.db.insert).toHaveBeenCalledWith(mocks.tripsTable);
    const tripInsert = mocks.db.insert.mock.results[0].value.values;
    expect(tripInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'trip-1',
      userId: 'user-1',
      name: 'Alice Lake',
      mode: 'hold',
      status: 'reserved',
    }));
    expect(mocks.buildResultEmail).toHaveBeenCalledWith(
      'hold_placed',
      expect.objectContaining({ parkName: 'Alice Lake', siteName: '27' }),
      'Alice Lake',
      'Eric',
    );
    const resultInsert = mocks.db.insert.mock.results[1].value.values;
    expect(resultInsert).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'trip-1',
      userId: 'user-1',
      outcome: 'hold_placed',
      clientId: 'client-1',
      ipAddress: '203.0.113.10',
      country: 'CA',
      region: 'BC',
      city: 'Vancouver',
      userAgent: 'test-agent',
      platformOs: 'mac',
      platformArch: 'arm',
      extensionVersion: '0.1.0',
    }));
  });
});
