import { describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';

const TODAY = '2026-10-07';
const bank = [
  'Date,Description,Amount',
  ...['07', '08', '09'].flatMap((m) => [
    `2026-${m}-02,Salary credit - Acme,4200.00`,
    `2026-${m}-03,Rent payment,-1350.00`,
    `2026-${m}-06,Cloud hosting subscription,-49.00`,
    `2026-${m}-15,Mobile plan,-32.00`,
    `2026-${m}-11,Restaurant,-${m === '08' ? '37.65' : '42.30'}`,
  ]),
].join('\n');

describe('audit on real-world statements', () => {
  it('turns a bank export into reviewable recurring charges and keeps rent as a fixed cost', async () => {
    const a = await audit(bank, TODAY);
    expect(a.ok).toBe(true);
    expect(a.items.map((i) => [i.kind, i.title, i.cents])).toEqual([
      ['cancel_or_keep', 'Cloud Hosting', 58800],
      ['negotiate', 'Mobile Plan', 38400],
    ]);
    expect(a.fixed.map((f) => f.title)).toEqual(['Rent']);
    expect(a.moneyInCents).toBe(1260000);
    expect(a.reviewYearCents).toBe(97200);
  });

  it('finds a price rise, a duplicate and a fee', async () => {
    const csv = 'Date,Description,Debit,Credit\n07/01/2026,SPOTIFY,10.99,\n08/01/2026,SPOTIFY,10.99,\n09/01/2026,SPOTIFY,12.99,\n08/22/2026,AMAZON MKTP,84.20,\n08/22/2026,AMAZON MKTP,84.20,\n08/20/2026,FOREIGN TRANSACTION FEE,3.21,\n07/15/2026,PAYROLL,,4000.00\n';
    const a = await audit(csv, TODAY);
    const kinds = a.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['price_increase', 'duplicate', 'fee', 'cancel_or_keep']));
    expect(a.items.find((i) => i.kind === 'price_increase')!.cents).toBe(2400);
    expect(a.claimCents).toBe(8420 + 321);
  });

  it('explains what it needs when there is no table', async () => {
    const a = await audit('please audit my spending', TODAY);
    expect(a.ok).toBe(false);
    expect(a.warnings[0]).toMatch(/date/);
  });
});
