import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { buildOtpEmail, buildResultEmail, getEmailFrom, sendEmail } from '../lib/email';

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
  delete process.env.EMAIL_FROM;
});

describe('buildResultEmail', () => {
  it('found — subject includes park name', () => {
    const { subject } = buildResultEmail('found', site, 'My Trip');
    expect(subject).toBe('Campsite found at Alice Lake');
  });

  it('hold_placed — subject is fixed string', () => {
    const { subject } = buildResultEmail('hold_placed', site, 'My Trip');
    expect(subject).toBe('Campsite held — complete your booking');
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

  it('hold_placed html includes section, booking link, and reservation time', () => {
    const { html } = buildResultEmail('hold_placed', site, 'My Trip');
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

  it('html includes greeting when recipient name is supplied', () => {
    const { html } = buildResultEmail('found', site, 'My Trip', 'Eric');
    expect(html).toContain('Hi Eric,');
  });

  it('html omits greeting when recipient name is missing', () => {
    const { html } = buildResultEmail('found', site, 'My Trip');
    expect(html).not.toContain('Hi ,');
  });

  it('OTP html includes greeting when recipient name is supplied', () => {
    const { html } = buildOtpEmail('123456', 'Eric');
    expect(html).toContain('Hi Eric,');
    expect(html).toContain('123456');
  });

  it('OTP html omits greeting when recipient name is missing', () => {
    const { html } = buildOtpEmail('123456');
    expect(html).not.toContain('Hi ,');
  });

  it('escapes recipient name in greetings', () => {
    const { html } = buildOtpEmail('123456', '<Eric>');
    expect(html).toContain('Hi &lt;Eric&gt;,');
    expect(html).not.toContain('Hi <Eric>,');
  });
});

describe('sendEmail', () => {
  it('uses EMAIL_FROM when configured', async () => {
    process.env.EMAIL_FROM = 'CampOsprey <login@example.com>';
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
      from: 'CampOsprey <login@example.com>',
    }));
  });

  it('falls back to the default sender when EMAIL_FROM is not configured', () => {
    expect(getEmailFrom()).toBe('CampOsprey <noreply@camposprey.com>');
  });

  it('throws when Resend returns an error response', async () => {
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
