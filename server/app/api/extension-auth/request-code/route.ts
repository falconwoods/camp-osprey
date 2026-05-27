import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { extensionCorsPreflight, withExtensionCors } from '@/lib/extension-cors';
import { buildOtpEmail, sendEmail } from '@/lib/email';
import {
  jsonForExtensionAuthError,
  readExtensionAuthJson,
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
      sendCode: async (email) => {
        const otp = await auth.api.createVerificationOTP({
          body: { email, type: 'sign-in' },
          headers: request.headers,
        });
        const { subject, html } = buildOtpEmail(otp, email);
        await sendEmail({ to: email, subject, html });
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
