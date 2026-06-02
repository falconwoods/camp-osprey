export interface RequestContext {
  clientId?: string;
  ipAddress?: string;
  country?: string;
  region?: string;
  city?: string;
  userAgent?: string;
  platformOs?: string;
  platformArch?: string;
  extensionVersion?: string;
}

export interface RequestClientInfo {
  extensionVersion?: string;
  userAgent?: string;
  platformOs?: string;
  platformArch?: string;
}

interface IpInfoResponse {
  country?: string;
  region?: string;
  city?: string;
}

export function getClientIp(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for');
  const forwardedIp = forwarded
    ?.split(',')
    .map(value => value.trim())
    .find(Boolean);

  return (
    headers.get('cf-connecting-ip')
    ?? headers.get('x-real-ip')
    ?? forwardedIp
    ?? undefined
  );
}

export function getRequestCountry(headers: Headers): string | undefined {
  return headers.get('x-vercel-ip-country')
    ?? headers.get('cf-ipcountry')
    ?? headers.get('cloudfront-viewer-country')
    ?? undefined;
}

function decodeHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function geoFromHeaders(headers: Headers): Pick<RequestContext, 'country' | 'region' | 'city'> {
  return {
    country: getRequestCountry(headers),
    region: decodeHeaderValue(headers.get('x-vercel-ip-country-region')),
    city: decodeHeaderValue(headers.get('x-vercel-ip-city')),
  };
}

export function normalizeRequestClientInfo(body: unknown): RequestClientInfo | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const clientInfo = (body as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== 'object' || Array.isArray(clientInfo)) return undefined;

  const input = clientInfo as Partial<Record<keyof RequestClientInfo, unknown>>;
  const output: RequestClientInfo = {};
  for (const field of ['extensionVersion', 'userAgent', 'platformOs', 'platformArch'] as const) {
    if (typeof input[field] === 'string' && input[field]) output[field] = input[field];
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

async function geoFromIpInfo(ipAddress?: string): Promise<Pick<RequestContext, 'country' | 'region' | 'city'>> {
  const token = process.env.IPINFO_TOKEN;
  if (!token || !ipAddress) return {};

  try {
    const response = await fetch(
      `https://ipinfo.io/${encodeURIComponent(ipAddress)}/json?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(750) },
    );
    if (!response.ok) return {};
    const body = await response.json() as IpInfoResponse;
    return {
      country: body.country,
      region: body.region,
      city: body.city,
    };
  } catch (err) {
    console.error('[request-context] geo lookup failed:', err);
    return {};
  }
}

export async function buildRequestContext(
  request: Request,
  clientId?: string,
  clientInfo?: RequestClientInfo,
): Promise<RequestContext> {
  const ipAddress = getClientIp(request.headers);
  const headerGeo = geoFromHeaders(request.headers);
  const lookupGeo = await geoFromIpInfo(ipAddress);

  return {
    clientId,
    ipAddress,
    country: headerGeo.country ?? lookupGeo.country,
    region: headerGeo.region ?? lookupGeo.region,
    city: headerGeo.city ?? lookupGeo.city,
    userAgent: clientInfo?.userAgent ?? request.headers.get('user-agent') ?? undefined,
    platformOs: clientInfo?.platformOs,
    platformArch: clientInfo?.platformArch,
    extensionVersion: clientInfo?.extensionVersion,
  };
}
