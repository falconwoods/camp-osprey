import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { createRechargeCode, listRechargeCodes, RechargeCodeError } from '@/lib/recharge-codes';

export async function GET() {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;
  return NextResponse.json(await listRechargeCodes());
}

export async function POST(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  try {
    const result = await createRechargeCode(admin.userId, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RechargeCodeError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
