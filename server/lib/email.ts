import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const result = await getResend().emails.send({
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

function greetingFor(recipientName?: string | null): string {
  const name = recipientName?.trim();
  return name ? `<p>Hi ${escapeHtml(name)},</p>` : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOtpEmail(
  otp: string,
  recipientName?: string | null,
): { subject: string; html: string } {
  const greeting = greetingFor(recipientName);

  return {
    subject: 'Your CampOsprey verification code',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:32px auto;color:#1a1a1a">
        <h2 style="color:#16a34a;margin-bottom:8px">Your verification code</h2>
        ${greeting}
        <p>Use this 6-digit code to sign in to CampOsprey. It expires in 5 minutes.</p>
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;
                    padding:16px 24px;text-align:center;font-size:32px;font-weight:700;
                    letter-spacing:8px;margin:16px 0;color:#1a1a1a">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:13px">
          If you do not see this email, check Spam, Junk, or Trash.
        </p>
      </div>
    `,
  };
}

export function buildResultEmail(
  outcome: Outcome,
  site: MatchedSite | null,
  tripName: string,
  recipientName?: string | null,
): { subject: string; html: string } {
  const greeting = greetingFor(recipientName);
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
        ${greeting}
        ${bodies[outcome]}
        <p style="color:#6b7280;font-size:13px;margin-top:32px">
          Sent by CampOsprey — camping.bcparks.ca scanner
        </p>
      </div>
    `,
  };
}
