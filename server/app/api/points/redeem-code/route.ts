import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { RechargeCodeError, redeemRechargeCode } from '@/lib/recharge-codes';
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const body = await request.json().catch(() => ({})) as { code?: unknown };
  try {
    const result = await redeemRechargeCode({
      code: body.code,
      userId: session.user.id,
      userEmail: session.user.email,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
    });
    return withExtensionCors(request, NextResponse.json(result));
  } catch (err) {
    if (err instanceof RechargeCodeError) {
      return withExtensionCors(request, NextResponse.json({ error: err.code }, { status: err.status }));
    }
    throw err;
  }
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
