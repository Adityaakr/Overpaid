// Lists the specialist on the Masumi preprod registry (mints its registry NFT from the seller wallet).
import { account, registerAgent, requireBlockfrost } from '@overpaid/cardano';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
if (cfg.agentIdentifier) {
  console.log(`already registered: ${cfg.agentIdentifier}`);
  process.exit(0);
}
const seller = account('specialist-seller');
const { txHash, agentIdentifier } = await registerAgent(seller, requireBlockfrost(), {
  name: cfg.agentName,
  description: 'Files EU261-style flight delay compensation claims and submits a hashed evidence bundle when the airline shows the payment.',
  apiBaseUrl: cfg.publicUrl,
  authorName: 'Overpaid',
  tags: ['airline', 'compensation', 'claims', 'overpaid'],
  image: `${cfg.publicUrl}/icon.png`,
  priceAsset: 'lovelace',
  priceAmount: cfg.priceLovelace,
});
console.log(JSON.stringify({ txHash, agentIdentifier, url: `https://preprod.cardanoscan.io/transaction/${txHash}` }, null, 2));
