import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import {
  filterAcceptedExtensionLogs,
  normalizeExtensionClientInfo,
  normalizeExtensionLogClientId,
  normalizeExtensionLogEntries,
  sendExtensionLogsToLoki,
} from '@/lib/extension-logs';
import { logger } from '../../../lib/loki';
import { getClientIp, getRequestCountry } from '../../../lib/request-context';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  const body = await request.json().catch(() => ({}));
  const clientId = normalizeExtensionLogClientId(body);
  const clientInfo = normalizeExtensionClientInfo(body);
  const entries = normalizeExtensionLogEntries(body);
  const accepted = filterAcceptedExtensionLogs(entries);

  try {
    await sendExtensionLogsToLoki(accepted, {
      userId: session.user.id,
      userEmail: session.user.email,
      clientId,
      ipAddress: getClientIp(request.headers),
      country: getRequestCountry(request.headers),
      clientInfo,
    });
  } catch (err) {
    logger.error('extension_logs.loki_push_failed', '[extension-logs] loki push failed', {
      userId: session.user.id,
      userEmail: session.user.email,
      acceptedCount: accepted.length,
      error: err,
    });
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'loki_push_failed' }, { status: 502 }),
    );
  }

  return withExtensionCors(request, NextResponse.json({ ok: true, accepted: accepted.length }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
