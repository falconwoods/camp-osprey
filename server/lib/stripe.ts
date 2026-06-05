import Stripe from 'stripe';
import { db } from '@/db';
import { stripeCheckoutSessions } from '@/db/schema';
import type { PointPackage } from '@/lib/points-config';
import { appendCheckoutReturnParams } from '@/lib/stripe-return-url';
import { logger } from './loki';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  stripeClient = new Stripe(key);
  return stripeClient;
}

export async function createCheckoutSession(input: {
  userId: string;
  userEmail: string;
  pointPackage: PointPackage;
  returnUrl?: string;
  extensionId?: string;
}): Promise<{ id: string; url: string }> {
  const stripe = getStripe();
  const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
  const successUrl = appendCheckoutReturnParams(process.env.STRIPE_SUCCESS_URL ?? `${baseUrl}/payment/success`, input);
  const cancelUrl = appendCheckoutReturnParams(process.env.STRIPE_CANCEL_URL ?? `${baseUrl}/payment/cancel`, input);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: input.userEmail,
    line_items: [{ price: input.pointPackage.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId: input.userId,
      userEmail: input.userEmail,
      packageId: input.pointPackage.id,
    },
  });

  await db.insert(stripeCheckoutSessions).values({
    userId: input.userId,
    packageId: input.pointPackage.id,
    stripePriceId: input.pointPackage.stripePriceId,
    stripeSessionId: session.id,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
    status: 'created',
    points: input.pointPackage.points,
    amountTotal: session.amount_total,
    currency: session.currency,
    metadata: { url: session.url },
  });

  logger.info('points.checkout.created', '[points] checkout created', {
    userId: input.userId,
    userEmail: input.userEmail,
    packageId: input.pointPackage.id,
    stripeSessionId: session.id,
    stripePriceId: input.pointPackage.stripePriceId,
  });

  return { id: session.id, url: session.url ?? '' };
}
