import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    id:    session.user.id,
    email: session.user.email,
    name:  session.user.name,
    role:  session.user.role ?? 'user',
  });
}
