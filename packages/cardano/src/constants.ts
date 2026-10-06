import { MASUMI_DEFAULT_DEPLOYMENT, MASUMI_REGISTRY_POLICY_ID, masumiEscrowAddress } from '@x402/cardano';

/** Preprod only (docs/BRIEF.md <cardano>). */
export const NETWORK = 'cardano:preprod' as const;
export const NETWORK_ID = 0;
export const DEFAULT_BLOCKFROST_BASE_URL = 'https://cardano-preprod.blockfrost.io/api/v0';
export const EXPLORER = 'https://preprod.cardanoscan.io';

/** Masumi vested_pay v2 shared escrow on preprod: addr_test1wzs4e6wc…n37w4g (docs/research/vested-pay-v2.md §2). */
export const ESCROW_ADDRESS: string = masumiEscrowAddress(NETWORK);
export const ESCROW_SCRIPT_HASH = 'a15ce9d82d2f67645fc624e2edac03c6f1c106d0ad1af5815a3b14ad';
export const REGISTRY_POLICY_ID: string = MASUMI_REGISTRY_POLICY_ID;
export const DEPLOYMENT = MASUMI_DEFAULT_DEPLOYMENT;
/** vested_pay cooldown_period on preprod (7 min). */
export const COOLDOWN_MS = BigInt(MASUMI_DEFAULT_DEPLOYMENT.cooldownPeriod);

export const txUrl = (txHash: string) => `${EXPLORER}/transaction/${txHash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
