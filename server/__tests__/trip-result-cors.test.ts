import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  trips: {},
  bookingResults: {},
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => null),
}));

vi.mock('@/lib/email', () => ({
  buildResultEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/extension-cors', async () => {
  return await import('../lib/extension-cors');
});

describe('trip result route CORS', () => {
  it('responds to extension preflight requests with CORS headers', async () => {
    const { OPTIONS } = await import('../app/api/trips/[id]/result/route');
    const request = new Request('http://localhost:4000/api/trips/trip-1/result', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj' },
    });

    const response = OPTIONS(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('adds CORS headers to unauthorized POST responses', async () => {
    const { POST } = await import('../app/api/trips/[id]/result/route');
    const request = new Request('http://localhost:4000/api/trips/trip-1/result', {
      method: 'POST',
      headers: { Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj' },
      body: JSON.stringify({ outcome: 'reserved' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'trip-1' }) });

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj');
  });
});
