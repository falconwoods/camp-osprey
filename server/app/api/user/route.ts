import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointAccountSummary } from '@/lib/points-ledger';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(
      request,
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  const points = await getPointAccountSummary(session.user.id);

  return withExtensionCors(
    request,
    NextResponse.json({
      id:    session.user.id,
      email: session.user.email,
      name:  session.user.name,
      role:  session.user.role ?? 'user',
      pointsBalance: points.balance,
    }),
  );
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
