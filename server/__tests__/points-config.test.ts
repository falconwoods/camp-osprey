import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('points config', () => {
  it('parses configured point packages', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' },
    ]);
    process.env.SUCCESSFUL_BOOKING_POINT_COST = '100';

    const { getPointPackages, getSuccessfulBookingPointCost } = await import('../lib/points-config');

    expect(getPointPackages()).toEqual([
      { id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' },
    ]);
    expect(getSuccessfulBookingPointCost()).toBe(100);
  });

  it('rejects invalid package config', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: '', name: 'Starter', points: 0, stripePriceId: 'price_123' },
    ]);

    const { getPointPackages } = await import('../lib/points-config');

    expect(() => getPointPackages()).toThrow('POINT_PACKAGES');
  });

  it('rejects duplicate package ids', async () => {
    process.env.POINT_PACKAGES = JSON.stringify([
      { id: 'starter', name: 'Starter', points: 500, stripePriceId: 'price_123' },
      { id: 'starter', name: 'Starter 2', points: 600, stripePriceId: 'price_456' },
    ]);

    const { getPointPackages } = await import('../lib/points-config');

    expect(() => getPointPackages()).toThrow('duplicate');
  });
});
