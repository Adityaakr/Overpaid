// Moves the specialist off seed A: sweeps the legacy seller account to the seed-S seller address.
import { TransactionHash } from '@evolution-sdk/evolution';
import { account, awaitTx, blockfrost, requireBlockfrost, spendableWalletUtxos, txUrl } from '@overpaid/cardano';

const bf = requireBlockfrost();
const legacy = account('specialist-seller-legacy');
const next = account('specialist-seller');
const client = legacy.signingClient(bf);
const utxos = spendableWalletUtxos(await client.getWalletUtxos());
if (!utxos.length) {
  console.log(`nothing to sweep at ${legacy.address}`);
  process.exit(0);
}
// Spend everything; the change output (all of it minus the fee) goes to the new seller.
const built = await client.newTx().collectFrom({ inputs: utxos }).build({ changeAddress: next.ledgerAddress, availableUtxos: utxos });
const hash = TransactionHash.toHex(await (await built.sign()).submit());
console.log(`swept ${utxos.length} UTxOs to ${next.address}: ${txUrl(hash)}`);
console.log((await awaitTx(blockfrost(bf), hash)) ? 'confirmed' : 'not confirmed yet');
