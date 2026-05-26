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
