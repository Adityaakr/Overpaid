/**
 * The x402 `exact` / `script` payment offer for one pledge (docs/BRIEF.md "Pledging over x402 (script method)").
 * The facilitator checks only `payTo`; the datum is passed through unverified, so services/bloc builds it here and
 * validates every pledge UTxO (datum + locked value) before counting it.
 */
import { pledgeDatumData, plutusAddressFromBech32, toAikenCbor, type PledgeDatum } from '@overpaid/bloc-contract';
import { NETWORK } from '@overpaid/cardano';
import type { CampaignRecord } from './store.js';
import { MAX_PLEDGE_LOVELACE, PLEDGE_LOCK_LOVELACE } from './units.js';

export function pledgeDatumFor(c: CampaignRecord, refundAddressBech32: string, quantity = 1n, maxUnitPrice = MAX_PLEDGE_LOVELACE): PledgeDatum {
  return { blocId: c.blocIdHex, memberRefundAddress: plutusAddressFromBech32(refundAddressBech32), quantity, maxUnitPrice };
}

export function pledgeOffer(c: CampaignRecord, refundAddressBech32: string) {
  const datum = pledgeDatumFor(c, refundAddressBech32);
  return {
    x402Version: 2,
    error: 'payment required: lock a refundable bloc pledge',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        amount: PLEDGE_LOCK_LOVELACE.toString(),
        asset: 'lovelace',
        payTo: c.scriptAddress,
        maxTimeoutSeconds: 600,
        extra: {
          assetTransferMethod: 'script',
          confirmationPolicy: { l1Confirmations: 0 },
          scriptHash: c.blocHash,
          datum: toAikenCbor(pledgeDatumData(datum)),
        },
      },
    ],
  };
}
