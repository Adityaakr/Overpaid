// Setup against the local payment node with its admin key (read from its .env, never printed).
//   pnpm register key        scoped ReadAndPay runtime key for the selling wallet
//   pnpm register register   Masumi registry listing (Standard, Dynamic pricing)
//   pnpm register            refresh registration state
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { LOCAL, mps } from '../src/mps.js';

mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
const MPS_DIR = process.env.MPS_DIR ?? join(process.env.HOME ?? '', 'masumi-payment-service');
const admin = parseEnv(readFileSync(join(MPS_DIR, '.env'), 'utf8')).ADMIN_KEY ?? '';
const statePath = join(LOCAL, 'registration.json');
const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

const wallets = (await mps<any>('/wallet/list?take=50', undefined, admin)).Wallets as any[];
const seller = wallets.find((w) => w.type === 'Selling');
if (!seller) throw new Error('No selling wallet on the node');
Object.assign(state, { walletId: seller.id, sellerAddress: seller.walletAddress, sourceId: seller.paymentSourceId });

const mode = process.argv[2];
if (mode === 'key') {
  if (state.runtimeKeyId) console.log('runtime key already saved', state.runtimeKeyId);
  else {
    if (state.keyWritePending) throw new Error('Earlier key write is uncertain; inspect API keys first');
    state.keyWritePending = true;
    persist();
    const key = await mps<any>('/api-key', { usageLimited: 'false', UsageCredits: [], NetworkLimit: ['Preprod'], ChainIdLimit: [], canRead: true, canPay: true, canAdmin: false, walletScopeEnabled: true, WalletScopeHotWalletIds: [seller.id], x402WalletScopeEnabled: true, X402WalletScopeEvmWalletIds: [] }, admin);
    if (typeof key.token !== 'string' || key.token.startsWith('*****')) throw new Error('Key token was not revealed');
    writeFileSync(join(LOCAL, 'mps-runtime.env'), `MPS_RUNTIME_TOKEN=${key.token}\n`, { mode: 0o600 });
    Object.assign(state, { runtimeKeyId: key.id, keyWritePending: false });
    console.log('runtime key created', key.id);
  }
} else if (mode === 'register') {
  const apiBaseUrl = process.env.COWORKER_PUBLIC_URL;
  if (!apiBaseUrl?.startsWith('https://')) throw new Error('Set COWORKER_PUBLIC_URL to the public https URL of the agent API');
  if (state.registrationId) console.log('already registered', state.registrationId);
  else {
    if (state.registrationWritePending) throw new Error('Earlier registration write is uncertain; inspect the registry first');
    const sources = await mps<any>('/payment-source?take=50', undefined, admin);
    const source = sources.PaymentSources.find((s: any) => s.id === seller.paymentSourceId);
    const body = {
      network: 'Preprod',
      type: 'Standard',
      sellingWalletVkey: seller.walletVkey,
      supportedPaymentSources: [{ chain: 'Cardano', network: 'Preprod', paymentSourceType: 'Web3CardanoV2', address: source.smartContractAddress, pricing: { pricingType: 'Dynamic' } }],
      ExampleOutputs: [],
      Tags: ['finance', 'subscriptions', 'refunds', 'audit', 'overpaid'],
      name: 'Overpaid Recovery Auditor',
      description: 'Turns a card statement (CSV) into a ranked list of money to recover: forgotten subscriptions, duplicate charges and above-market bills, each with its source rows and a ready-to-send merchant message.',
      Capability: { name: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5', version: '1' },
      Author: { name: 'Overpaid' },
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    };
    Object.assign(state, { registrationWritePending: true, request: body });
    persist();
    const r = await mps<any>('/registry', body, admin);
    Object.assign(state, { registrationId: r.id, registrationWritePending: false, state: r.state });
    console.log('registration submitted', r.id, r.state);
  }
} else if (mode === 'update') {
  // New public URL for the agent API, same agentIdentifier (no new registry NFT).
  const apiBaseUrl = process.env.COWORKER_PUBLIC_URL;
  if (!apiBaseUrl?.startsWith('https://') || !state.agentIdentifier) throw new Error('Need COWORKER_PUBLIC_URL and a confirmed registration');
  const { sellingWalletVkey: _vkey, ...rest } = state.request;
  // The listing copy is refreshed with the URL so the registry page matches the product.
  const listing = {
    name: 'Clawback Recovery Auditor',
    description: 'Statement export in, sourced recovery list out: every recurring charge priced per year, duplicates, bank fees and price rises with their rows, and a ready-to-send message per merchant. Same engine as the Clawback app.',
    Tags: ['finance', 'subscriptions', 'refunds', 'audit', 'recovery', 'clawback'],
    ExampleOutputs: [{ name: 'Recovery list', url: 'https://github.com/Adityaakr/Overpaid/blob/main/docs/COWORKER.md', mimeType: 'text/markdown' }],
    Author: { name: 'Clawback', organization: 'Clawback', contactEmail: 'adityakrx7@gmail.com' },
  };
  const r = await mps<any>('/registry/update', { ...rest, ...listing, agentIdentifier: state.agentIdentifier, apiBaseUrl: apiBaseUrl.replace(/\/+$/, '') }, admin);
  Object.assign(state, { request: { ...state.request, ...listing, apiBaseUrl }, updateState: r.state ?? r.updateStatus ?? 'submitted' });
  console.log('registry update submitted', r.id ?? '', r.state ?? '');
} else {
  const r = await mps<any>('/registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100', undefined, admin);
  const mine = (r.Assets ?? r.RegistryRequests ?? r.registryRequests ?? []).find((x: any) => x.id === state.registrationId);
  if (mine) Object.assign(state, { state: mine.state, agentIdentifier: mine.agentIdentifier, supportedPaymentSourceIndex: 0, tx: mine.CurrentTransaction?.txHash ?? null, error: mine.error ?? null });
  console.log(JSON.stringify({ id: state.registrationId, state: state.state, agentIdentifier: state.agentIdentifier, tx: state.tx, error: state.error }));
}
persist();
