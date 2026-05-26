import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
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
      verifyCode: async (email, code, name) => {
        const result = await auth.api.signInEmailOTP({
          body: { email, otp: code, name },
          headers: request.headers,
        });
        const authUser = result.user as BetterAuthUser;
        return {
          token: result.token,
          user: {
            id: authUser.id,
            email: authUser.email,
            name: authUser.name,
            role: authUser.role ?? null,
            banned: authUser.banned ?? null,
          },
        };
      },
      updateUserName: async (userId, name) => {
        await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId));
      },
    });

    return Response.json(result);
  } catch (err) {
    return jsonForExtensionAuthError(err);
  }
}
