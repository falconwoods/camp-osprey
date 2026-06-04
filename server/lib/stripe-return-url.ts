export function appendCheckoutReturnParams(baseUrl: string, input: {
  returnUrl?: string;
  extensionId?: string;
}): string {
  const sanitized = sanitizeReturnUrl(input.returnUrl);
  const extensionId = sanitizeExtensionId(input.extensionId);
  if (!sanitized && !extensionId) return baseUrl;

  const url = new URL(baseUrl);
  if (sanitized) url.searchParams.set('return_url', sanitized);
  if (extensionId) url.searchParams.set('extension_id', extensionId);
  return url.toString();
}

export function appendReturnUrl(baseUrl: string, returnUrl?: string): string {
  return appendCheckoutReturnParams(baseUrl, { returnUrl });
}

export function sanitizeReturnUrl(returnUrl?: string | null): string | null {
  if (!returnUrl) return null;

  try {
    const url = new URL(returnUrl);
    if (url.protocol === 'chrome-extension:' || url.protocol === 'https:' || url.protocol === 'http:') {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function sanitizeExtensionId(extensionId?: string | null): string | null {
  const value = extensionId?.trim();
  if (!value) return null;
  return /^[a-p]{32}$/.test(value) ? value : null;
}
