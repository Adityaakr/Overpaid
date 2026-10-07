import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from '../src/parse/statement.js';
import { parseMoney, parseLooseDate } from '../src/util.js';

describe('real-world statement exports', () => {
  it('reads money in the common formats', () => {
    expect(parseMoney('$1,234.56')).toBe(123456);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('(12.30)')).toBe(-1230);
    expect(parseMoney('12.00-')).toBe(-1200);
    expect(parseMoney('45.00 CR')).toBe(-4500);
    expect(parseMoney('USD 5.00')).toBe(500);
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('')).toBeNull();
  });

  it('reads dates in the common formats', () => {
    expect(parseLooseDate('2026/07/03')).toBe('2026-07-03');
    expect(parseLooseDate('03.07.2026')).toBe('2026-07-03');
    expect(parseLooseDate('07/03/2026', 'mdy')).toBe('2026-07-03');
    expect(parseLooseDate('03-Jul-26')).toBe('2026-07-03');
  });

  it('treats a bank export with negative money out as charges', () => {
    const { rows } = parseStatementCsv('Date,Description,Amount\n2026-07-02,Salary,4200.00\n2026-07-03,Rent,-1350.00\n2026-07-06,Cloud hosting,-49.00\n');
    expect(rows.map((r) => r.amount)).toEqual([-420000, 135000, 4900]);
  });

  it('reads semicolon exports with European decimals and debit/credit columns', () => {
    const csv = 'Buchungstag;Booking date;Transaction details;Debit;Credit\n;03.07.2026;Spotify;9,99;\n;04.07.2026;Refund;;5,00\n';
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-07-03', descriptor: 'Spotify', amount: 999 });
    expect(rows[1]!.amount).toBe(-500);
  });

  it('works out US month-first dates from the whole column', () => {
    const { rows } = parseStatementCsv('Posted Date,Payee,Amount\n07/03/2026,NETFLIX,15.49\n07/28/2026,NETFLIX,15.49\n');
    expect(rows.map((r) => r.date)).toEqual(['2026-07-03', '2026-07-28']);
  });
});
