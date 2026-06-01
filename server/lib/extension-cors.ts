const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const MAX_AGE_SECONDS = '600';

export function isAllowedExtensionOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

export function extensionCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('origin');
  if (isAllowedExtensionOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin!);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  headers.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
  return headers;
}

export function withExtensionCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of extensionCorsHeaders(request)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function extensionCorsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: extensionCorsHeaders(request),
  });
}
