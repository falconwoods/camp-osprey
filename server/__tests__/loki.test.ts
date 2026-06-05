import { afterEach, describe, expect, it, vi } from 'vitest';
import { logServerEvent } from '../lib/loki';

describe('server Loki logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('writes one-line JSON to stdout', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn());

    logServerEvent({
      level: 'info',
      event: 'booking_payment.recorded',
      message: '[booking-payment] recorded',
      bookingPaymentEventId: 1,
    });

    expect(info).toHaveBeenCalledWith(expect.any(String));
    expect(info.mock.calls[0]).toHaveLength(1);
    const payload = JSON.parse(info.mock.calls[0][0] as string);
    expect(payload).toEqual(expect.objectContaining({
      event: 'booking_payment.recorded',
      message: '[booking-payment] recorded',
      bookingPaymentEventId: 1,
      level: 'info',
      ts: expect.any(String),
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('writes readable console arguments when local debug mode is enabled', () => {
    vi.stubEnv('SERVER_LOCAL_DEBUG', 'true');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('not enough points');

    logServerEvent({
      level: 'warning',
      event: 'points.charge.insufficient_balance',
      message: '[points] charge insufficient balance',
      ts: '2026-06-05T12:00:00.000Z',
      userId: 'user-1',
      balance: 100,
      cost: 500,
      error,
    });

    expect(warn).toHaveBeenCalledWith(
        '[2026-06-05T12:00:00.000Z] WARNING points.charge.insufficient_balance: [points] charge insufficient balance',
      {
        userId: 'user-1',
        balance: 100,
        cost: 500,
      },
      error,
    );
  });
});
