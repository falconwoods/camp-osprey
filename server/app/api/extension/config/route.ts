import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import {
  extensionConfigRequestBody,
  getExtensionConfigResponse,
  normalizeExtensionChannel,
  recordExtensionHeartbeat,
} from '@/lib/extension-config';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const channel = normalizeExtensionChannel(url.searchParams.get('channel'));
  return withExtensionCors(request, NextResponse.json(await getExtensionConfigResponse(channel)));
}

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => ({}));
  const body = extensionConfigRequestBody(rawBody);
  const session = await getSession();

  await recordExtensionHeartbeat(request, body, session?.user.id);

  return withExtensionCors(
    request,
    NextResponse.json(await getExtensionConfigResponse(body.channel, session?.user.id)),
  );
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
