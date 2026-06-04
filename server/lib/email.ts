import { Resend } from 'resend';

const DEFAULT_EMAIL_FROM = 'campsoon <noreply@campsoon.com>';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
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
    from: getEmailFrom(),
    to,
    subject,
    html,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
}

type Outcome = 'found' | 'hold_placed' | 'booked' | 'failed';

interface MatchedSite {
  parkName: string;
  sectionName?: string;
  siteName: string;
  checkIn: string;
  checkOut: string;
  bookingUrl: string;
  reservedAt?: string;
  foundAt?: string;
  paidAt?: string;
}

function greetingFor(): string {
  return '<p>Hi camper,</p>';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function siteDetailsList(site: MatchedSite | null, eventLabel?: string, eventAt?: string): string {
  if (!site) {
    return `
      <ul>
        <li><strong>Park:</strong> —</li>
        <li><strong>Site:</strong> —</li>
        <li><strong>Dates:</strong> — → —</li>
      </ul>
    `;
  }

  return `
    <ul>
      <li><strong>Park:</strong> ${escapeHtml(site.parkName)}</li>
      ${site.sectionName ? `<li><strong>Section:</strong> ${escapeHtml(site.sectionName)}</li>` : ''}
      <li><strong>Site:</strong> ${escapeHtml(site.siteName)}</li>
      <li><strong>Dates:</strong> ${escapeHtml(site.checkIn)} → ${escapeHtml(site.checkOut)}</li>
      ${eventLabel && eventAt ? `<li><strong>${eventLabel}:</strong> ${escapeHtml(eventAt)}</li>` : ''}
    </ul>
  `;
}

export function buildOtpEmail(
  otp: string,
  _recipientName?: string | null,
): { subject: string; html: string } {
  const greeting = greetingFor();

  return {
    subject: 'Your campsoon verification code',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:32px auto;color:#1a1a1a">
        <h2 style="color:#16a34a;margin-bottom:8px">Your verification code</h2>
        ${greeting}
        <p>Use this 6-digit code to sign in to campsoon. It expires in 5 minutes.</p>
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
  _recipientName?: string | null,
): { subject: string; html: string } {
  const greeting = greetingFor();
  const subjects: Record<Outcome, string> = {
    found:        `Campsite found at ${site?.parkName ?? tripName}`,
    hold_placed:  `Campsite held — complete your booking`,
    booked:       `Campsite booked! You're going camping`,
    failed:       `Booking failed at ${site?.parkName ?? tripName}`,
  };

  const bodies: Record<Outcome, string> = {
    found: `
      <p>A campsite matching your trip <strong>${escapeHtml(tripName)}</strong> is available:</p>
      ${siteDetailsList(site, 'Found', site?.foundAt)}
      <p>Open campsoon to book it before it's gone.</p>
    `,
    hold_placed: `
      <p>Your campsite for <strong>${escapeHtml(tripName)}</strong> has been held in your cart:</p>
      ${siteDetailsList(site, 'Reserved', site?.reservedAt)}
      <p><a href="${escapeHtml(site?.bookingUrl ?? 'https://camping.bcparks.ca')}">Complete your booking on BC Parks →</a></p>
    `,
    booked: `
      <p>Your campsite for <strong>${escapeHtml(tripName)}</strong> has been successfully booked!</p>
      ${siteDetailsList(site, 'Paid', site?.paidAt)}
      <p>Check your BC Parks account for the booking confirmation.</p>
    `,
    failed: `
      <p>campsoon attempted to book a campsite for <strong>${escapeHtml(tripName)}</strong> but was unsuccessful.</p>
      ${site ? siteDetailsList(site) : ''}
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
          Sent by campsoon — camping.bcparks.ca scanner
        </p>
      </div>
    `,
  };
}
