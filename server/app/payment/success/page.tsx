import type { Metadata } from 'next';
import { PaymentResultPage } from '../resultPage';

export const metadata: Metadata = {
  title: 'Payment complete | campsoon',
};

export default function PaymentSuccessPage() {
  return (
    <PaymentResultPage
      tone="success"
      status="Payment successful"
      title="Your points are being added"
      message="Stripe confirmed your checkout. Your Campsoon balance should update in a few seconds."
      sideTitle="Next steps"
      details={[
        {
          icon: 'shield',
          title: 'Payment verified securely by Stripe',
          text: 'Your payment has been confirmed.',
        },
        {
          icon: 'gift',
          title: 'Points are credited to your account',
          text: 'This is processed server-side.',
        },
        {
          icon: 'refresh',
          title: 'Refresh Campsoon if needed',
          text: "If your balance hasn't updated yet, please refresh the extension.",
        },
      ]}
      closingNote="You can safely close this tab after returning to Campsoon."
    />
  );
}
