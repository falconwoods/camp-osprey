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

  it('returns configured point packages separately', async () => {
    const { GET } = await import('../app/api/points/packages/route');
    const response = await GET(new Request('http://localhost/api/points/packages'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      packages: [{ id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', recommended: true }],
      successfulBookingPointCost: 100,
    });
    expect(mocks.getPointAccountSummary).not.toHaveBeenCalled();
  });

  it('returns point balance separately', async () => {
    const { GET } = await import('../app/api/points/balance/route');
    const response = await GET(new Request('http://localhost/api/points/balance'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ balance: 50 });
  });

  it('returns recent point transactions separately', async () => {
    mocks.getPointAccountSummary.mockResolvedValue({
      balance: 50,
      recentTransactions: [{ id: 1, type: 'stripe_purchase', pointsDelta: 500, balanceAfter: 550, sourceType: 'stripe', sourceId: 'cs_123', createdAt: '2026-06-10T00:00:00.000Z' }],
    });
    const { GET } = await import('../app/api/points/transactions/route');
    const response = await GET(new Request('http://localhost/api/points/transactions'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      recentTransactions: [{ id: 1, type: 'stripe_purchase', pointsDelta: 500, balanceAfter: 550, sourceType: 'stripe', sourceId: 'cs_123', createdAt: '2026-06-10T00:00:00.000Z' }],
    });
  });

  it('requires auth for point packages', async () => {
    mocks.getSession.mockResolvedValue(null);
    const { GET } = await import('../app/api/points/packages/route');
    const response = await GET(new Request('http://localhost/api/points/packages'));

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

  it('passes extension return URL through checkout creation', async () => {
    const { POST } = await import('../app/api/stripe/checkout/route');
    const response = await POST(new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({
        packageId: 'starter',
        returnUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options/index.html#account',
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      userId: 'user-1',
      userEmail: 'user@example.com',
      pointPackage: { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
      returnUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options/index.html#account',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
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
