// Single source of truth for the demo user's world. The demo merchants seed their accounts from this,
// and the synthetic receipts/statement in data/demo are generated from it, so Find and Fix always agree.
// Every merchant here is fictional and labelled "Demo merchant built for this hackathon".

export const DEMO_USER = {
  name: 'Alex Rivera',
  email: 'alex.rivera@demo.overpaid.test',
  cardLast4: '4417',
  cardBrand: 'Visa',
  country: 'SG',
};

export const PORTS = {
  web: 3000,
  api: 4000,
  vistaflix: 4101,
  cartwell: 4102,
  skylane: 4103,
  parcelo: 4104,
  specialist: 4200,
  bloc: 4300,
  providers: 4400,
  fleet: 4500,
} as const;

export type MerchantKey = 'vistaflix' | 'cartwell' | 'skylane' | 'parcelo';

export const MERCHANTS: Record<MerchantKey, { name: string; kind: string; port: number; descriptor: string; domain: string }> = {
  vistaflix: { name: 'Vistaflix', kind: 'Streaming service', port: PORTS.vistaflix, descriptor: 'VISTAFLIX*STREAM', domain: 'vistaflix.demo' },
  cartwell: { name: 'Cartwell', kind: 'Online shop', port: PORTS.cartwell, descriptor: 'CARTWELL.COM ORDER', domain: 'cartwell.demo' },
  skylane: { name: 'Skylane Air', kind: 'Airline', port: PORTS.skylane, descriptor: 'SKYLANE AIR TKT', domain: 'skylane.demo' },
  parcelo: { name: 'Parcelo Market', kind: 'Marketplace', port: PORTS.parcelo, descriptor: 'PARCELO MKT', domain: 'parcelo.demo' },
};

export const merchantUrl = (k: MerchantKey) => `http://localhost:${MERCHANTS[k].port}`;

// ---- Vistaflix: two forgotten plans (cancel) ----
export const VISTAFLIX_PLANS = [
  {
    id: 'vf-plan-premium',
    plan: 'Premium 4K',
    amount: 2299,
    cadence: 'monthly' as const,
    startedOn: '2026-03-02',
    lastWatched: '2026-05-11', // no viewing since: the "forgotten" signal
    nextRenewal: '2026-10-02',
  },
  {
    id: 'vf-plan-basic',
    plan: 'Basic with ads',
    amount: 699,
    cadence: 'monthly' as const,
    startedOn: '2026-04-18', // converted from a 7-day free trial on 2026-04-11
    lastWatched: null,
    nextRenewal: '2026-10-18',
    fromFreeTrial: true,
  },
];

// ---- Cartwell: one duplicate charge, two price drops inside a 14-day protection window ----
export const CARTWELL_ORDERS = [
  { orderId: 'CW-4417', item: 'Merino travel hoodie', paid: 4999, chargedTimes: 2, date: '2026-09-21' },
  { orderId: 'CW-4502', item: 'Noise-cancelling headphones', paid: 19900, priceNow: 16450, date: '2026-09-28' },
  { orderId: 'CW-4511', item: 'Smart kettle', paid: 8900, priceNow: 6450, date: '2026-09-30' },
  { orderId: 'CW-4380', item: 'Desk lamp', paid: 3450, date: '2026-08-14' },
];
export const CARTWELL_PRICE_PROTECTION_DAYS = 14;

// ---- Skylane Air: a flight delayed more than 3 hours (needs the specialist) ----
export const SKYLANE_FLIGHT = {
  bookingRef: 'SKX7Q2',
  flight: 'SK 218',
  route: 'SIN to NRT',
  date: '2026-09-14',
  scheduledDeparture: '2026-09-14T08:35:00+08:00',
  actualDeparture: '2026-09-14T12:47:00+08:00',
  delayMinutes: 252,
  delayCategory: 'Technical, carrier responsibility',
  fare: 48600,
  compensation: 40000,
  passenger: DEMO_USER.name,
};

// ---- Parcelo Market: two orders shipped but never delivered ----
export const PARCELO_ORDERS = [
  { orderId: 'PM-88213', item: 'USB-C dock', paid: 4290, shippedOn: '2026-09-08', promisedBy: '2026-09-16', delivered: false },
  { orderId: 'PM-88247', item: 'Running shoes', paid: 6725, shippedOn: '2026-09-10', promisedBy: '2026-09-19', delivered: false },
  { orderId: 'PM-88190', item: 'Phone case', paid: 1599, shippedOn: '2026-08-29', promisedBy: '2026-09-05', delivered: true },
];
export const PARCELO_WAITING_DAYS = 7; // non-delivery claims open this many days after the promised date

// ---- Bill above market: an eSIM roaming plan (bloc candidate) ----
export const ESIM_BILL = { merchant: 'GlobeRoam eSIM', plan: 'Asia 20 GB', amount: 2400, cadence: 'monthly' as const, startedOn: '2026-05-03' };

// The eight Fix tasks the demo dataset must produce (plus the bloc candidate).
export const EXPECTED_FIX_TASKS = [
  { merchant: 'vistaflix', vigil: 'forgotten_subscription', ref: 'vf-plan-premium' },
  { merchant: 'vistaflix', vigil: 'forgotten_subscription', ref: 'vf-plan-basic' },
  { merchant: 'cartwell', vigil: 'duplicate_charge', ref: 'CW-4417' },
  { merchant: 'cartwell', vigil: 'price_drop', ref: 'CW-4502' },
  { merchant: 'cartwell', vigil: 'price_drop', ref: 'CW-4511' },
  { merchant: 'parcelo', vigil: 'undelivered_order', ref: 'PM-88213' },
  { merchant: 'parcelo', vigil: 'undelivered_order', ref: 'PM-88247' },
  { merchant: 'skylane', vigil: 'flight_compensation', ref: 'SKX7Q2' },
] as const;

// "Today" for the demo, so date-window logic is deterministic.
export const DEMO_TODAY = '2026-10-06';
