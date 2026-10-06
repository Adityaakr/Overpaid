// Generates the synthetic demo dataset in data/demo/ for the Find pipeline:
//   inbox/*.eml    six months of receipts, rendered with @react-email/render and written as RFC 822 via
//                  Nodemailer's MailComposer, so the demo goes through the real email parser
//   statement.csv  the card statement (~300 rows), consistent with the emails
//   catalog.json   Cartwell's current prices (the price-drop signal source)
//
// Every value about the four demo merchants comes from @overpaid/shared (demo-world.ts). Texture
// merchants (groceries, coffee, rides, utilities, Tunewave, FitPulse ...) are fictional and filled with
// seeded Faker data. Fixed seed + fixed timestamps + fixed MIME boundaries => byte-identical output.
//
// Run: pnpm demo:data   (tsx scripts/generate-demo-data.ts)

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render, toPlainText } from '@react-email/render';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { faker } from '@faker-js/faker';
import {
  CARTWELL_ORDERS,
  DEMO_TODAY,
  DEMO_USER,
  ESIM_BILL,
  MERCHANTS,
  PARCELO_ORDERS,
  SKYLANE_FLIGHT,
  VISTAFLIX_PLANS,
} from '@overpaid/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'demo');
const START = '2026-04-06';
const END = DEMO_TODAY;
const CURRENCY = 'USD';
const SEED = 20261006;

faker.seed(SEED);
const h = React.createElement;

// ---------------------------------------------------------------- dates & money
const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoOf(toMs(iso) + n * DAY);
const inRange = (iso: string) => iso >= START && iso <= END;
function eachDay(fn: (iso: string, weekday: number) => void) {
  for (let ms = toMs(START); ms <= toMs(END); ms += DAY) fn(isoOf(ms), new Date(ms).getUTCDay());
}
/** Monthly dates on `dayOfMonth`, starting at `from`, clipped to the window. */
function monthlyFrom(from: string, dayOfMonth = Number(from.slice(8, 10))): string[] {
  const out: string[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  for (;;) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    if (iso > END) break;
    if (iso >= from && inRange(iso)) out.push(iso);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const cents = (min: number, max: number) => faker.number.int({ min: Math.round(min * 100), max: Math.round(max * 100) });
/** A send time between 09:00 and 19:00 Singapore time (01:00-11:00 UTC, so the UTC date is the local date). */
const sendAt = (iso: string, hourUtc?: number) =>
  `${iso}T${String(hourUtc ?? faker.number.int({ min: 1, max: 10 })).padStart(2, '0')}:${String(faker.number.int({ min: 0, max: 59 })).padStart(2, '0')}:${String(faker.number.int({ min: 0, max: 59 })).padStart(2, '0')}Z`;

// ---------------------------------------------------------------- statement + mail sinks
type Row = { date: string; descriptor: string; amount: number };
const rows: Row[] = [];
const charge = (date: string, descriptor: string, amount: number) => {
  if (inRange(date)) rows.push({ date, descriptor, amount });
};

type Mail = { at: string; fromName: string; fromAddr: string; subject: string; slug: string; body: React.ReactElement };
const mails: Mail[] = [];
const mail = (m: Mail) => {
  if (inRange(m.at.slice(0, 10))) mails.push(m);
};

// ---------------------------------------------------------------- email components (no @react-email/components)
type LayoutProps = { brand: string; accent: string; preheader: string; footer?: string; children?: React.ReactNode };
function Layout({ brand, accent, preheader, footer, children }: LayoutProps) {
  return h(
    'html',
    { lang: 'en' },
    h('head', null, h('meta', { charSet: 'utf-8' }), h('title', null, brand)),
    h(
      'body',
      { style: { margin: 0, background: '#f4f4f5', fontFamily: 'Helvetica, Arial, sans-serif', color: '#18181b' } },
      h('div', { style: { display: 'none', maxHeight: 0, overflow: 'hidden' } }, preheader),
      h(
        'table',
        { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0 },
        h(
          'tbody',
          null,
          h(
            'tr',
            null,
            h(
              'td',
              { align: 'center', style: { padding: '24px 12px' } },
              h(
                'div',
                { style: { maxWidth: 560, background: '#ffffff', borderRadius: 8, overflow: 'hidden', textAlign: 'left' } },
                h('div', { style: { background: accent, color: '#fff', padding: '16px 24px', fontSize: 20, fontWeight: 700 } }, brand),
                h('div', { style: { padding: '20px 24px', fontSize: 14, lineHeight: '22px' } }, children),
                h(
                  'div',
                  { style: { padding: '12px 24px', fontSize: 11, color: '#71717a', borderTop: '1px solid #e4e4e7' } },
                  h('p', null, footer ?? `${brand} is a demo merchant built for this hackathon. Not a real company.`),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
const P = (text: React.ReactNode) => h('p', { style: { margin: '0 0 10px' } }, text);
const KV = (label: string, value: string) => h('p', { style: { margin: '0 0 6px' } }, h('strong', null, `${label}: `), value);
const Hello = () => P(`Hi ${DEMO_USER.name.split(' ')[0]},`);

// ---------------------------------------------------------------- demo merchant: Vistaflix
const vf = MERCHANTS.vistaflix;
const vfFrom = { fromName: vf.name, fromAddr: `billing@${vf.domain}` };
const vfSuffix = '8889';
const premium = VISTAFLIX_PLANS.find((p) => p.id === 'vf-plan-premium')!;
const basic = VISTAFLIX_PLANS.find((p) => p.id === 'vf-plan-basic')!;
const TITLES = ['The Long Orbit', 'Harbour Lights', 'Saltwater Kings', 'Night Market', 'Paper Moons', 'The Quiet Engine', 'Glass Coast'];

for (const plan of VISTAFLIX_PLANS) {
  for (const d of monthlyFrom(plan.startedOn)) {
    charge(d, `${vf.descriptor} ${vfSuffix}`, plan.amount);
    const nextBill = monthlyFrom(d).at(1) ?? addDays(d, 30);
    mail({
      ...vfFrom,
      at: sendAt(d),
      subject: `Your Vistaflix receipt for ${longDate(d)}`,
      slug: `vistaflix-receipt-${plan.id}`,
      body: h(
        Layout,
        { brand: vf.name, accent: '#b91c1c', preheader: `Payment received: ${money(plan.amount)}` },
        Hello(),
        P('Thanks for being a member. Here is your receipt.'),
        KV('Plan', plan.plan),
        KV('Subscription ID', plan.id),
        KV('Billing date', longDate(d)),
        KV('Amount charged', money(plan.amount)),
        KV('Payment method', `${DEMO_USER.cardBrand} ending ${DEMO_USER.cardLast4}`),
        KV('Next billing date', longDate(nextBill)),
        P('Manage your membership any time in Account settings.'),
      ),
    });
  }
}
// Free trial for Basic: started 7 days before conversion, then converted to paid.
const trialStart = addDays(basic.startedOn, -7);
mail({
  ...vfFrom,
  fromAddr: `hello@${vf.domain}`,
  at: sendAt(trialStart),
  subject: 'Your 7-day Vistaflix free trial has started',
  slug: 'vistaflix-trial-started',
  body: h(
    Layout,
    { brand: vf.name, accent: '#b91c1c', preheader: 'Enjoy 7 days free' },
    Hello(),
    P('Welcome to Vistaflix. Your free trial has started.'),
    KV('Plan', basic.plan),
    KV('Subscription ID', basic.id),
    KV('Trial started', longDate(trialStart)),
    KV('Trial ends', longDate(basic.startedOn)),
    KV('Price after trial', `${money(basic.amount)} per month`),
    P('We will charge your card automatically when the trial ends unless you cancel.'),
  ),
});
mail({
  ...vfFrom,
  at: sendAt(basic.startedOn, 1),
  subject: 'Your free trial has ended: welcome to Basic with ads',
  slug: 'vistaflix-trial-converted',
  body: h(
    Layout,
    { brand: vf.name, accent: '#b91c1c', preheader: 'Your membership is now paid' },
    Hello(),
    P('Your free trial ended and your paid membership has begun.'),
    KV('Plan', basic.plan),
    KV('Subscription ID', basic.id),
    KV('Converted to paid', longDate(basic.startedOn)),
    KV('Amount', `${money(basic.amount)} per month`),
  ),
});
// Viewing activity for Premium, weekly, ending exactly on lastWatched. Basic was never watched.
if (premium.lastWatched) {
  const watched: string[] = [];
  for (let d = premium.lastWatched; d >= START; d = addDays(d, -7)) watched.unshift(d);
  for (const d of watched) {
    const title = faker.helpers.arrayElement(TITLES);
    mail({
      ...vfFrom,
      fromAddr: `activity@${vf.domain}`,
      at: sendAt(d, 11),
      subject: `You watched ${title}: what did you think?`,
      slug: 'vistaflix-activity',
      body: h(
        Layout,
        { brand: vf.name, accent: '#b91c1c', preheader: 'Rate what you watched' },
        Hello(),
        P(`You watched ${title} on ${longDate(d)}. Rate it to get better picks.`),
        KV('Profile', DEMO_USER.name.split(' ')[0]!),
        KV('Subscription ID', premium.id),
        KV('Watched on', longDate(d)),
      ),
    });
  }
}
// Monthly marketing (not a usage signal).
for (const d of monthlyFrom('2026-04-24')) {
  mail({
    ...vfFrom,
    fromAddr: `news@${vf.domain}`,
    at: sendAt(d),
    subject: `New on Vistaflix in ${MONTHS[Number(d.slice(5, 7)) - 1]}`,
    slug: 'vistaflix-newsletter',
    body: h(
      Layout,
      { brand: vf.name, accent: '#b91c1c', preheader: 'Fresh picks this month' },
      P(`This month: ${faker.helpers.arrayElements(TITLES, 3).join(', ')}.`),
    ),
  });
}

// ---------------------------------------------------------------- demo merchant: Cartwell
const cw = MERCHANTS.cartwell;
for (const o of CARTWELL_ORDERS) {
  const times = 'chargedTimes' in o && o.chargedTimes ? o.chargedTimes : 1;
  for (let i = 0; i < times; i++) charge(o.date, `${cw.descriptor} ${o.orderId}`, o.paid);
  mail({
    fromName: cw.name,
    fromAddr: `orders@${cw.domain}`,
    at: sendAt(o.date),
    subject: `Order confirmed: ${o.orderId}`,
    slug: `cartwell-order-${o.orderId}`,
    body: h(
      Layout,
      { brand: cw.name, accent: '#0f766e', preheader: `We received your order ${o.orderId}` },
      Hello(),
      P('Thanks for shopping with Cartwell. Your order is confirmed.'),
      KV('Order number', o.orderId),
      KV('Order date', longDate(o.date)),
      KV('Item', o.item),
      KV('Quantity', '1'),
      KV('Order total', money(o.paid)),
      KV('Payment method', `${DEMO_USER.cardBrand} ending ${DEMO_USER.cardLast4}`),
      P('Cartwell price promise: if the price drops within 14 days of purchase, ask us for the difference.'),
    ),
  });
}
// Catalog: current prices, keyed by item. Unchanged items keep their paid price.
const catalog = {
  merchant: 'cartwell',
  name: cw.name,
  asOf: DEMO_TODAY,
  currency: CURRENCY,
  items: CARTWELL_ORDERS.map((o) => ({
    sku: `CW-SKU-${createHash('sha1').update(o.item).digest('hex').slice(0, 6).toUpperCase()}`,
    name: o.item,
    priceNow: 'priceNow' in o && typeof o.priceNow === 'number' ? o.priceNow : o.paid,
  })),
};

// ---------------------------------------------------------------- demo merchant: Parcelo Market
const pm = MERCHANTS.parcelo;
const pmFrom = { fromName: pm.name, fromAddr: `notify@${pm.domain}` };
for (const o of PARCELO_ORDERS) {
  const ordered = addDays(o.shippedOn, -1);
  charge(ordered, `${pm.descriptor} ${o.orderId}`, o.paid);
  mail({
    ...pmFrom,
    at: sendAt(ordered),
    subject: `Thanks for your order ${o.orderId}`,
    slug: `parcelo-order-${o.orderId}`,
    body: h(
      Layout,
      { brand: pm.name, accent: '#7c3aed', preheader: 'Order received' },
      Hello(),
      KV('Order number', o.orderId),
      KV('Order date', longDate(ordered)),
      KV('Item', o.item),
      KV('Order total', money(o.paid)),
    ),
  });
  mail({
    ...pmFrom,
    at: sendAt(o.shippedOn),
    subject: `Your order ${o.orderId} has shipped`,
    slug: `parcelo-shipped-${o.orderId}`,
    body: h(
      Layout,
      { brand: pm.name, accent: '#7c3aed', preheader: 'On its way' },
      Hello(),
      P('Good news: your parcel is on its way.'),
      KV('Order number', o.orderId),
      KV('Item', o.item),
      KV('Shipped on', longDate(o.shippedOn)),
      KV('Estimated delivery', longDate(o.promisedBy)),
      KV('Tracking number', `PX${faker.string.numeric(10)}`),
    ),
  });
  if (o.delivered) {
    const deliveredOn = addDays(o.promisedBy, -1);
    mail({
      ...pmFrom,
      at: sendAt(deliveredOn, 9),
      subject: `Delivered: your order ${o.orderId}`,
      slug: `parcelo-delivered-${o.orderId}`,
      body: h(
        Layout,
        { brand: pm.name, accent: '#7c3aed', preheader: 'Your parcel was delivered' },
        Hello(),
        KV('Order number', o.orderId),
        KV('Item', o.item),
        KV('Delivered on', longDate(deliveredOn)),
        P('Left at front door.'),
      ),
    });
  }
}

// ---------------------------------------------------------------- demo merchant: Skylane Air
const sk = MERCHANTS.skylane;
const fl = SKYLANE_FLIGHT;
const bookedOn = addDays(fl.date, -48);
charge(bookedOn, `${sk.descriptor} ${fl.bookingRef}`, fl.fare);
const hhmm = (ts: string) => ts.slice(11, 16);
mail({
  fromName: sk.name,
  fromAddr: `bookings@${sk.domain}`,
  at: sendAt(bookedOn),
  subject: `Booking confirmed: ${fl.flight} ${fl.route} (${fl.bookingRef})`,
  slug: 'skylane-booking',
  body: h(
    Layout,
    { brand: sk.name, accent: '#1d4ed8', preheader: 'Your e-ticket' },
    Hello(),
    P('Your booking is confirmed. Have a good trip.'),
    KV('Booking reference', fl.bookingRef),
    KV('Passenger', fl.passenger),
    KV('Flight', fl.flight),
    KV('Route', fl.route),
    KV('Date', longDate(fl.date)),
    KV('Scheduled departure', `${hhmm(fl.scheduledDeparture)} local time`),
    KV('Fare paid', money(fl.fare)),
  ),
});
const delayH = Math.floor(fl.delayMinutes / 60);
const delayM = fl.delayMinutes % 60;
mail({
  fromName: sk.name,
  fromAddr: `disruptions@${sk.domain}`,
  at: sendAt(fl.date, 6),
  subject: `Delay notice: ${fl.flight} ${fl.route} on ${longDate(fl.date)}`,
  slug: 'skylane-delay',
  body: h(
    Layout,
    { brand: sk.name, accent: '#1d4ed8', preheader: 'We are sorry for the delay' },
    Hello(),
    P(`We are sorry: flight ${fl.flight} departed late today.`),
    KV('Booking reference', fl.bookingRef),
    KV('Flight', fl.flight),
    KV('Route', fl.route),
    KV('Scheduled departure', `${hhmm(fl.scheduledDeparture)} local time`),
    KV('Actual departure', `${hhmm(fl.actualDeparture)} local time`),
    KV('Delay', `${delayH}h ${delayM}m`),
    KV('Reason category', fl.delayCategory),
    P('Passengers may be entitled to assistance or compensation under our conditions of carriage.'),
  ),
});

// ---------------------------------------------------------------- bill above market: GlobeRoam eSIM
const grDomain = 'globeroam.demo';
const grDescriptor = 'GLOBEROAM ESIM';
for (const d of monthlyFrom(ESIM_BILL.startedOn)) {
  charge(d, grDescriptor, ESIM_BILL.amount);
  mail({
    fromName: ESIM_BILL.merchant,
    fromAddr: `billing@${grDomain}`,
    at: sendAt(d),
    subject: `GlobeRoam receipt: ${ESIM_BILL.plan}`,
    slug: 'globeroam-receipt',
    body: h(
      Layout,
      { brand: ESIM_BILL.merchant, accent: '#ea580c', preheader: 'Your monthly roaming plan renewed' },
      Hello(),
      KV('Plan', ESIM_BILL.plan),
      KV('Billing date', longDate(d)),
      KV('Amount charged', money(ESIM_BILL.amount)),
      KV('Renews', 'monthly'),
    ),
  });
  const used = faker.number.float({ min: 9, max: 19, fractionDigits: 1 });
  mail({
    fromName: ESIM_BILL.merchant,
    fromAddr: `usage@${grDomain}`,
    at: sendAt(addDays(d, 20)),
    subject: `Data usage: you've used ${used} GB this cycle`,
    slug: 'globeroam-usage',
    body: h(
      Layout,
      { brand: ESIM_BILL.merchant, accent: '#ea580c', preheader: 'Usage update' },
      P(`You've used ${used} GB of 20 GB this cycle.`),
      KV('Plan', ESIM_BILL.plan),
    ),
  });
}

// ---------------------------------------------------------------- texture: subscriptions that ARE in use
const texture = {
  tunewave: { name: 'Tunewave', domain: 'tunewave.demo', descriptor: 'TUNEWAVE*PREMIUM', plan: 'Premium Individual', amount: 1099, day: '2026-04-12' },
  fitpulse: { name: 'FitPulse Club', domain: 'fitpulse.demo', descriptor: 'FITPULSE CLUB', plan: 'All-access monthly', amount: 5900, day: '2026-04-25' },
  lumen: { name: 'Lumen Mobile', domain: 'lumenmobile.demo', descriptor: 'LUMEN MOBILE BILL', plan: 'SIM Only 50 GB', amount: 3800, day: '2026-04-09' },
} as const;
for (const s of Object.values(texture)) {
  for (const d of monthlyFrom(s.day)) {
    charge(d, s.descriptor, s.amount);
    mail({
      fromName: s.name,
      fromAddr: `billing@${s.domain}`,
      at: sendAt(d),
      subject: `${s.name} receipt for ${longDate(d)}`,
      slug: `${s.name.toLowerCase().replace(/\W+/g, '-')}-receipt`,
      body: h(
        Layout,
        { brand: s.name, accent: '#334155', preheader: 'Payment received' },
        Hello(),
        KV('Plan', s.plan),
        KV('Billing date', longDate(d)),
        KV('Amount charged', money(s.amount)),
      ),
    });
  }
}
// Tunewave: weekly listening recap every Monday (usage signal right up to today).
// FitPulse: gym check-ins two or three times a week.
const GYMS = ['FitPulse Tanjong', 'FitPulse Riverside', 'FitPulse Orchard'];
eachDay((d, wd) => {
  if (wd === 1) {
    const mins = faker.number.int({ min: 180, max: 900 });
    mail({
      fromName: texture.tunewave.name,
      fromAddr: `recap@${texture.tunewave.domain}`,
      at: sendAt(d),
      subject: 'Your weekly listening recap',
      slug: 'tunewave-recap',
      body: h(
        Layout,
        { brand: texture.tunewave.name, accent: '#16a34a', preheader: `${mins} minutes this week` },
        P(`You listened for ${mins} minutes this week. Top artist: ${faker.music.artist()}.`),
        KV('Plan', texture.tunewave.plan),
      ),
    });
  }
  if ((wd === 2 || wd === 4 || wd === 6) && faker.datatype.boolean({ probability: 0.6 })) {
    mail({
      fromName: texture.fitpulse.name,
      fromAddr: `checkin@${texture.fitpulse.domain}`,
      at: sendAt(d),
      subject: `You checked in at ${faker.helpers.arrayElement(GYMS)}`,
      slug: 'fitpulse-checkin',
      body: h(Layout, { brand: texture.fitpulse.name, accent: '#db2777', preheader: 'Nice work' }, P('Thanks for checking in. Keep it up!'), KV('Plan', texture.fitpulse.plan)),
    });
  }
});

// ---------------------------------------------------------------- texture: utilities (variable amount)
for (const d of monthlyFrom('2026-04-15')) {
  const amount = cents(68, 112);
  charge(d, 'BRIGHTGRID ENERGY', amount);
  mail({
    fromName: 'Brightgrid Energy',
    fromAddr: 'bills@brightgrid.demo',
    at: sendAt(d),
    subject: `Your Brightgrid electricity bill is ready`,
    slug: 'brightgrid-bill',
    body: h(
      Layout,
      { brand: 'Brightgrid Energy', accent: '#ca8a04', preheader: 'Bill paid by card' },
      Hello(),
      KV('Account number', `BG-${faker.string.numeric(8)}`),
      KV('Supply address', faker.location.streetAddress()),
      KV('Usage', `${faker.number.int({ min: 280, max: 460 })} kWh`),
      KV('Amount charged', money(amount)),
    ),
  });
}

// ---------------------------------------------------------------- texture: everyday spending
const DINING = ['NOODLE BAR 21', 'SPICE ROUTE KITCHEN', 'HARBOUR GRILL', 'KOPI CORNER', 'GREEN BOWL CAFE', 'SUSHI TRAIN 88', 'BAO HOUSE'];
const SHOPS = ['MEDIPLUS PHARMACY', 'PAGEWORTH BOOKS', 'HANDYMAN HARDWARE', 'URBAN THREADS', 'PIXEL MART ELECTRONICS'];
eachDay((d, wd) => {
  const weekday = wd >= 1 && wd <= 5;
  if (weekday && faker.datatype.boolean({ probability: 0.5 })) charge(d, 'BEANHOUSE COFFEE 0231', cents(4.5, 7.8));
  if (wd === 6) {
    const amt = cents(42, 138);
    const online = faker.datatype.boolean({ probability: 0.4 });
    charge(d, online ? 'FRESHMART ONLINE' : 'FRESHMART #112', amt);
    if (online) {
      const items = faker.helpers.arrayElements(['Oat milk', 'Eggs (12)', 'Sourdough loaf', 'Bananas', 'Chicken thighs', 'Brown rice 2kg', 'Spinach', 'Greek yoghurt', 'Coffee beans'], 4);
      mail({
        fromName: 'FreshMart',
        fromAddr: 'receipts@freshmart.demo',
        at: sendAt(d),
        subject: 'Your FreshMart online order receipt',
        slug: 'freshmart-receipt',
        body: h(
          Layout,
          { brand: 'FreshMart', accent: '#65a30d', preheader: 'Thanks for shopping' },
          Hello(),
          ...items.map((it) => P(`- ${it}`)),
          KV('Delivery address', faker.location.streetAddress()),
          KV('Total', money(amt)),
        ),
      });
    }
  }
  if (faker.datatype.boolean({ probability: 0.12 })) charge(d, 'DAILY GREENS GROCER', cents(8, 36));
  if (faker.datatype.boolean({ probability: 0.32 })) {
    const amt = cents(6.2, 28.5);
    charge(d, 'ZIPRIDE*TRIP', amt);
    mail({
      fromName: 'ZipRide',
      fromAddr: 'receipts@zipride.demo',
      at: sendAt(d),
      subject: `Your ZipRide trip receipt`,
      slug: 'zipride-receipt',
      body: h(
        Layout,
        { brand: 'ZipRide', accent: '#0891b2', preheader: 'Thanks for riding' },
        P(`Thanks for riding with ${faker.person.firstName()}.`),
        KV('Pickup', faker.location.streetAddress()),
        KV('Drop-off', faker.location.streetAddress()),
        KV('Total', money(amt)),
      ),
    });
  }
  if (faker.datatype.boolean({ probability: wd === 5 || wd === 6 ? 0.45 : 0.15 })) charge(d, faker.helpers.arrayElement(DINING), cents(12, 68));
  if (faker.datatype.boolean({ probability: 0.1 })) charge(d, faker.helpers.arrayElement(SHOPS), cents(9, 120));
  if (faker.datatype.boolean({ probability: 0.1 })) charge(d, 'TRANSITLINK TOPUP', faker.helpers.arrayElement([1000, 2000, 3000]));
});
// One texture refund, so the parser sees a credit.
charge('2026-06-20', 'URBAN THREADS REFUND', -2990);

// ---------------------------------------------------------------- write
function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'inbox'), { recursive: true });

  // Statement: stable sort by date, then insertion order.
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date === b.r.date ? a.i - b.i : a.r.date < b.r.date ? -1 : 1)).map((x) => x.r);
  const csv = ['Date,Description,Amount,Currency,Card Last4']
    .concat(sorted.map((r) => [r.date, r.descriptor, (r.amount / 100).toFixed(2), CURRENCY, DEMO_USER.cardLast4].map(csvCell).join(',')))
    .join('\n');
  writeFileSync(join(OUT, 'statement.csv'), `${csv}\n`);
  writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

  const ordered = mails.map((m, i) => ({ m, i })).sort((a, b) => (a.m.at === b.m.at ? a.i - b.i : a.m.at < b.m.at ? -1 : 1)).map((x) => x.m);
  let n = 0;
  for (const m of ordered) {
    n += 1;
    const html = await render(m.body);
    const text = toPlainText(html);
    const domain = m.fromAddr.split('@')[1]!;
    const key = `${n}-${m.slug}-${m.at}`;
    const hash = createHash('sha256').update(key).digest('hex');
    const composer = new MailComposer({
      from: { name: m.fromName, address: m.fromAddr },
      to: { name: DEMO_USER.name, address: DEMO_USER.email },
      subject: m.subject,
      html,
      text,
      date: new Date(m.at),
      messageId: `<${hash.slice(0, 20)}@${domain}>`,
      headers: { 'X-Demo-Data': 'Synthetic. Demo merchant built for this hackathon.' },
      baseBoundary: hash.slice(20, 36),
    } as ConstructorParameters<typeof MailComposer>[0] & { baseBoundary: string });
    const eml = await composer.compile().build();
    writeFileSync(join(OUT, 'inbox', `${String(n).padStart(3, '0')}-${m.at.slice(0, 10)}-${m.slug}.eml`), eml);
  }

  console.log(`data/demo: ${ordered.length} emails, ${sorted.length} transactions, ${catalog.items.length} catalog items`);
}

await main();
