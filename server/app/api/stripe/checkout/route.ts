import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointPackage } from '@/lib/points-config';
import { getSession } from '@/lib/session';
import { createCheckoutSession } from '@/lib/stripe';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const body = await request.json().catch(() => ({})) as { packageId?: unknown };
  if (typeof body.packageId !== 'string') {
    return withExtensionCors(request, NextResponse.json({ error: 'invalid_package' }, { status: 400 }));
  }

  const pointPackage = getPointPackage(body.packageId);
  if (!pointPackage) {
    console.warn('[points] checkout package not found', {
      event: 'points.checkout.package_not_found',
      userId: session.user.id,
      userEmail: session.user.email,
      packageId: body.packageId,
    });
    return withExtensionCors(request, NextResponse.json({ error: 'unknown_package' }, { status: 400 }));
  }

  const checkout = await createCheckoutSession({
    userId: session.user.id,
    userEmail: session.user.email,
    pointPackage,
  });

  return withExtensionCors(request, NextResponse.json({
    checkoutUrl: checkout.url,
    stripeSessionId: checkout.id,
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
