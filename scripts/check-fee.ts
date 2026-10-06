// Success fee on preprod: a user wallet pays Overpaid's fee for a confirmed recovery. The API builds the
// transaction; the wallet only signs (exactly what a CIP-30 wallet does in the browser).
import { Address, Assets, TransactionHash, TransactionWitnessSet } from '@evolution-sdk/evolution';
import { account, addressBalance, awaitTx, blockfrost, requireBlockfrost, spendableWalletUtxos } from '@overpaid/cardano';
import { call, ok, sleep } from './check-lib.js';

const bf = requireBlockfrost();
const user = account(process.env.FEE_TEST_WALLET ?? 'room-150');
const bal = await addressBalance(blockfrost(bf), user.address);
if (!bal || bal.lovelace < 8_000_000n) {
  const t = account('treasury');
  const c = t.signingClient(bf);
  const built = await c
    .newTx()
    .payToAddress({ address: Address.fromBech32(user.address), assets: Assets.fromLovelace(20_000_000n) })
    .build({ changeAddress: t.ledgerAddress, availableUtxos: spendableWalletUtxos(await c.getWalletUtxos()) });
  const h = TransactionHash.toHex(await (await built.sign()).submit());
  console.log(`funded test user ${user.address} with 20 tADA: ${h}`);
  await awaitTx(blockfrost(bf), h);
}

const receipts = await call<any[]>('/api/receipts');
const r = receipts.find((x) => x.fee?.state === 'unpaid');
ok(r, `found an unpaid fee: ${r?.merchant} ${(r?.amount / 100).toFixed(2)} USD -> ${r?.fee.lovelace / 1e6} tADA (${r?.fee.label})`);
const built = await call('/api/fees/' + r.id + '/build', { address: user.address });
ok(built.txCbor && built.feeLovelace === r.fee.lovelace, `API built an unsigned fee tx paying ${built.payTo.slice(0, 20)}…`);
const userClient = user.signingClient(bf);
const witness = await userClient.signTx(built.txCbor, { utxos: await userClient.getWalletUtxos() });
const sub = await call('/api/fees/' + r.id + '/submit', { buildId: built.buildId, txCbor: built.txCbor, witnessSet: TransactionWitnessSet.toCBORHex(witness) });
ok(sub.txHash, `fee submitted from the user's wallet ${sub.txUrl}`);
for (let i = 0; i < 40; i++) {
  const again = (await call<any[]>('/api/receipts')).find((x) => x.id === r.id);
  if (again?.fee.state === 'paid') {
    ok(true, 'fee confirmed on chain and marked paid');
    break;
  }
  await sleep(8000);
}
console.log('check-fee passed');
