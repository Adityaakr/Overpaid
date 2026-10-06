import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
  it('removes card numbers (spaced, dashed, contiguous) and card tails', () => {
    expect(redact('Paid with 4111 1111 1111 1111 today')).toBe('Paid with [card] today');
    expect(redact('card 5500-0000-0000-0004')).toBe('card [card]');
    expect(redact('PAN 4012888888881881')).toBe('PAN [card]');
    expect(redact('Visa ending 4417')).toBe('Visa ending [last4]');
    expect(redact('charged to **** 4417')).toContain('[last4]');
    expect(redact('charged to **** 4417')).not.toContain('4417');
  });
  it('removes email addresses', () => {
    expect(redact('Reply to alex.rivera@demo.overpaid.test please')).toBe('Reply to [email] please');
  });
  it('removes phone numbers', () => {
    expect(redact('Call +65 6123 4567 now')).toBe('Call [phone] now');
    expect(redact('or (555) 123-4567')).toBe('or [phone]');
    expect(redact('mobile 9123 4567')).toBe('mobile [phone]');
  });
  it('removes street addresses, units and postcodes', () => {
    expect(redact('Pickup: 1234 Elm Street, then home')).toBe('Pickup: [address], then home');
    expect(redact('Ship to 88 Orchard Rd #12-03')).toBe('Ship to [address]');
    expect(redact('Blk 123 Ang Mo Kio Ave 3')).toBe('[address]');
    expect(redact('Apt. 4B')).toBe('[address]');
    expect(redact('Singapore 238801')).toBe('[address]');
  });
  it('leaves merchant descriptors, order refs, dates and amounts alone', () => {
    const s = 'VISTAFLIX*STREAM 8889 CW-4417 PM-88213 SKX7Q2 2026-09-21 $49.99 4h 12m';
    expect(redact(s)).toBe(s);
  });
  it('does not touch numbers that fail Luhn and are short', () => {
    expect(redact('Tracking PX1234567890')).toBe('Tracking PX1234567890');
  });
});
