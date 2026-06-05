import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user, userAuthEvents } from '@/db/schema';
import { auth } from '@/lib/auth';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { getPointAccountSummary } from '@/lib/points-ledger';
import {
  jsonForExtensionAuthError,
  normalizeExtensionClientInfo,
  normalizeExtensionClientId,
  readExtensionAuthJson,
  verifyExtensionAuthCode,
} from '@/lib/extension-auth';
import { logger } from '../../../../lib/loki';
import { buildRequestContext } from '../../../../lib/request-context';

type BetterAuthUser = {
  id: string;
  email: string;
  name: string | null;
  role?: string | null;
  banned?: boolean | null;
};

export async function POST(request: Request) {
  try {
    const body = await readExtensionAuthJson(request);
    const clientId = normalizeExtensionClientId(body);
    const clientInfo = normalizeExtensionClientInfo(body);
    let existingUserBeforeVerify = false;
    const result = await verifyExtensionAuthCode(body, {
      findUserByEmail: async (email) => {
        const [row] = await db.select().from(user).where(eq(user.email, email));
        existingUserBeforeVerify = Boolean(row);
        return row ?? null;
      },
      verifyCode: async (email, code) => {
        const result = await auth.api.signInEmailOTP({
          body: { email, otp: code },
          headers: request.headers,
        });
        const authUser = result.user as BetterAuthUser;
        const normalizedName = authUser.name?.trim() || null;
        if (authUser.name !== normalizedName) {
          await db.update(user).set({ name: normalizedName }).where(eq(user.id, authUser.id));
        }
        return {
          token: result.token,
          user: {
            id: authUser.id,
            email: authUser.email,
            name: normalizedName,
            role: authUser.role ?? null,
            banned: authUser.banned ?? null,
          },
        };
      },
    });

    try {
      const context = await buildRequestContext(request, clientId, clientInfo);
      await db.insert(userAuthEvents).values({
        userId: result.user.id,
        eventType: existingUserBeforeVerify ? 'login' : 'signup',
        ...context,
      });
    } catch (err) {
      logger.error('extension_auth.auth_event_insert_failed', '[extension-auth] auth event insert failed', {
        userId: result.user.id,
        eventType: existingUserBeforeVerify ? 'login' : 'signup',
        error: err,
      });
    }

    const points = await getPointAccountSummary(result.user.id);

    return withExtensionCors(request, Response.json({
      ...result,
      pointsBalance: points.balance,
    }));
  } catch (err) {
    return withExtensionCors(request, jsonForExtensionAuthError(err));
  }
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
