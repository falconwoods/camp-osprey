import { describe, it, expect } from 'vitest';
import { buildResultEmail } from '../lib/email';

const site = {
  parkName: 'Alice Lake',
  siteName: '67',
  checkIn: '2026-07-05',
  checkOut: '2026-07-06',
  bookingUrl: 'https://camping.bcparks.ca/create-booking/results',
};

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

  it('failed with null site falls back to trip name', () => {
    const { subject } = buildResultEmail('failed', null, 'Weekend Trip');
    expect(subject).toBe('Booking failed at Weekend Trip');
  });
});
