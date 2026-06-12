import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { AdminPointAdjustmentError, deductUserPoints } from '@/lib/admin-points';

export async function POST(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  try {
    const result = await deductUserPoints({
      userId: body.userId,
      adminUserId: admin.userId,
      points: body.points,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AdminPointAdjustmentError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
