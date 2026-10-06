import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { VIGIL_TYPES, type Opportunity, type VigilType } from '@overpaid/shared';
import { DETECTORS, type DetectorContext } from './detectors.js';
import { normaliseWithModel, type ModelNormaliser } from './normalise.js';
import { parseEmail } from './parse/email.js';
import { parseMbox } from './parse/mbox.js';
import { parseStatementPdf } from './parse/pdf.js';
import { parseStatementCsv, toTransactions, type StatementRow } from './parse/statement.js';
import { loadPolicies, type PolicyLibrary } from './policies.js';
import { buildSubscriptions } from './subscriptions.js';
import { CatalogFile, type Catalog, type EmailRecord, type FindResult, type FindTransaction, type SourceFile } from './types.js';
import { shortHash, todayIso } from './util.js';

export interface FindFile {
  name: string;
  bytes: Uint8Array;
}
export type FindInput = { files: FindFile[] } | { dir: string };

export interface FindOptions {
  /** "Today" for date-window rules. Default: the real date. The demo passes DEMO_TODAY. */
  today?: string;
  /** Time zone used to turn email timestamps into dates. Default UTC. */
  timeZone?: string;
  /** Currency for statements without a currency column. Default USD. */
  defaultCurrency?: string;
  policies?: PolicyLibrary;
  /** Which vigils to run. Default: all. */
  vigils?: VigilType[];
  /** Optional model fallback for descriptors no rule knows. It only ever receives redacted text. */
  modelNormalise?: ModelNormaliser;
}

function walk(dir: string, root = dir): FindFile[] {
  const out: FindFile[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p, root));
    else out.push({ name: relative(root, p), bytes: readFileSync(p) });
  }
  return out;
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)(?:\.gz)?$/)?.[1] ?? '';

/** Run the whole Find pipeline: parse -> normalise -> recurring -> detect. */
export async function runFind(input: FindInput, opts: FindOptions = {}): Promise<FindResult> {
  const t0 = performance.now();
  const today = opts.today ?? todayIso();
  const currency = opts.defaultCurrency ?? 'USD';
  const policies = opts.policies ?? loadPolicies();
  const files = 'dir' in input ? walk(input.dir) : input.files;

  // 1. Parse
  const sources: SourceFile[] = [];
  const emails: EmailRecord[] = [];
  const statements: { sourceId: string; rows: StatementRow[] }[] = [];
  const catalogs: Catalog[] = [];
  for (const f of files) {
    const id = `src_${shortHash(f.name)}`;
    const src: SourceFile = { id, name: f.name, kind: 'ignored', records: 0, warnings: [] };
    sources.push(src);
    try {
      switch (ext(f.name)) {
        case 'eml':
          src.kind = 'eml';
          emails.push(await parseEmail(f.bytes, id, { timeZone: opts.timeZone }));
          src.records = 1;
          break;
        case 'mbox': {
          src.kind = 'mbox';
          const list = await parseMbox(f.bytes, id, { timeZone: opts.timeZone, gz: f.name.toLowerCase().endsWith('.gz') });
          emails.push(...list);
          src.records = list.length;
          break;
        }
        case 'csv': {
          src.kind = 'statement_csv';
          const { rows, warnings } = parseStatementCsv(decode(f.bytes), currency);
          statements.push({ sourceId: id, rows });
          src.records = rows.length;
          src.warnings.push(...warnings);
          break;
        }
        case 'pdf': {
          src.kind = 'statement_pdf';
          const { rows, warnings } = await parseStatementPdf(f.bytes, currency);
          statements.push({ sourceId: id, rows });
          src.records = rows.length;
          src.warnings.push(...warnings);
          break;
        }
        case 'json': {
          const parsed = CatalogFile.safeParse(JSON.parse(decode(f.bytes)));
          if (parsed.success) {
            src.kind = 'catalog';
            catalogs.push({ ...parsed.data, sourceId: id });
            src.records = parsed.data.items.length;
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      src.warnings.push(`could not parse: ${(err as Error).message}`);
    }
  }
  // De-duplicate emails seen in both an mbox and an .eml export.
  const seen = new Set<string>();
  const uniqueEmails = emails.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const t1 = performance.now();

  // 2. Normalise
  const transactions: FindTransaction[] = statements.flatMap((s) => toTransactions(s.rows, s.sourceId));
  if (opts.modelNormalise) {
    for (const t of transactions) {
      if (t.normalisedBy !== 'cleanup') continue;
      const who = await normaliseWithModel(t.descriptor, opts.modelNormalise);
      Object.assign(t, { merchant: who.merchant, merchantKey: who.merchantKey, normalisedBy: who.rule });
    }
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const t2 = performance.now();

  // 3. Recurring
  const subscriptions = buildSubscriptions(transactions, uniqueEmails);
  const t3 = performance.now();

  // 4-5. Policies + detectors
  const ctx: DetectorContext = { today, transactions, emails: uniqueEmails, subscriptions, catalogs, policies };
  const opportunities: Opportunity[] = (opts.vigils ?? [...VIGIL_TYPES]).flatMap((v) => DETECTORS[v](ctx));
  opportunities.sort((a, b) => b.valueEstimate - a.valueEstimate || a.id.localeCompare(b.id));
  const t4 = performance.now();

  const totalCurrency = opportunities[0]?.currency ?? currency;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    sources,
    emails: uniqueEmails,
    transactions,
    subscriptions,
    opportunities,
    total: {
      amount: opportunities.filter((o) => o.currency === totalCurrency).reduce((a, o) => a + o.valueEstimate, 0),
      currency: totalCurrency,
      count: opportunities.length,
    },
    timings: { parseMs: r(t1 - t0), normaliseMs: r(t2 - t1), recurringMs: r(t3 - t2), detectMs: r(t4 - t3), totalMs: r(t4 - t0) },
  };
}
