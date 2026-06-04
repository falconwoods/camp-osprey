import type { Metadata } from 'next';
import { PaymentResultPage } from '../resultPage';

export const metadata: Metadata = {
  title: 'Payment cancelled | campsoon',
};

export default function PaymentCancelPage() {
  return (
    <PaymentResultPage
      tone="cancel"
      status="Payment cancelled"
      title="Your payment was cancelled"
      message="No charges were made to your account. You can try again anytime when you're ready."
      sideTitle="What happened?"
      sideMessage="You cancelled or closed the payment window before completing the checkout."
      sideFooterTitle="You can:"
      details={[
        { icon: 'dot', text: 'Try the payment again' },
        { icon: 'dot', text: 'Choose a different payment method' },
        { icon: 'dot', text: 'Return to Campsoon to continue browsing' },
      ]}
      closingNote="You can safely close this tab if you don't want to try again now."
    />
  );
}
