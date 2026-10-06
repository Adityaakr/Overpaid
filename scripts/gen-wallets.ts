// Generates the three preprod seeds (docs/BRIEF.md "Wallets: three seeds, not one") into .env.wallets.
// Never prints mnemonics. Refuses to overwrite an existing file.
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';

const file = new URL('../.env.wallets', import.meta.url);
if (existsSync(file)) {
  console.log('.env.wallets already exists; not overwriting');
  process.exit(0);
}
const seed = () => generateMnemonic(wordlist, 256);
const body = [
  '# Preprod only. Gitignored. Never commit or print.',
  '# Seed A (offline-ish): treasury, specialist-seller, bloc-admin',
  `SEED_A="${seed()}"`,
  '# Seed B (API host): overpaid-buyer, provider-1..3',
  `SEED_B="${seed()}"`,
  '# Seed C (room host, low balance): room-001..150, sim-*',
  `SEED_C="${seed()}"`,
  '',
].join('\n');
writeFileSync(file, body);
chmodSync(file, 0o600);
console.log('wrote .env.wallets (3 seeds, mode 600)');
