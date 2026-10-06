import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { classifyEmail, extractFields, parseDuration, parseEmail } from '../src/parse/email.js';
import { parseMbox } from '../src/parse/mbox.js';
import { parseStatementPdf } from '../src/parse/pdf.js';
import { parseStatementCsv, refFromDescriptor, toTransactions } from '../src/parse/statement.js';

const EML = [
  'From: Parcelo Market <notify@parcelo.demo>',
  'To: Alex Rivera <alex.rivera@demo.overpaid.test>',
  'Subject: Your order PM-88213 has shipped',
  'Message-ID: <fixture-1@parcelo.demo>',
  'Date: Tue, 08 Sep 2026 03:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Alex,',
  '',
  'Order number: PM-88213',
  '',
  'Item: USB-C dock',
  '',
  'Shipped on: 8 September 2026',
  '',
  'Estimated delivery: =',
  '16 September 2026',
  '',
  'Call us on +65 6123 4567.',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Order number: PM-88213</p>',
  '--b1--',
  '',
].join('\r\n');

describe('email parsing (postal-mime)', () => {
  it('parses an .eml into a classified record with extracted fields and a redacted excerpt', async () => {
    const r = await parseEmail(new TextEncoder().encode(EML), 'src_1');
    expect(r).toMatchObject({ merchantKey: 'parcelo', kind: 'shipped', date: '2026-09-08', messageId: '<fixture-1@parcelo.demo>' });
    expect(r.fields).toMatchObject({ orderId: 'PM-88213', item: 'USB-C dock', shippedOn: '2026-09-08', promisedBy: '2026-09-16' });
    expect(r.excerpt).toContain('[phone]');
    expect(r.excerpt).not.toContain('6123');
  });
  it('classifies subjects', () => {
    expect(classifyEmail('Your 7-day Vistaflix free trial has started')).toBe('trial_started');
    expect(classifyEmail('Your free trial has ended: welcome to Basic with ads')).toBe('trial_converted');
    expect(classifyEmail('Delay notice: SK 218 SIN to NRT')).toBe('delay');
    expect(classifyEmail('Delivered: your order PM-88190')).toBe('delivered');
    expect(classifyEmail('Order confirmed: CW-4417')).toBe('order_confirmation');
    expect(classifyEmail('You watched The Long Orbit: what did you think?')).toBe('usage');
    expect(classifyEmail('New on Vistaflix in May')).toBe('other');
    expect(classifyEmail('Your Vistaflix receipt for 2 May 2026')).toBe('receipt');
  });
  it('extracts flight delay fields', () => {
    const f = extractFields('Booking reference: SKX7Q2\nFlight: SK 218\nDelay: 4h 12m\nReason category: Technical, carrier responsibility\nFare paid: $486.00');
    expect(f).toMatchObject({ bookingRef: 'SKX7Q2', flight: 'SK 218', delayMinutes: 252, delayCategory: 'Technical, carrier responsibility', amount: 48600 });
    expect(parseDuration('3 hours 5 minutes')).toBe(185);
    expect(parseDuration('45 min')).toBe(45);
  });
});

describe('mbox parsing (mbox-reader)', () => {
  it('yields every message in an mbox', async () => {
    const msg2 = EML.replace('fixture-1', 'fixture-2').replace('has shipped', 'was delivered').replace(/Subject: .*/, 'Subject: Delivered: your order PM-88213');
    const mbox = `From notify@parcelo.demo Tue Sep  8 03:00:00 2026\r\n${EML}\r\nFrom notify@parcelo.demo Wed Sep 16 03:00:00 2026\r\n${msg2}\r\n`;
    const list = await parseMbox(new TextEncoder().encode(mbox), 'src_mbox');
    expect(list.map((e) => e.kind)).toEqual(['shipped', 'delivered']);
    expect(new Set(list.map((e) => e.id)).size).toBe(2);
  });
});

describe('statement CSV (csv-parse)', () => {
  it('maps flexible headers, signs credits and pulls order refs', () => {
    const csv = 'Transaction Date,Merchant,Debit,Credit,Card Number\n2026-09-21,CARTWELL.COM ORDER CW-4417,49.99,,**** 4417\n21/09/2026,"URBAN THREADS, REFUND",,29.90,4417\nbad,row,,,\n';
    const { rows, warnings } = parseStatementCsv(csv);
    expect(rows).toEqual([
      { date: '2026-09-21', descriptor: 'CARTWELL.COM ORDER CW-4417', amount: 4999, currency: 'USD', card: '4417' },
      { date: '2026-09-21', descriptor: 'URBAN THREADS, REFUND', amount: -2990, currency: 'USD', card: '4417' },
    ]);
    expect(warnings).toHaveLength(1);
    const [t] = toTransactions(rows, 'src_csv');
    expect(t).toMatchObject({ merchantKey: 'cartwell', orderId: 'CW-4417' });
  });
  it('finds refs only after the merchant stem', () => {
    expect(refFromDescriptor('SKYLANE AIR TKT SKX7Q2')).toBe('SKX7Q2');
    expect(refFromDescriptor('PARCELO MKT PM-88213')).toBe('PM-88213');
    expect(refFromDescriptor('VISTAFLIX*STREAM 8889')).toBeNull();
    expect(refFromDescriptor('BEANHOUSE COFFEE 0231')).toBeNull();
  });
});

function makePdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { CreationDate: new Date('2026-10-06T00:00:00Z') } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    draw(doc);
    doc.end();
  });
}

const ROWS = [
  ['Date', 'Description', 'Amount'],
  ['2026-09-21', 'CARTWELL.COM ORDER CW-4417', '49.99'],
  ['2026-09-21', 'CARTWELL.COM ORDER CW-4417', '49.99'],
  ['2026-10-02', 'VISTAFLIX*STREAM 8889', '22.99'],
];

describe('statement PDF (pdf-parse v2)', () => {
  it('reads a ruled table via getTable()', async () => {
    const pdf = await makePdf((doc) => {
      const x = [40, 140, 420, 520];
      const rowH = 24;
      ROWS.forEach((row, i) => {
        const y = 80 + i * rowH;
        row.forEach((cell, j) => doc.fontSize(10).text(cell, x[j]! + 4, y + 7, { width: x[j + 1]! - x[j]! - 8, lineBreak: false }));
      });
      for (let i = 0; i <= ROWS.length; i++) doc.moveTo(x[0]!, 80 + i * rowH).lineTo(x[3]!, 80 + i * rowH).stroke();
      for (const xi of x) doc.moveTo(xi, 80).lineTo(xi, 80 + ROWS.length * rowH).stroke();
    });
    const res = await parseStatementPdf(pdf);
    expect(res.rows.map((r) => [r.date, r.descriptor, r.amount])).toEqual(ROWS.slice(1).map((r) => [r[0], r[1], Math.round(Number(r[2]) * 100)]));
    expect(res.method).toBe('table');
  });
  it('falls back to text lines when there is no ruled table', async () => {
    const pdf = await makePdf((doc) => {
      doc.fontSize(10).text('Card statement, Visa ending 4417');
      for (const r of ROWS.slice(1)) doc.text(`${r[0]}   ${r[1]}   $${r[2]}`);
    });
    const res = await parseStatementPdf(pdf);
    expect(res.method).toBe('text');
    expect(res.rows.map((r) => r.amount)).toEqual([4999, 4999, 2299]);
  });
});
