import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const result = await resend.emails.send({
    from: 'CampOsprey <noreply@camposprey.com>',
    to,
    subject,
    html,
  });
  return result;
}

type Outcome = 'found' | 'hold_placed' | 'booked' | 'failed';

interface MatchedSite {
  parkName: string;
  siteName: string;
  checkIn: string;
  checkOut: string;
  bookingUrl: string;
}

export function buildResultEmail(
  outcome: Outcome,
  site: MatchedSite | null,
  tripName: string,
): { subject: string; html: string } {
  const subjects: Record<Outcome, string> = {
    found:        `Campsite found at ${site?.parkName ?? tripName}`,
    hold_placed:  `Campsite held — complete your booking`,
    booked:       `Campsite booked! You're going camping`,
    failed:       `Booking failed at ${site?.parkName ?? tripName}`,
  };

  const bodies: Record<Outcome, string> = {
    found: `
      <p>A campsite matching your trip <strong>${tripName}</strong> is available:</p>
      <ul>
        <li><strong>Park:</strong> ${site?.parkName ?? '—'}</li>
        <li><strong>Site:</strong> ${site?.siteName ?? '—'}</li>
        <li><strong>Dates:</strong> ${site?.checkIn ?? '—'} → ${site?.checkOut ?? '—'}</li>
      </ul>
      <p>Open CampOsprey to book it before it's gone.</p>
    `,
    hold_placed: `
      <p>Your campsite for <strong>${tripName}</strong> has been held in your cart:</p>
      <ul>
        <li><strong>Park:</strong> ${site?.parkName ?? '—'}</li>
        <li><strong>Site:</strong> ${site?.siteName ?? '—'}</li>
        <li><strong>Dates:</strong> ${site?.checkIn ?? '—'} → ${site?.checkOut ?? '—'}</li>
      </ul>
      <p><a href="${site?.bookingUrl ?? 'https://camping.bcparks.ca'}">Complete your booking on BC Parks →</a></p>
    `,
    booked: `
      <p>Your campsite for <strong>${tripName}</strong> has been successfully booked!</p>
      <ul>
        <li><strong>Park:</strong> ${site?.parkName ?? '—'}</li>
        <li><strong>Site:</strong> ${site?.siteName ?? '—'}</li>
        <li><strong>Dates:</strong> ${site?.checkIn ?? '—'} → ${site?.checkOut ?? '—'}</li>
      </ul>
      <p>Check your BC Parks account for the booking confirmation.</p>
    `,
    failed: `
      <p>CampOsprey attempted to book a campsite for <strong>${tripName}</strong> but was unsuccessful.</p>
      ${site ? `<ul>
        <li><strong>Park:</strong> ${site.parkName}</li>
        <li><strong>Site:</strong> ${site.siteName}</li>
        <li><strong>Dates:</strong> ${site.checkIn} → ${site.checkOut}</li>
      </ul>` : ''}
      <p>The scanner will continue looking for another available site.</p>
    `,
  };

  return {
    subject: subjects[outcome],
    html: `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:32px auto;color:#1a1a1a">
        <h2 style="color:#16a34a;margin-bottom:8px">${subjects[outcome]}</h2>
        ${bodies[outcome]}
        <p style="color:#6b7280;font-size:13px;margin-top:32px">
          Sent by CampOsprey — camping.bcparks.ca scanner
        </p>
      </div>
    `,
  };
}
