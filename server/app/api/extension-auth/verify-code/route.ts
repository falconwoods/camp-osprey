import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import {
  jsonForExtensionAuthError,
  readExtensionAuthJson,
  verifyExtensionAuthCode,
} from '@/lib/extension-auth';

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
    const result = await verifyExtensionAuthCode(body, {
      findUserByEmail: async (email) => {
        const [row] = await db.select().from(user).where(eq(user.email, email));
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

    return withExtensionCors(request, Response.json(result));
  } catch (err) {
    return withExtensionCors(request, jsonForExtensionAuthError(err));
  }
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}
