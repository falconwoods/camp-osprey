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

describe('verifyExtensionAuthCode', () => {
  it('requires name when verified email is new', async () => {
    const deps = {
      findUserByEmail: async () => null,
      verifyCode: async () => ({
        token: 'tok',
        user: { id: 'u1', email: 'new@example.com', name: '', role: null, banned: false },
      }),
      updateUserName: async () => undefined,
    };

    await expect(verifyExtensionAuthCode({ email: 'new@example.com', code: '123456' }, deps))
      .rejects.toMatchObject({ code: 'name_required', status: 400 });
  });

  it('returns token/user for new verified email with normalized name and calls updateUserName', async () => {
    let updated: { id: string; name: string } | null = null;
    let verifiedWith: { email: string; code: string; name?: string } | null = null;
    const deps = {
      findUserByEmail: async () => null,
      verifyCode: async (email: string, code: string, name?: string) => {
        verifiedWith = { email, code, name };
        return {
          token: 'tok',
          user: { id: 'u1', email: 'new@example.com', name: '', role: null, banned: false },
        };
      },
      updateUserName: async (id: string, name: string) => { updated = { id, name }; },
    };

    await expect(verifyExtensionAuthCode({ email: 'NEW@example.com', code: ' 123456 ', name: ' Eric   Smith ' }, deps))
      .resolves.toEqual({
        token: 'tok',
        user: { id: 'u1', email: 'new@example.com', name: 'Eric Smith', role: 'user' },
      });
    expect(verifiedWith).toEqual({ email: 'new@example.com', code: '123456', name: 'Eric Smith' });
    expect(updated).toEqual({ id: 'u1', name: 'Eric Smith' });
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
});
