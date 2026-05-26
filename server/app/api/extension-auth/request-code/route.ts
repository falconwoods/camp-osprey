import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
import {
  consumePendingOtpName,
  jsonForExtensionAuthError,
  readExtensionAuthJson,
  rememberPendingOtpName,
  requestExtensionAuthCode,
} from '@/lib/extension-auth';

export async function POST(request: Request) {
  try {
    const body = await readExtensionAuthJson(request);
    const result = await requestExtensionAuthCode(body, {
      findUserByEmail: async (email) => {
        const [row] = await db.select().from(user).where(eq(user.email, email));
        return row ?? null;
      },
      sendCode: async (email, name) => {
        rememberPendingOtpName(email, name);
        try {
          await auth.api.sendVerificationOTP({
            body: { email, type: 'sign-in' },
            headers: request.headers,
          });
        } catch (err) {
          consumePendingOtpName(email);
          throw err;
        }
      },
    });

    return Response.json(result);
  } catch (err) {
    return jsonForExtensionAuthError(err);
  }
}
