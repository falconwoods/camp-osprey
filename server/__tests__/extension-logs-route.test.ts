import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/extension-cors', async () => await import('../lib/extension-cors'));
vi.mock('@/lib/extension-logs', async () => await import('../lib/extension-logs'));

describe('extension logs route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'Eric' },
    });
  });

  it('accepts extension logs even when Loki is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { POST } = await import('../app/api/extension-logs/route');

    const response = await POST(new Request('http://localhost/api/extension-logs', {
      method: 'POST',
      headers: { Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj' },
      body: JSON.stringify({
        entries: [{
          ts: '2026-06-05T12:00:00.000Z',
          level: 'error',
          event: 'booking_payment_event_report_failed',
          message: 'booking payment event report failed',
        }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, accepted: 1, lokiStored: false });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('"event":"extension_logs.loki_push_failed"');
  });
});
