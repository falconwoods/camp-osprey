import { Resend } from 'resend';

const DEFAULT_EMAIL_FROM = 'campsoon <noreply@campsoon.com>';
const BREVO_SEND_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
type EmailProvider = 'brevo' | 'resend';

export class EmailSendError extends Error {
  constructor(
    message: string,
    public provider: EmailProvider,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  return provider === 'resend' ? 'resend' : 'brevo';
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

function parseEmailAddress(value: string): { name?: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: value.trim() };
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
  if (getEmailProvider() === 'brevo') {
    const response = await fetch(BREVO_SEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: parseEmailAddress(getEmailFrom()),
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!response.ok) {
      let message = `Brevo email send failed with status ${response.status}`;
      let code: string | undefined;
      try {
        const error = await response.json();
        if (typeof error?.message === 'string') message = error.message;
        if (typeof error?.code === 'string') code = error.code;
      } catch {
        // Keep the status-based message when Brevo does not return JSON.
      }
      throw new EmailSendError(message, 'brevo', response.status, code);
    }
    return response.json();
  }

  const result = await getResend().emails.send({
    from: getEmailFrom(),
    to,
    subject,
    html,
  });
  if (result.error) {
    throw new EmailSendError(result.error.message, 'resend', undefined, result.error.name);
  }
  return result.data;
}

type Outcome = 'found' | 'reserved' | 'booked' | 'failed';

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
    found:    `Campsite found at ${site?.parkName ?? tripName}`,
    reserved: `Campsite reserved — complete your booking`,
    booked:   `Campsite booked! You're going camping`,
    failed:   `Booking failed at ${site?.parkName ?? tripName}`,
  };

  const bodies: Record<Outcome, string> = {
    found: `
      <p>A campsite matching your trip <strong>${escapeHtml(tripName)}</strong> is available:</p>
      ${siteDetailsList(site, 'Found', site?.foundAt)}
      <p>Open campsoon to book it before it's gone.</p>
    `,
    reserved: `
      <p>Your campsite for <strong>${escapeHtml(tripName)}</strong> has been reserved in your cart:</p>
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
