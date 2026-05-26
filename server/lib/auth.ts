import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin, emailOTP, bearer } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { buildOtpEmail, sendEmail } from '@/lib/email';
import { consumePendingOtpName } from '@/lib/extension-auth';

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
        const recipientName = consumePendingOtpName(email);
        const { subject, html } = buildOtpEmail(otp, recipientName);
        await sendEmail({ to: email, subject, html });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
