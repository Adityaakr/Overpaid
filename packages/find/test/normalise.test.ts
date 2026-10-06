import { describe, expect, it } from 'vitest';
import { MERCHANTS, ESIM_BILL } from '@overpaid/shared';
import { cleanDescriptor, normaliseDescriptor, normaliseSender, normaliseWithModel } from '../src/normalise.js';

describe('merchant normalisation', () => {
  it.each([
    ['VISTAFLIX*STREAM 8889', 'vistaflix', 'Vistaflix'],
    ['SQ *VISTAFLIX*STREAM', 'vistaflix', 'Vistaflix'],
    ['CARTWELL.COM ORDER CW-4417', 'cartwell', 'Cartwell'],
    ['SKYLANE AIR TKT SKX7Q2', 'skylane', 'Skylane Air'],
    ['PARCELO MKT PM-88213', 'parcelo', 'Parcelo Market'],
    ['GLOBEROAM ESIM', 'globeroam', ESIM_BILL.merchant],
    ['TUNEWAVE*PREMIUM', 'tunewave', 'Tunewave'],
  ])('%s -> %s', (descriptor, key, name) => {
    expect(normaliseDescriptor(descriptor)).toMatchObject({ merchantKey: key, merchant: name, matched: true });
  });
  it('covers every demo-world descriptor', () => {
    for (const [key, m] of Object.entries(MERCHANTS)) expect(normaliseDescriptor(`${m.descriptor} 1234`).merchantKey).toBe(key);
  });
  it('cleans unknown descriptors generically', () => {
    expect(cleanDescriptor('SQ *NOODLE BAR 21 #0042')).toBe('Noodle Bar');
    expect(cleanDescriptor('TST* GREEN BOWL CAFE 88')).toBe('Green Bowl Cafe');
    expect(cleanDescriptor('URBAN THREADS REFUND')).toBe('Urban Threads');
    expect(normaliseDescriptor('KOPI CORNER')).toMatchObject({ merchantKey: 'kopi-corner', matched: false });
  });
  it('identifies email senders by domain first', () => {
    expect(normaliseSender({ name: 'Anything', address: `billing@${MERCHANTS.vistaflix.domain}` }).merchantKey).toBe('vistaflix');
    expect(normaliseSender({ name: 'Skylane Air', address: 'x@unknown.example' }).merchantKey).toBe('skylane');
  });
  it('model fallback only sees redacted text and is skipped when a rule matches', async () => {
    const seen: string[] = [];
    const model = async (t: string) => {
      seen.push(t);
      return 'Corner Shop';
    };
    expect((await normaliseWithModel('VISTAFLIX*STREAM', model)).merchantKey).toBe('vistaflix');
    expect(seen).toEqual([]);
    const r = await normaliseWithModel('POS 4111 1111 1111 1111 CORNER call +65 6123 4567', model);
    expect(r).toMatchObject({ merchant: 'Corner Shop', rule: 'model' });
    expect(seen[0]).not.toMatch(/4111|6123/);
    expect(seen[0]).toContain('[card]');
  });
});
