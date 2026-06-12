import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointPackages, getRecommendedPointPackageId, getSuccessfulBookingPointCost } from '@/lib/points-config';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const recommendedPackageId = getRecommendedPointPackageId();

  return withExtensionCors(request, NextResponse.json({
    packages: getPointPackages().map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      points: pkg.points,
      priceLabel: pkg.priceLabel,
      recommended: pkg.id === recommendedPackageId,
    })),
    successfulBookingPointCost: getSuccessfulBookingPointCost(),
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
