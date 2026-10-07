// Local check: pnpm report statement.csv
import { readFileSync } from 'node:fs';
import { buildReport } from './report.js';

const input = readFileSync(process.argv[2] ?? 0, 'utf8');
const r = await buildReport(input);
console.log(r.text);
console.error(`\n[model: ${r.model}, findings: ${r.audit.findings.length}]`);
