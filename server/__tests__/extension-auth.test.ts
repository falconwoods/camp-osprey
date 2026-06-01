import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumePendingOtpName,
  readExtensionAuthJson,
  requestExtensionAuthCode,
  verifyExtensionAuthCode,
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

  it('sends code for a new email without requiring or forwarding name', async () => {
    const sent: Array<{ email: string; name?: string | null }> = [];
    const deps = {
      findUserByEmail: async () => null,
      sendCode: async (email: string, name?: string | null) => { sent.push({ email, name }); },
    };

    await expect(requestExtensionAuthCode({ email: 'new@example.com', name: 'Ignored User' }, deps))
      .resolves.toEqual({ ok: true, isNewUser: true });
    expect(sent).toEqual([{ email: 'new@example.com', name: null }]);
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

describe('verifyExtensionAuthCode', () => {
  it('returns token/user for new verified email without forwarding name', async () => {
    let verifiedWith: { email: string; code: string; name?: string } | null = null;
    let updated: { id: string; name: string } | null = null;
    const deps = {
      findUserByEmail: async () => null,
      verifyCode: async (email: string, code: string, name?: string) => {
        verifiedWith = { email, code, name };
        return {
          token: 'tok',
          user: { id: 'u1', email: 'new@example.com', name: null, role: null, banned: false },
        };
      },
      updateUserName: async (id: string, name: string) => { updated = { id, name }; },
    };

    await expect(verifyExtensionAuthCode({ email: 'new@example.com', code: '123456', name: 'Ignored User' }, deps))
      .resolves.toEqual({
        token: 'tok',
        user: { id: 'u1', email: 'new@example.com', name: null, role: 'user' },
      });
    expect(verifiedWith).toEqual({ email: 'new@example.com', code: '123456', name: undefined });
    expect(updated).toBeNull();
  });

  it('returns token/user for existing verified email', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => ({
        token: 'tok',
        user: { id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false },
      }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .resolves.toEqual({
        token: 'tok',
        user: { id: 'u1', email: 'old@example.com', name: 'Old User', role: 'user' },
      });
  });

  it('blocks banned users after verification', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'blocked@example.com', name: 'Blocked User', role: null, banned: false }),
      verifyCode: async () => ({
        token: 'tok',
        user: { id: 'u1', email: 'blocked@example.com', name: 'Blocked User', role: null, banned: true },
      }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'blocked@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'account_blocked', status: 403 });
  });

  it('maps database verification failures to server_error', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => { throw new Error('database down'); },
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'server_error', status: 500 });
  });

  it('maps banned verification failures to account_blocked', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => { throw { message: 'BANNED_USER' }; },
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'account_blocked', status: 403 });
  });

  it('maps rate limited verification failures to rate_limited', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => { throw { status: 429, message: 'Too many attempts' }; },
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  });

  it('maps invalid verification failures to invalid_code', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => { throw { status: 400, message: 'INVALID_OTP' }; },
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'invalid_code', status: 400 });
  });

  it('maps expired verification failures to expired_code', async () => {
    const deps = {
      findUserByEmail: async () => ({ id: 'u1', email: 'old@example.com', name: 'Old User', role: null, banned: false }),
      verifyCode: async () => { throw new Error('OTP expired'); },
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'old@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'expired_code', status: 400 });
  });
});
