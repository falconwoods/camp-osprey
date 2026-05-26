import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumePendingOtpName,
  readExtensionAuthJson,
  requestExtensionAuthCode,
  rememberPendingOtpName,
  normalizeExtensionEmail,
  normalizeExtensionName,
  normalizeExtensionCode,
  extensionAuthError,
} from '../lib/extension-auth';

describe('extension auth validation', () => {
  it('normalizes email by trimming and lowercasing', () => {
    expect(normalizeExtensionEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => normalizeExtensionEmail('not an email')).toThrow(extensionAuthError('invalid_email').message);
  });

  it('normalizes name by trimming repeated whitespace', () => {
    expect(normalizeExtensionName('  Eric   Smith  ')).toBe('Eric Smith');
  });

  it('rejects blank name', () => {
    expect(() => normalizeExtensionName('   ')).toThrow(extensionAuthError('name_required').message);
  });

  it('normalizes six digit code', () => {
    expect(normalizeExtensionCode(' 123456 ')).toBe('123456');
  });

  it('rejects malformed code', () => {
    expect(() => normalizeExtensionCode('12-456')).toThrow(extensionAuthError('invalid_code').message);
  });
});

describe('pending OTP names', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prunes expired pending names when remembering a new name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    rememberPendingOtpName('expired@example.com', 'Expired User');

    vi.setSystemTime(5 * 60_000 + 1);
    rememberPendingOtpName('new@example.com', 'New User');

    vi.setSystemTime(1);
    expect(consumePendingOtpName('expired@example.com')).toBeNull();
    expect(consumePendingOtpName('new@example.com')).toBe('New User');
  });
});

describe('requestExtensionAuthCode', () => {
  it('returns invalid_email for malformed JSON route bodies', async () => {
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async () => { throw new Error('should not send'); },
    };
    const body = await readExtensionAuthJson(new Request('https://example.test', {
      method: 'POST',
      body: '{bad json',
    }));

    await expect(requestExtensionAuthCode(body, deps))
      .rejects.toMatchObject({ code: 'invalid_email', status: 400 });
  });

  it('returns invalid_email for null body', async () => {
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async () => { throw new Error('should not send'); },
    };

    await expect(requestExtensionAuthCode(null, deps))
      .rejects.toMatchObject({ code: 'invalid_email', status: 400 });
  });

  it('returns name_required for a new email without sending a code', async () => {
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async () => { throw new Error('should not send'); },
    };

    await expect(requestExtensionAuthCode({ email: 'new@example.com' }, deps))
      .rejects.toMatchObject({
        code: 'name_required',
        status: 400,
        details: { isNewUser: true },
      });
  });

  it('sends code for a new email when name is present', async () => {
    const sent: Array<{ email: string; name?: string }> = [];
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async (email: string, name?: string) => { sent.push({ email, name }); },
    };

    await expect(requestExtensionAuthCode({ email: 'NEW@Example.com', name: ' Eric ' }, deps))
      .resolves.toEqual({ ok: true, isNewUser: true });
    expect(sent).toEqual([{ email: 'new@example.com', name: 'Eric' }]);
  });

  it('sends code for an existing email without requiring name', async () => {
    const sent: string[] = [];
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', banned: false }),
      sendCode: async (email: string) => { sent.push(email); },
    };

    await expect(requestExtensionAuthCode({ email: 'old@example.com' }, deps))
      .resolves.toEqual({ ok: true, isNewUser: false });
    expect(sent).toEqual(['old@example.com']);
  });

  it('blocks banned existing users', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'blocked@example.com', name: 'Blocked User', banned: true }),
      sendCode: async () => { throw new Error('should not send'); },
    };

    await expect(requestExtensionAuthCode({ email: 'blocked@example.com' }, deps))
      .rejects.toMatchObject({ code: 'account_blocked', status: 403 });
  });
});
