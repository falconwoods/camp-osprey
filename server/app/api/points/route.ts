import { NextResponse } from 'next/server';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointPackages, getSuccessfulBookingPointCost } from '@/lib/points-config';
import { getPointAccountSummary } from '@/lib/points-ledger';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const summary = await getPointAccountSummary(session.user.id);

  return withExtensionCors(request, NextResponse.json({
    balance: summary.balance,
    packages: getPointPackages().map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      points: pkg.points,
    })),
    successfulBookingPointCost: getSuccessfulBookingPointCost(),
    recentTransactions: summary.recentTransactions,
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
