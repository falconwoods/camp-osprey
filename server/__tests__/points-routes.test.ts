import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPointPackages: vi.fn(),
  getRecommendedPointPackageId: vi.fn(),
  getSuccessfulBookingPointCost: vi.fn(),
  getPointAccountSummary: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/points-config', () => ({
  getPointPackages: mocks.getPointPackages,
  getPointPackage: (id: string) => mocks.getPointPackages().find((pkg: { id: string }) => pkg.id === id) ?? null,
  getRecommendedPointPackageId: mocks.getRecommendedPointPackageId,
  getSuccessfulBookingPointCost: mocks.getSuccessfulBookingPointCost,
}));
vi.mock('@/lib/points-ledger', () => ({ getPointAccountSummary: mocks.getPointAccountSummary }));
vi.mock('@/lib/stripe', () => ({ createCheckoutSession: mocks.createCheckoutSession }));
vi.mock('@/lib/extension-cors', async () => await import('../lib/extension-cors'));

describe('points routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'Eric' },
    });
    mocks.getPointPackages.mockReturnValue([
      { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
    ]);
    mocks.getRecommendedPointPackageId.mockReturnValue('starter');
    mocks.getSuccessfulBookingPointCost.mockReturnValue(100);
    mocks.getPointAccountSummary.mockResolvedValue({ balance: 50, recentTransactions: [] });
    mocks.createCheckoutSession.mockResolvedValue({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/cs_123',
    });
  });

  it('returns balance and configured public packages', async () => {
    const { GET } = await import('../app/api/points/route');
    const response = await GET(new Request('http://localhost/api/points'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      balance: 50,
      packages: [{ id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', recommended: true }],
      successfulBookingPointCost: 100,
      recentTransactions: [],
    });
  });

  it('requires auth for point summary', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { GET } = await import('../app/api/points/route');
    const response = await GET(new Request('http://localhost/api/points'));

    expect(response.status).toBe(401);
  });

  it('creates checkout for a configured package', async () => {
    const { POST } = await import('../app/api/stripe/checkout/route');
    const response = await POST(new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId: 'starter' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/cs_123',
      stripeSessionId: 'cs_123',
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      userId: 'user-1',
      userEmail: 'user@example.com',
      pointPackage: { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
    });
  });

  it('rejects unknown checkout package ids', async () => {
    const { POST } = await import('../app/api/stripe/checkout/route');
    const response = await POST(new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId: 'unknown' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_package' });
  });
});
