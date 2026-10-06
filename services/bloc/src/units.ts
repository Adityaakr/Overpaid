/**
 * Units and defaults for the Bargain act.
 *
 * The bloc is denominated in tADA on preprod (docs/BRIEF.md "Test USDM": "otherwise denominate pledges in tADA
 * (capped at 3 tADA) and label it"). All prices on the wire are lovelace (1 tADA = 1_000_000 lovelace).
 *
 * Mapping to the Find act's prices (packages/find: today's plan 2400 cents vs market median `marketMonthly` 1500
 * cents): 1 cent = 1_000 lovelace, so "today's price" 24.00 -> 2.4 tADA and the market median 15.00 -> 1.5 tADA.
 * The ratio (1500 / 2400 = 0.625) is what matters on screen, not the absolute amount.
 *
 * Pledge shape (asset = ADA): a member commits to `quantity = 1` unit at `max_unit_price = 3 tADA` (the cap) and
 * locks `max_unit_price x quantity + MIN_REFUND_RESERVE` lovelace. The reserve keeps every refund output above the
 * ledger min-UTxO even if the winning bid equals the cap (the contract only requires >= max_unit_price x quantity).
 */
export const LOVELACE_PER_TADA = 1_000_000n;
export const LOVELACE_PER_CENT = 1_000n;

export const ASSET_ADA = { policy: '', name: '' } as const;
export const ASSET_LABEL = 'tADA (preprod test ADA)';
export const UNIT_LABEL = '1 x eSIM Europe 30-day 10GB';

/** Max a member can pay per unit (the pledge cap). */
export const MAX_PLEDGE_LOVELACE = 3_000_000n;
/** "Today's price" stand-in (Find: 2400 cents). */
export const MARKET_PRICE_LOVELACE = 2_400n * LOVELACE_PER_CENT;
/** Market reference median (Find: marketMonthly 1500 cents). */
export const MARKET_MEDIAN_LOVELACE = 1_500n * LOVELACE_PER_CENT;
/** Extra lovelace locked with each pledge so the refund output always clears min-UTxO. */
export const MIN_REFUND_RESERVE = 1_500_000n;
/** Smallest refund output the settlement builder will create (base address + 36-byte inline datum ~ 1.1 tADA). */
export const MIN_REFUND_LOVELACE = 1_200_000n;
/** Lovelace locked by one standard pledge. */
export const PLEDGE_LOCK_LOVELACE = MAX_PLEDGE_LOVELACE + MIN_REFUND_RESERVE;

/** Settlement batch size measured on the contract (contracts/bloc/README.md, ~30% mem headroom). */
export const DEFAULT_N_MAX = 40;
export const MEMBERS_CAP = 150;

export const tada = (lovelace: bigint | number) => `${(Number(lovelace) / 1_000_000).toFixed(2)} tADA`;
