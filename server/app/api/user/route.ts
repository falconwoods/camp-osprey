import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  return withExtensionCors(
    request,
    NextResponse.json({
      id:    session.user.id,
      email: session.user.email,
      name:  session.user.name,
      role:  session.user.role ?? 'user',
    }),
  );
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
