// Spreads tADA from the treasury to the working wallets in one transaction (one faucet request funds everything).
// Usage: npx tsx --env-file=.env scripts/fund.ts            (defaults below)
import { Address, Assets, TransactionHash } from '@evolution-sdk/evolution';
import { account, requireBlockfrost, blockfrost, awaitTx, spendableWalletUtxos, txUrl } from '@overpaid/cardano';

const PLAN: [string, number][] = [
  ['overpaid-buyer', 40],
  ['specialist-seller', 25],
  ['bloc-admin', 60],
  ['provider-1', 3],
  ['provider-2', 3],
  ['provider-3', 3],
];

const bf = requireBlockfrost();
const treasury = account('treasury');
const client = treasury.signingClient(bf);
const wallet = spendableWalletUtxos(await client.getWalletUtxos());
const have = wallet.reduce((s, u) => s + Assets.lovelaceOf(u.assets), 0n);
const need = PLAN.reduce((s, [, a]) => s + BigInt(a * 1_000_000), 0n);
if (have < need + 2_000_000n) {
  console.log(`treasury has ${Number(have) / 1e6} tADA, needs ${Number(need) / 1e6 + 2}. Fund ${treasury.address} from the faucet first.`);
  process.exit(2);
}
let tx = client.newTx();
for (const [name, ada] of PLAN) tx = tx.payToAddress({ address: Address.fromBech32(account(name).address), assets: Assets.fromLovelace(BigInt(ada * 1_000_000)) });
const built = await tx.build({ changeAddress: treasury.ledgerAddress, availableUtxos: wallet });
const hash = TransactionHash.toHex(await (await built.sign()).submit());
console.log(`submitted ${txUrl(hash)}`);
console.log((await awaitTx(blockfrost(bf), hash)) ? 'confirmed' : 'not confirmed yet');
