export type ExtensionAuthErrorCode =
  | 'invalid_email'
  | 'invalid_code'
  | 'expired_code'
  | 'name_required'
  | 'account_blocked'
  | 'rate_limited'
  | 'email_send_failed'
  | 'server_error';

export class ExtensionAuthError extends Error {
  constructor(
    public code: ExtensionAuthErrorCode,
    public status: number,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<ExtensionAuthErrorCode, number> = {
  invalid_email: 400,
  invalid_code: 400,
  expired_code: 400,
  name_required: 400,
  account_blocked: 403,
  rate_limited: 429,
  email_send_failed: 500,
  server_error: 500,
};

export type UserLookup = {
  id: string;
  email: string;
  name: string | null;
  banned: boolean | null;
};

export type RequestCodeDeps = {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  sendCode: (email: string, name?: string | null) => Promise<void>;
};

export type VerifiedSession = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string | null;
    banned: boolean | null;
  };
};

export type VerifyCodeDeps = {
  findUserByEmail: (email: string) => Promise<(UserLookup & { role: string | null }) | null>;
  verifyCode: (email: string, code: string, name?: string) => Promise<VerifiedSession>;
  updateUserName?: (userId: string, name: string) => Promise<void>;
};

const pendingOtpNames = new Map<string, { name: string; expiresAt: number }>();

function getExtensionAuthBody(body: unknown): { email?: unknown; code?: unknown; name?: unknown } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

export async function readExtensionAuthJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function extensionAuthError(
  code: ExtensionAuthErrorCode,
  details: Record<string, unknown> = {},
): ExtensionAuthError {
  return new ExtensionAuthError(code, STATUS_BY_CODE[code], code, details);
}

export function normalizeExtensionEmail(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('invalid_email');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw extensionAuthError('invalid_email');
  return email;
}

export function normalizeExtensionName(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('name_required');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw extensionAuthError('name_required');
  return name;
}

export function normalizeExtensionCode(value: unknown): string {
  if (typeof value !== 'string') throw extensionAuthError('invalid_code');
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) throw extensionAuthError('invalid_code');
  return code;
}

function getErrorField(err: unknown, field: string): unknown {
  if (!err || typeof err !== 'object') return undefined;
  return (err as Record<string, unknown>)[field];
}

export function extensionAuthErrorForVerifyCodeFailure(err: unknown): ExtensionAuthError {
  if (err instanceof ExtensionAuthError) return err;

  const message = err instanceof Error
    ? err.message
    : String(getErrorField(err, 'message') ?? '');
  const code = String(getErrorField(err, 'code') ?? '').toLowerCase();
  const text = `${message} ${code}`.toLowerCase();
  const rawStatus = getErrorField(err, 'status') ?? getErrorField(err, 'statusCode');
  const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);

  if (
    text.includes('banned')
    || text.includes('blocked')
    || text.includes('banned_user')
  ) {
    return extensionAuthError('account_blocked');
  }

  if (
    status === 429
    || text.includes('rate')
    || text.includes('too many')
    || text.includes('too_many')
  ) {
    return extensionAuthError('rate_limited');
  }

  if (text.includes('expired')) {
    return extensionAuthError('expired_code');
  }

  if (
    status === 400
    || status === 401
    || status === 403
    || (text.includes('invalid') && (text.includes('otp') || text.includes('code')))
    || text.includes('unauthorized')
    || text.includes('forbidden')
  ) {
    return extensionAuthError('invalid_code');
  }

  return extensionAuthError('server_error');
}

export function pruneExpiredPendingOtpNames(now = Date.now()): void {
  for (const [email, pending] of pendingOtpNames) {
    if (pending.expiresAt < now) pendingOtpNames.delete(email);
  }
}

export function rememberPendingOtpName(email: string, name?: string): void {
  pruneExpiredPendingOtpNames();
  if (!name) return;
  pendingOtpNames.set(email, { name, expiresAt: Date.now() + 5 * 60_000 });
}

export function consumePendingOtpName(email: string): string | null {
  const pending = pendingOtpNames.get(email);
  if (!pending) return null;
  pendingOtpNames.delete(email);
  if (pending.expiresAt < Date.now()) return null;
  return pending.name;
}

export async function requestExtensionAuthCode(
  body: unknown,
  deps: RequestCodeDeps,
): Promise<{ ok: true; isNewUser: boolean }> {
  const requestBody = getExtensionAuthBody(body);
  const email = normalizeExtensionEmail(requestBody.email);
  const existingUser = await deps.findUserByEmail(email);

  if (existingUser?.banned) throw extensionAuthError('account_blocked');

  try {
    await deps.sendCode(email, existingUser?.name ?? null);
  } catch (err) {
    console.error('[extension-auth] send code failed:', err);
    throw extensionAuthError('email_send_failed');
  }

  return { ok: true, isNewUser: !existingUser };
}

export async function verifyExtensionAuthCode(
  body: unknown,
  deps: VerifyCodeDeps,
): Promise<{ token: string; user: { id: string; email: string; name: string | null; role: string } }> {
  const requestBody = getExtensionAuthBody(body);
  const email = normalizeExtensionEmail(requestBody.email);
  const code = normalizeExtensionCode(requestBody.code);
  const existingUser = await deps.findUserByEmail(email);

  if (existingUser?.banned) throw extensionAuthError('account_blocked');

  let verified: VerifiedSession;
  try {
    verified = await deps.verifyCode(email, code);
  } catch (err) {
    throw extensionAuthErrorForVerifyCodeFailure(err);
  }

  if (verified.user.banned) throw extensionAuthError('account_blocked');

  const finalName = existingUser?.name?.trim() || verified.user.name?.trim() || null;

  return {
    token: verified.token,
    user: {
      id: verified.user.id,
      email: verified.user.email,
      name: finalName,
      role: verified.user.role ?? 'user',
    },
  };
}

export function jsonForExtensionAuthError(err: unknown): Response {
  if (err instanceof ExtensionAuthError) {
    return Response.json(
      { error: err.code, ...err.details },
      { status: err.status },
    );
  }
  console.error('[extension-auth] unexpected error:', err);
  return Response.json({ error: 'server_error' }, { status: 500 });
}
