import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('points config', () => {
  it('parses configured point packages', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
    ]);
    process.env.POINT_PACKAGES_RECOMMENDED = 'starter';
    process.env.SUCCESSFUL_BOOKING_POINT_COST = '100';

    const { getPointPackages, getRecommendedPointPackageId, getSuccessfulBookingPointCost } = await import('../lib/points-config');

    expect(getPointPackages()).toEqual([
      { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
    ]);
    expect(getRecommendedPointPackageId()).toBe('starter');
    expect(getSuccessfulBookingPointCost()).toBe(100);
  });

  it('rejects invalid package config', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: '', name: 'Starter', points: 0, priceLabel: '', stripePriceId: 'price_123' },
    ]);

    const { getPointPackages } = await import('../lib/points-config');

    expect(() => getPointPackages()).toThrow('POINT_PACKAGES');
  });

  it('rejects duplicate package ids', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: 'starter', name: 'Starter', points: 500, priceLabel: 'CAD 5', stripePriceId: 'price_123' },
      { id: 'starter', name: 'Starter 2', points: 600, priceLabel: 'CAD 6', stripePriceId: 'price_456' },
    ]);

    const { getPointPackages } = await import('../lib/points-config');

    expect(() => getPointPackages()).toThrow('duplicate');
  });
});
