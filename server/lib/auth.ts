import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin, emailOTP, bearer } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user:         schema.user,
      session:      schema.session,
      account:      schema.account,
      verification: schema.verification,
    },
  }),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge:  60 * 60 * 24,    // refresh if older than 1 day
  },

  plugins: [
    bearer(),
    admin(),
    emailOTP({
      expiresIn: 300, // 5 minutes
      sendVerificationOTP: async ({ email, otp }) => {
        await sendEmail({
          to: email,
          subject: 'Your CampOsprey verification code',
          html: `
            <div style="font-family:Inter,sans-serif;max-width:480px;margin:32px auto;color:#1a1a1a">
              <h2 style="color:#16a34a;margin-bottom:8px">Your verification code</h2>
              <p>Use this 6-digit code to sign in to CampOsprey. It expires in 5 minutes.</p>
              <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;
                          padding:16px 24px;text-align:center;font-size:32px;font-weight:700;
                          letter-spacing:8px;margin:16px 0;color:#1a1a1a">
                ${otp}
              </div>
              <p style="color:#6b7280;font-size:13px">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>
          `,
        });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
