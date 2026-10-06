// Non-custodial bloc pledge on preprod through the API: the server builds, the user's wallet signs.
import { TransactionWitnessSet } from '@evolution-sdk/evolution';
import { account, requireBlockfrost } from '@overpaid/cardano';
import { call, ok } from './check-lib.js';

const bf = requireBlockfrost();
const user = account(process.env.PLEDGE_TEST_WALLET ?? 'room-150');
const client = user.signingClient(bf);
const utxos = await client.getWalletUtxos();
const { AddressEras, Assets, TransactionInput, TransactionOutput, Value } = await import('@evolution-sdk/evolution');
// Encode each UTxO exactly as a CIP-30 wallet's getUtxos() does: CBOR [transaction_input, transaction_output].
const utxoHex = utxos.map((u: any) => {
  const input = new TransactionInput.TransactionInput({ transactionId: u.transactionId, index: BigInt(u.index) });
  const output = new TransactionOutput.ShelleyTransactionOutput({ address: AddressEras.fromBech32(user.address), amount: new Value.OnlyCoin({ coin: Assets.lovelaceOf(u.assets) }) });
  return `82${TransactionInput.toCBORHex(input)}${TransactionOutput.toCBORHex(output)}`;
});
const built = await call('/api/bloc/pledge/build', { address: user.address, utxos: utxoHex.filter(Boolean) });
ok(built.txCbor && built.refundAddress === user.address, `pledge built; refunds go to the user's own address`);
const witness = await client.signTx(built.txCbor, { utxos });
const sub = await call('/api/bloc/pledge/submit', { txCbor: built.txCbor, witnessSet: TransactionWitnessSet.toCBORHex(witness), nickname: 'check-pledge' });
ok(sub.txHash, `user-signed pledge submitted ${sub.txUrl}`);
const mine = await call<any[]>(`/api/bloc/pledges?address=${encodeURIComponent(user.address)}`);
ok(mine.some((p) => p.txHash === sub.txHash && p.via === 'cip30'), `pledge listed under the user's address (${mine.length} total)`);
console.log('check-pledge passed');
