// MIP-003 agent API for the Masumi registry listing (Standard access). Sokosumi Tasks go through the worker instead.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport } from './report.js';
import { USAGE } from './audit.js';
import { confirmedState, LOCAL, mps, QUOTE, registration, USDM } from './mps.js';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
// MIP-004: nonce-prefixed hashes for the Standard API. The schema has one string field, so JSON.stringify is canonical.
export const inputHash = (input: { statement: string }, nonce: string) => sha256(`${nonce};${JSON.stringify({ statement: input.statement })}`);
export const resultHash = (result: string, nonce: string) => sha256(`${nonce};${result}`);

const jobs = join(LOCAL, 'standard-jobs');
mkdirSync(jobs, { recursive: true, mode: 0o700 });
const save = (j: any) => writeFileSync(join(jobs, `${j.id}.json`), JSON.stringify(j), { mode: 0o600 });
const load = (id: string) => JSON.parse(readFileSync(join(jobs, `${id}.json`), 'utf8'));
const all = () => readdirSync(jobs).filter((f) => /^[0-9a-f-]{36}\.json$/.test(f)).map((f) => load(f.slice(0, -5)));

const schema = {
  input_data: [
    { id: 'statement', type: 'string', name: 'Card statement (CSV)', data: { description: USAGE }, validations: [{ validation: 'min', value: '20' }, { validation: 'max', value: '200000' }] },
  ],
};
const send = (res: any, status: number, data: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(data)));
const port = Number(process.env.COWORKER_API_PORT ?? 4600);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/availability') return send(res, 200, { status: 'available', type: 'masumi-agent', message: 'Clawback recovery audit: card statement in, sourced recovery list and merchant messages out.' });
    if (req.method === 'GET' && url.pathname === '/input_schema') return send(res, 200, schema);
    if (req.method === 'GET' && url.pathname === '/status') {
      const id = url.searchParams.get('job_id') ?? '';
      if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(join(jobs, `${id}.json`))) return send(res, 404, { error: 'Job not found' });
      const j = load(id);
      return send(res, 200, { id, status: j.status, result: j.status === 'completed' ? j.result : undefined });
    }
    if (req.method !== 'POST' || url.pathname !== '/start_job') return send(res, 404, { error: 'Route not found' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 220_000) return send(res, 413, { error: 'Request too large' });
    }
    const input = JSON.parse(body);
    const nonce = input.identifier_from_purchaser ?? input.identifierFromPurchaser;
    const statement = input.input_data?.statement;
    if (!/^[a-fA-F0-9]{14,26}$/.test(nonce ?? '') || typeof statement !== 'string' || !statement.trim()) return send(res, 400, { error: 'Expected a hex identifier_from_purchaser and input_data.statement' });
    const reg = registration();
    if (!reg || reg.state !== 'RegistrationConfirmed') return send(res, 503, { error: 'Registration not confirmed' });
    const hash = inputHash({ statement }, nonce);
    const prior = all().find((j) => j.nonce === nonce);
    if (prior) return prior.inputHash !== hash ? send(res, 409, { error: 'Nonce already used with another input' }) : send(res, prior.response ? 200 : 409, prior.response ?? { error: 'Payment outcome needs inspection' });
    const now = Date.now();
    const job: any = { id: randomUUID(), nonce, statement, inputHash: hash, status: 'awaiting_payment', phase: 'payment-pending' };
    save(job);
    const payment = await mps('/payment', {
      network: 'Preprod',
      paymentSourceType: 'Web3CardanoV2',
      supportedPaymentSourceIndex: reg.supportedPaymentSourceIndex,
      inputHash: hash,
      agentIdentifier: reg.agentIdentifier,
      identifierFromPurchaser: nonce,
      RequestedFunds: [{ unit: USDM, amount: QUOTE }],
      payByTime: new Date(now + 10 * 60_000).toISOString(),
      submitResultTime: new Date(now + 20 * 60_000).toISOString(),
      unlockTime: new Date(now + 36 * 60_000).toISOString(),
      externalDisputeUnlockTime: new Date(now + 52 * 60_000).toISOString(),
    });
    job.payment = payment;
    job.phase = 'waiting-payment';
    job.response = {
      id: job.id,
      input_hash: hash,
      identifierFromPurchaser: nonce,
      blockchainIdentifier: payment.blockchainIdentifier,
      agentIdentifier: reg.agentIdentifier,
      sellerVKey: payment.SmartContractWallet?.walletVkey,
      paymentSourceType: 'Web3CardanoV2',
      supportedPaymentSourceIndex: reg.supportedPaymentSourceIndex,
      payByTime: Number(payment.payByTime),
      submitResultTime: Number(payment.submitResultTime),
      unlockTime: Number(payment.unlockTime),
      externalDisputeUnlockTime: Number(payment.externalDisputeUnlockTime),
    };
    save(job);
    return send(res, 200, job.response);
  } catch {
    return send(res, 500, { error: 'Request failed; the job state is saved for inspection' });
  }
}).listen(port, '127.0.0.1', () => console.log('coworker agent API on', port));

// Runs paid Standard jobs once escrow is confirmed, then submits the nonce-prefixed result hash.
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    for (const job of all()) {
      if (!['waiting-payment', 'awaiting-result'].includes(job.phase)) continue;
      try {
        const p = await mps('/payment/resolve-blockchain-identifier', { network: 'Preprod', blockchainIdentifier: job.payment.blockchainIdentifier, includeHistory: 'true' });
        if (job.phase === 'awaiting-result') {
          if (p.onChainState === 'ResultSubmitted' && p.resultHash === job.resultHash && confirmedState(p, 'ResultSubmitted')) save({ ...job, phase: 'result-confirmed', status: 'completed' });
          continue;
        }
        if (p.onChainState !== 'FundsLocked' || !confirmedState(p, 'FundsLocked')) continue;
        if (Number(p.submitResultTime) <= Date.now() + 120_000) {
          save({ ...job, phase: 'deadline-blocked', status: 'failed' });
          continue;
        }
        save({ ...job, phase: 'model-pending', status: 'running' });
        const r = await buildReport(job.statement);
        const next = { ...job, result: r.text, resultHash: resultHash(r.text, job.nonce), phase: 'submit-pending', status: 'running' };
        save(next);
        await mps('/payment/submit-result', { network: 'Preprod', blockchainIdentifier: p.blockchainIdentifier, submitResultHash: next.resultHash });
        save({ ...next, phase: 'awaiting-result' });
      } catch {
        console.error('standard job needs inspection', job.id);
      }
    }
  } finally {
    busy = false;
  }
}, 5000);
