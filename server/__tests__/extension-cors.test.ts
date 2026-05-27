import { describe, expect, it } from 'vitest';

import {
  extensionCorsPreflight,
  isAllowedExtensionOrigin,
  withExtensionCors,
} from '../lib/extension-cors';

describe('extension CORS', () => {
  it('allows chrome extension origins', () => {
    expect(isAllowedExtensionOrigin('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj')).toBe(true);
  });

  it('rejects normal web origins', () => {
    expect(isAllowedExtensionOrigin('https://example.com')).toBe(false);
  });

  it('adds CORS headers for allowed extension origins', () => {
    const request = new Request('http://localhost:4000/api/extension-auth/request-code', {
      headers: { Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj' },
    });

    const response = withExtensionCors(request, Response.json({ ok: true }));

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('responds to allowed preflight requests with no body', async () => {
    const request = new Request('http://localhost:4000/api/extension-auth/request-code', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://acnelnljljoipopaijlhljbagpnapjoj' },
    });

    const response = extensionCorsPreflight(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://acnelnljljoipopaijlhljbagpnapjoj');
    await expect(response.text()).resolves.toBe('');
  });
});
