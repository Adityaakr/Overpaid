// pnpm demo:check: runs every milestone check in order. Exit code 2 from a check means "skipped: prerequisite missing".
import { spawnSync } from 'node:child_process';

const checks: [string, string[], Record<string, string>?][] = [
  ['check-find', ['scripts/check-find.ts']],
  ['check-fix', ['scripts/check-fix.ts'], { RUNS: process.env.RUNS ?? '3' }],
  ['check-specialist-core', ['services/specialist/scripts/dry-run-work.ts']],
  ['check-masumi', ['scripts/check-masumi.ts']],
];
const results: string[] = [];
let failed = false;
for (const [name, args, env] of checks) {
  const r = spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', env: { ...process.env, ...(env ?? {}) } });
  const s = r.status === 0 ? 'passed' : r.status === 2 ? 'skipped (prerequisite missing)' : 'FAILED';
  if (r.status !== 0 && r.status !== 2) failed = true;
  results.push(`${name.padEnd(24)} ${s}`);
}
console.log('\n' + results.join('\n'));
process.exit(failed ? 1 : 0);
