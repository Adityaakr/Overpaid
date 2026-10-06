import { Address, Assets, Effect, TransactionHash, Transaction, UTxO, preprod } from '@evolution-sdk/evolution';
import { makeTxBuilder } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import { buildMasumiLock, validateMasumiExtra, type ClientCardanoSigner } from '@x402/cardano';
import type { FacilitatorClient } from '@x402/core/server';
import { accountFromMnemonic, DEFAULT_BLOCKFROST_BASE_URL, inProcessFacilitator } from '@overpaid/cardano';
import { loadConfig } from '../src/config.js';

export const SELLER = accountFromMnemonic('specialist-seller', `${'abandon '.repeat(23)}art`);
export const BUYER = accountFromMnemonic('overpaid-buyer', `${'zoo '.repeat(23)}vote`);

export const testConfig = (over: Record<string, string> = {}) =>
  loadConfig({ SPECIALIST_PUBLIC_URL: 'http://localhost:4200', SKYLANE_BASE: '', ...over } as NodeJS.ProcessEnv);

/** Real in-process facilitator for getSupported (offline), stubbed verify/settle (no chain). */
export function stubFacilitator(): FacilitatorClient & { settled: number } {
  const real = inProcessFacilitator({ baseUrl: DEFAULT_BLOCKFROST_BASE_URL, projectId: '' });
  const f = {
    settled: 0,
    getSupported: () => real.getSupported(),
    verify: async (p: { payload: unknown }) => ({ isValid: true, payer: BUYER.address }) as never,
    settle: async (p: { payload: { transaction: string } }, r: { network: string }) => {
      f.settled++;
      const { decodeCardanoTransaction } = await import('@x402/cardano');
      return { success: true, transaction: decodeCardanoTransaction(p.payload.transaction).txHash, network: r.network, payer: BUYER.address, extra: { status: 'confirmed', confirmations: 1 } } as never;
    },
  };
  return f as never;
}

const txh = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

/** A buyer signer that builds the masumi lock tx fully offline (fixture UTxO, fixed params). Unsigned: the stub facilitator does not check witnesses. */
export function offlineBuyerSigner(): ClientCardanoSigner {
  return {
    getAddress: () => BUYER.address,
    async buildAndSignPaymentTransaction(input) {
      const schema = validateMasumiExtra(input.extra, input.network);
      if (!schema.ok) throw new Error(schema.detail);
      const lock = buildMasumiLock(schema.extra, BUYER.address, input.asset, BigInt(input.amount), 4310n);
      const nonce = new UTxO.UTxO({ transactionId: TransactionHash.fromHex(txh(7)), index: 0n, address: Address.fromBech32(BUYER.address), assets: Assets.fromLovelace(50_000_000n) });
      const r = await makeTxBuilder({ chain: preprod })
        .collectFrom({ inputs: [nonce] })
        .payToAddress({ address: Address.fromBech32(input.payTo), assets: Assets.fromLovelace(lock.lockedLovelace), datum: lock.datum })
        .setValidity({ to: BigInt(schema.extra.terms.payByTime) })
        .build({ changeAddress: Address.fromBech32(BUYER.address), availableUtxos: [nonce], autoMinUtxo: false, fullProtocolParameters: PARAMS, evaluator: { evaluate: () => Effect.succeed([]) } });
      const tx = await r.toTransaction();
      return { transaction: Buffer.from(Transaction.toCBORBytes(tx)).toString('base64'), nonce: `${txh(7)}#0` };
    },
  };
}

const cm = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 1000 + i]));
const PARAMS = {
  minFeeA: 44, minFeeB: 155381, maxTxSize: 16384, maxValSize: 5000, keyDeposit: 2_000_000n, poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n, govActionDeposit: 100_000_000_000n, priceMem: 0.0577, priceStep: 0.0000721,
  maxTxExMem: 14_000_000n, maxTxExSteps: 10_000_000_000n, coinsPerUtxoByte: 4310n, collateralPercentage: 150,
  maxCollateralInputs: 3, minFeeRefScriptCostPerByte: 15, costModels: { PlutusV1: cm(166), PlutusV2: cm(175), PlutusV3: cm(297) },
};

export const TASK = { merchant: 'skylane', vigil: 'flight_compensation', booking_ref: 'SKX7Q2', passenger_name: 'Alex Tan', payout: 'original_card' } as const;
export const BODY = { identifier_from_purchaser: 'a1b2c3d4e5f60718293a', input_data: TASK };
