import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { userPaymentKeys } from '@/db/schema';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return withExtensionCors(request, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const existing = await db
    .select()
    .from(userPaymentKeys)
    .where(eq(userPaymentKeys.userId, session.user.id))
    .limit(1);

  const key = existing[0] ?? await createUserPaymentKey(session.user.id);

  return withExtensionCors(request, NextResponse.json({
    key: key.key,
    keyVersion: key.keyVersion,
  }));
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

async function createUserPaymentKey(userId: string) {
  const generated = randomBytes(32).toString('base64');
  const [inserted] = await db
    .insert(userPaymentKeys)
    .values({ userId, key: generated, keyVersion: 1 })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(userPaymentKeys)
    .where(eq(userPaymentKeys.userId, userId))
    .limit(1);
  if (!existing) throw new Error('payment_key_create_failed');
  return existing;
}
