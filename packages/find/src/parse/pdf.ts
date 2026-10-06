import { PDFParse } from 'pdf-parse';
import { parseLooseDate, parseMoney } from '../util.js';
import { rowsFromTable, type StatementRow } from './statement.js';

const LINE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+(\(?-?\$?[\d,]+\.\d{2}\)?)(?:\s+([A-Z]{3}))?$/;

/**
 * Best-effort PDF statement parser (pdf-parse v2). Tries ruled tables first (`getTable()`), then falls
 * back to "date  description  amount" lines from `getText()`.
 */
export async function parseStatementPdf(bytes: Uint8Array, defaultCurrency = 'USD'): Promise<{ rows: StatementRow[]; warnings: string[]; method: 'table' | 'text' | 'none' }> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const tables = await parser.getTable();
    for (const table of tables.mergedTables.length ? tables.mergedTables : tables.pages.flatMap((p) => p.tables)) {
      const res = rowsFromTable(table, defaultCurrency);
      if (res.rows.length) return { ...res, method: 'table' };
    }
    const text = await parser.getText();
    const rows: StatementRow[] = [];
    for (const raw of text.text.split(/\r?\n/)) {
      const m = raw.trim().replace(/\s+/g, ' ').match(LINE);
      if (!m) continue;
      const date = parseLooseDate(m[1]!);
      const amount = parseMoney(m[3]!);
      if (date && amount !== null) rows.push({ date, descriptor: m[2]!, amount, currency: m[4] ?? defaultCurrency, card: null });
    }
    return { rows, warnings: rows.length ? ['no ruled table found; parsed text lines'] : ['no transactions found in PDF'], method: rows.length ? 'text' : 'none' };
  } finally {
    await parser.destroy();
  }
}
