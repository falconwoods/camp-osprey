import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { buildOtpEmail, buildResultEmail, getEmailFrom, getEmailProvider, sendEmail } from '../lib/email';

const site = {
  parkName: 'Alice Lake',
  sectionName: 'Main Loop',
  siteName: '67',
  checkIn: '2026-07-05',
  checkOut: '2026-07-06',
  bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
  reservedAt: '2026-05-26T18:10:00.000Z',
};

beforeEach(() => {
  mocks.send.mockReset();
  vi.unstubAllGlobals();
  delete process.env.BREVO_API_KEY;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
});

describe('buildResultEmail', () => {
  it('found — subject includes park name', () => {
    const { subject } = buildResultEmail('found', site, 'My Trip');
    expect(subject).toBe('Campsite found at Alice Lake');
  });

  it('reserved — subject is fixed string', () => {
    const { subject } = buildResultEmail('reserved', site, 'My Trip');
    expect(subject).toBe('Campsite reserved — complete your booking');
  });

  it('booked — subject confirms booking', () => {
    const { subject } = buildResultEmail('booked', site, 'My Trip');
    expect(subject).toBe("Campsite booked! You're going camping");
  });

  it('failed — subject includes park name', () => {
    const { subject } = buildResultEmail('failed', site, 'My Trip');
    expect(subject).toBe('Booking failed at Alice Lake');
  });

  it('html includes park name and dates', () => {
    const { html } = buildResultEmail('found', site, 'My Trip');
    expect(html).toContain('Alice Lake');
    expect(html).toContain('2026-07-05');
    expect(html).toContain('2026-07-06');
  });

  it('reserved html includes section, booking link, and reservation time', () => {
    const { html } = buildResultEmail('reserved', site, 'My Trip');
    expect(html).toContain('Main Loop');
    expect(html).toContain('Site:</strong> 67');
    expect(html).toContain('https://camping.bcparks.ca/create-booking/results');
    expect(html).toContain('Reserved:');
    expect(html).toContain('2026-05-26T18:10:00.000Z');
  });

  it('failed with null site falls back to trip name', () => {
    const { subject } = buildResultEmail('failed', null, 'Weekend Trip');
    expect(subject).toBe('Booking failed at Weekend Trip');
  });

  it('html uses neutral camper greeting even when recipient name is supplied', () => {
    const { html } = buildResultEmail('found', site, 'My Trip', 'Eric');
    expect(html).toContain('Hi camper,');
    expect(html).not.toContain('Hi Eric,');
  });

  it('html includes neutral camper greeting when recipient name is missing', () => {
    const { html } = buildResultEmail('found', site, 'My Trip');
    expect(html).toContain('Hi camper,');
  });

  it('OTP html uses neutral camper greeting when recipient name is supplied', () => {
    const { html } = buildOtpEmail('123456', 'Eric');
    expect(html).toContain('Hi camper,');
    expect(html).not.toContain('Hi Eric,');
    expect(html).toContain('123456');
  });

  it('OTP html includes neutral camper greeting when recipient name is missing', () => {
    const { html } = buildOtpEmail('123456');
    expect(html).toContain('Hi camper,');
  });

  it('does not render email addresses as greeting names', () => {
    const { html } = buildOtpEmail('123456', 'user@example.com');
    expect(html).toContain('Hi camper,');
    expect(html).not.toContain('Hi user@example.com,');
  });
});

describe('sendEmail', () => {
  it('defaults to Brevo when EMAIL_PROVIDER is not configured', () => {
    expect(getEmailProvider()).toBe('brevo');
  });

  it('uses Brevo when EMAIL_PROVIDER is brevo', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 'brevo-123' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.EMAIL_FROM = 'campsoon <login@example.com>';

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).resolves.toEqual({ messageId: 'brevo-123' });

    expect(fetchMock).toHaveBeenCalledWith('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': 'brevo-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'campsoon', email: 'login@example.com' },
        to: [{ email: 'user@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      }),
    });
  });

  it('throws when Brevo returns an error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ message: 'Invalid API key' }),
      { status: 401 },
    )));
    process.env.EMAIL_PROVIDER = 'brevo';

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).rejects.toThrow('Invalid API key');
  });

  it('uses EMAIL_FROM when configured', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.EMAIL_FROM = 'campsoon <login@example.com>';
    mocks.send.mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
    });

    await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'campsoon <login@example.com>',
    }));
  });

  it('falls back to the default sender when EMAIL_FROM is not configured', () => {
    expect(getEmailFrom()).toBe('campsoon <noreply@campsoon.com>');
  });

  it('throws when Resend returns an error response', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Domain is not verified' },
    });

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).rejects.toThrow('Domain is not verified');
  });

  it('returns the Resend email id when send succeeds', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    mocks.send.mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
    });

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).resolves.toEqual({ id: 'email-123' });
  });
});
