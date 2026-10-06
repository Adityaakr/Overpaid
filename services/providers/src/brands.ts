/**
 * Three fictional eSIM brands (labelled simulated on screen). Prices in lovelace per unit (one 30-day EU eSIM).
 * Reference: today's price 2.4 tADA, market median 1.5 tADA (Find's 2400 vs 1500 cents, 1 cent = 1000 lovelace).
 */
export interface Brand {
  /** Wallet / key name (seed B account). */
  key: 'provider-1' | 'provider-2' | 'provider-3';
  name: string;
  basePrice: bigint;
  floor: bigint;
  /** Basis points off the base price per 10 members, capped at maxDiscountBps. */
  discountBpsPer10: number;
  maxDiscountBps: number;
  strategy: string;
  /** How the brand reacts to the best rival bid. */
  style: 'undercut' | 'median' | 'decay';
}

export const BRANDS: Brand[] = [
  {
    key: 'provider-1', name: 'Nimbus Mobile (simulated)', basePrice: 1_900_000n, floor: 1_350_000n, discountBpsPer10: 150, maxDiscountBps: 2_500,
    strategy: 'Undercuts the best rival by 0.02 tADA until it reaches its floor.', style: 'undercut',
  },
  {
    key: 'provider-2', name: 'Tern eSIM (simulated)', basePrice: 1_700_000n, floor: 1_450_000n, discountBpsPer10: 60, maxDiscountBps: 1_500,
    strategy: 'Anchors on the 1.5 tADA market median; only goes lower once the bloc passes 50 members.', style: 'median',
  },
  {
    key: 'provider-3', name: 'Kestrel Connect (simulated)', basePrice: 2_100_000n, floor: 1_400_000n, discountBpsPer10: 100, maxDiscountBps: 2_000,
    strategy: 'Opens high, then cuts 5% each round it is not winning.', style: 'decay',
  },
];

export const MARKET_MEDIAN = 1_500_000n;
export const TICK = 10_000n; // quote in 0.01 tADA steps

const roundDown = (x: bigint) => (x / TICK) * TICK;
const clamp = (x: bigint, lo: bigint, hi: bigint) => (x < lo ? lo : x > hi ? hi : x);

export interface Market {
  members: number;
  /** Lowest valid rival bid (lovelace) or null. */
  bestRival: bigint | null;
  /** This brand's previous bid, if any. */
  previous: bigint | null;
  /** Ceiling: the pledges' max unit price. */
  maxUnitPrice: bigint;
}

/** Quantity-discounted list price for the bloc size. */
export function listPrice(b: Brand, members: number): bigint {
  const bps = Math.min(b.maxDiscountBps, Math.floor(members / 10) * b.discountBpsPer10);
  return (b.basePrice * BigInt(10_000 - bps)) / 10_000n;
}

/** Next unit price (lovelace), never below the floor or above the pledges' max price. */
export function quote(b: Brand, m: Market): bigint {
  const list = listPrice(b, m.members);
  let p: bigint;
  switch (b.style) {
    case 'undercut':
      p = m.bestRival !== null && m.bestRival - 20_000n < list ? m.bestRival - 20_000n : list;
      break;
    case 'median':
      p = m.members > 50 ? (list < MARKET_MEDIAN ? list : MARKET_MEDIAN - 30_000n) : list < MARKET_MEDIAN ? MARKET_MEDIAN : list;
      break;
    case 'decay': {
      const winning = m.previous !== null && (m.bestRival === null || m.previous <= m.bestRival);
      p = m.previous === null ? list : winning ? m.previous : (m.previous * 95n) / 100n;
      if (p > list) p = list;
      break;
    }
  }
  return roundDown(clamp(p, b.floor, m.maxUnitPrice));
}
