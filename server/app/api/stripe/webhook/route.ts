import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { processStripeWebhookEventInDb } from '@/lib/stripe-webhooks';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing Stripe webhook configuration' }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe] webhook signature invalid', {
      event: 'stripe.webhook.signature_invalid',
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await processStripeWebhookEventInDb(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook processing failed', {
      event: 'stripe.webhook.error',
      stripeEventId: event.id,
      stripeEventType: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
