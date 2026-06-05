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
});
