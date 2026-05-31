import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import {
  filterAcceptedExtensionLogs,
  normalizeExtensionLogEntries,
  sendExtensionLogsToLoki,
} from '@/lib/extension-logs';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  const body = await request.json().catch(() => ({}));
  const entries = normalizeExtensionLogEntries(body);
  const accepted = filterAcceptedExtensionLogs(entries);

  try {
    await sendExtensionLogsToLoki(accepted, {
      userId: session.user.id,
      userEmail: session.user.email,
    });
  } catch (err) {
    console.error('[extension-logs] loki push failed:', err);
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
