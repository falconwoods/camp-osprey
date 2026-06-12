import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { RechargeCodeError, sendExistingRechargeCode } from '@/lib/recharge-codes';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const { id: rawId } = await params;
  const id = Number(rawId);
  const body = await request.json().catch(() => ({})) as { code?: unknown };
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  if (typeof body.code !== 'string') {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  try {
    await sendExistingRechargeCode(id, body.code);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RechargeCodeError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
