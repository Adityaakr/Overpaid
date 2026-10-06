import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { digitsFrom, logEvent, sql } from '../db.js';
import { html, type SafeHtml } from '../html.js';
import { secondsSince, usd, type SiteCtx, type SiteDef } from '../common.js';

type Booking = {
  ref: string;
  flight: string;
  route: string;
  flight_date: string;
  scheduled_departure: string;
  actual_departure: string;
  delay_minutes: number;
  delay_category: string;
  fare_cents: number;
  compensation_cents: number;
  passenger: string;
};
type Claim = { id: string; booking_ref: string; passenger: string; category: string; payout: Payout; amount_cents: number; created_at: Date };

export const QUALIFYING_CATEGORY = 'Technical, carrier responsibility';
export const DELAY_CATEGORIES = [
  'Weather conditions',
  'Air traffic control restrictions',
  'Airport security',
  'Third-party strike',
  QUALIFYING_CATEGORY,
] as const;
const PAYOUTS = [
  ['voucher', 'Skylane travel voucher (130% value, valid 12 months)'],
  ['original_card', 'Refund to the original card (Visa ending 4417)'],
  ['bank_transfer', 'Bank transfer'],
] as const;
type Payout = (typeof PAYOUTS)[number][0];
const MIN_DELAY_MINUTES = 180;

const ClaimSchema = z
  .object({
    bookingRef: z.string({ message: 'Booking reference is required.' }).trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, { message: 'Booking reference must be 6 letters or digits.' }),
    passengerName: z.string({ message: 'Passenger name is required.' }).trim().min(2, { message: 'Passenger name is required.' }),
    delayCategory: z.enum(DELAY_CATEGORIES, { message: 'Choose the delay category stated by the airline.' }),
    payout: z.enum(['voucher', 'original_card', 'bank_transfer'], { message: 'Choose how you want to be paid.' }),
    accountHolder: z.string().trim().optional(),
    accountNumber: z.string().trim().optional(),
    declaration: z.literal('on', { message: 'You must accept the declaration.' }),
  })
  .superRefine((v, ctx) => {
    if (v.payout === 'bank_transfer') {
      if (!v.accountHolder) ctx.addIssue({ code: 'custom', path: ['accountHolder'], message: 'Account holder is required for bank transfers.' });
      if (!v.accountNumber || !/^[A-Z0-9 ]{8,34}$/i.test(v.accountNumber)) {
        ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'A valid account number or IBAN is required for bank transfers.' });
      }
    }
  });

export type ClaimStatus = 'approved' | 'paid' | 'voucher_issued';
export function claimStatus(c: Claim): ClaimStatus {
  if (secondsSince(c.created_at) < config.skylanePaidDelaySeconds) return 'approved';
  return c.payout === 'voucher' ? 'voucher_issued' : 'paid';
}
const STATUS_LABEL: Record<ClaimStatus, string> = { approved: 'Claim approved', paid: 'Compensation paid', voucher_issued: 'Travel voucher issued' };

const fmtTime = (iso: string) => iso.slice(11, 16);
const fmtDelay = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const claimJson = (c: Claim) => ({
  merchant: 'skylane',
  claimId: c.id,
  bookingRef: c.booking_ref,
  status: claimStatus(c),
  statusLabel: STATUS_LABEL[claimStatus(c)],
  amountCents: c.amount_cents,
  payout: c.payout,
  createdAt: c.created_at.toISOString(),
  paidAfterSeconds: config.skylanePaidDelaySeconds,
});

type RejectionCode = 'invalid_fields' | 'unknown_booking' | 'name_mismatch' | 'wrong_category' | 'delay_too_short' | 'already_claimed';

function routes(app: FastifyInstance, { page }: SiteCtx): void {
  app.get('/', async (req, reply) =>
    page(req, reply, {
      title: 'Home',
      body: html`<section class="hero"><h1>Where to next?</h1>
        <p>Fly Skylane across Asia-Pacific. Award-winning service since 1998 (fictionally).</p>
        <a class="btn" href="/manage" data-testid="manage-booking-link">Manage booking</a></section>`,
    }),
  );

  app.get('/manage', async (req, reply) => {
    const bookings = await sql<Booking[]>`select * from skylane_bookings order by ref`;
    return page(req, reply, {
      title: 'Manage booking',
      body: html`<section class="card-sky"><h1>Manage booking</h1>
        <h2>Your trips</h2>
        <ul>${bookings.map((b) => html`<li><a href="/manage/${b.ref}" data-testid="booking-link-${b.ref}">${b.ref}: ${b.flight} ${b.route}, ${b.flight_date}</a></li>`)}</ul>
      </section>`,
    });
  });

  app.get<{ Params: { ref: string } }>('/manage/:ref', async (req, reply) => {
    const [b] = await sql<Booking[]>`select * from skylane_bookings where ref = ${req.params.ref.toUpperCase()}`;
    if (!b) return page(req, reply, { title: 'Not found', status: 404, body: html`<h1>Booking not found</h1>` });
    const [claim] = await sql<Claim[]>`select * from skylane_claims where booking_ref = ${b.ref}`;
    return page(req, reply, {
      title: `Booking ${b.ref}`,
      body: html`<section class="card-sky" data-testid="booking" data-booking-ref="${b.ref}" data-delay-minutes="${b.delay_minutes}">
        <p class="muted">Booking reference</p><h1>${b.ref}</h1>
        <div class="flight">
          <div><strong>${b.flight}</strong><br>${b.route}<br>${b.flight_date}</div>
          <div>Scheduled ${fmtTime(b.scheduled_departure)}<br>Departed ${fmtTime(b.actual_departure)}</div>
          <div><span class="delayed" data-testid="flight-status" data-status="delayed">Delayed ${fmtDelay(b.delay_minutes)}</span></div>
        </div>
        <p>Passenger: ${b.passenger}</p>
        <details><summary>Disruption details</summary>
          <p>Disruption report DR-218-0914. Delay reason recorded: <span data-testid="delay-reason">${b.delay_category}</span>.</p></details>
        ${claim
          ? html`<p>Compensation claim <a href="/claims/${claim.id}" data-testid="existing-claim">${claim.id}</a>: ${STATUS_LABEL[claimStatus(claim)]}</p>`
          : html`<p class="small">Delayed more than 3 hours? You may be entitled to compensation.
              <a href="/claims/new" data-testid="claim-compensation-link">Claim compensation</a></p>`}
      </section>`,
    });
  });

  const claimForm = (values: Partial<Record<string, string>> = {}): SafeHtml => {
    const cat = values.delayCategory ?? DELAY_CATEGORIES[0];
    const payout = values.payout ?? 'voucher';
    return html`<form method="post" action="/claims" class="claim-form" data-testid="claim-form" novalidate>
      <label for="bookingRef">Booking reference</label>
      <input id="bookingRef" name="bookingRef" value="${values.bookingRef ?? ''}" data-testid="claim-booking-ref" required maxlength="6">
      <label for="passengerName">Passenger name (as on ticket)</label>
      <input id="passengerName" name="passengerName" value="${values.passengerName ?? ''}" data-testid="claim-passenger-name" required>
      <label for="delayCategory">Delay category</label>
      <select id="delayCategory" name="delayCategory" data-testid="claim-delay-category" required>
        ${DELAY_CATEGORIES.map((c) => html`<option value="${c}" ${c === cat ? 'selected' : ''}>${c}</option>`)}
      </select>
      <fieldset><legend>How would you like to receive compensation?</legend>
        ${PAYOUTS.map(([v, l]) => html`<label class="radio"><input type="radio" name="payout" value="${v}" data-testid="claim-payout-${v}" ${v === payout ? 'checked' : ''}> ${l}</label>`)}
        <div class="bank"><label for="accountHolder">Account holder (bank transfer only)</label>
          <input id="accountHolder" name="accountHolder" value="${values.accountHolder ?? ''}" data-testid="claim-account-holder">
          <label for="accountNumber">Account number or IBAN (bank transfer only)</label>
          <input id="accountNumber" name="accountNumber" value="${values.accountNumber ?? ''}" data-testid="claim-account-number"></div>
      </fieldset>
      <label class="check"><input type="checkbox" name="declaration" value="on" data-testid="claim-declaration" required>
        I declare that the information above is correct and that I have not received compensation for this flight elsewhere.</label>
      <button type="submit" class="btn" data-testid="claim-submit" data-irreversible="true">Submit claim</button>
    </form>`;
  };

  app.get('/claims/new', async (req, reply) =>
    page(req, reply, {
      title: 'Claim compensation',
      body: html`<section class="card-sky"><h1>Delay compensation claim</h1>
        <p class="muted">Claims are assessed automatically against our conditions of carriage. Incorrect claims are rejected.</p>
        ${claimForm()}</section>`,
    }),
  );

  app.post('/claims', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const reject = async (codes: RejectionCode[], messages: string[]) => {
      await logEvent('skylane', 'claim_rejected', { codes, messages, bookingRef: body.bookingRef ?? null, category: body.delayCategory ?? null }, req.agent.isAgent);
      return page(req, reply, {
        title: 'Claim rejected',
        status: 422,
        body: html`<section class="card-sky">
          <div class="rejected" role="alert" data-testid="claim-rejected" data-status="rejected" data-rejection-codes="${codes.join(',')}">
            <h1>Claim rejected</h1><ul>${messages.map((m) => html`<li>${m}</li>`)}</ul></div>
          <h2>Correct and resubmit</h2>${claimForm(body)}</section>`,
      });
    };

    const parsed = ClaimSchema.safeParse(body);
    if (!parsed.success) return reject(['invalid_fields'], parsed.error.issues.map((i) => i.message));
    const d = parsed.data;
    const [b] = await sql<Booking[]>`select * from skylane_bookings where ref = ${d.bookingRef}`;
    if (!b) return reject(['unknown_booking'], [`We could not find booking ${d.bookingRef}.`]);
    const codes: RejectionCode[] = [];
    const msgs: string[] = [];
    if (d.passengerName.toLowerCase().replace(/\s+/g, ' ') !== b.passenger.toLowerCase()) {
      codes.push('name_mismatch');
      msgs.push('The passenger name does not match the booking.');
    }
    if (d.delayCategory !== QUALIFYING_CATEGORY) {
      codes.push('wrong_category');
      msgs.push(
        `Delays caused by "${d.delayCategory}" are extraordinary circumstances under our conditions of carriage and do not qualify for compensation. ` +
          'Only delays within the carrier’s responsibility qualify. Check the disruption details on your booking.',
      );
    }
    if (b.delay_minutes < MIN_DELAY_MINUTES) {
      codes.push('delay_too_short');
      msgs.push('Only delays of more than 3 hours qualify.');
    }
    if (codes.length) return reject(codes, msgs);
    const [existing] = await sql<Claim[]>`select * from skylane_claims where booking_ref = ${b.ref}`;
    if (existing) return reject(['already_claimed'], [`A claim for ${b.ref} already exists: ${existing.id}.`]);

    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int as n from skylane_claims`;
    const id = `SKC-${digitsFrom(`skylane:${b.ref}:${n}`)}`;
    const amount = d.payout === 'voucher' ? Math.round(b.compensation_cents * 1.3) : b.compensation_cents;
    await sql`insert into skylane_claims (id, booking_ref, passenger, category, payout, amount_cents)
      values (${id}, ${b.ref}, ${b.passenger}, ${d.delayCategory}, ${d.payout}, ${amount})`;
    await logEvent('skylane', 'claim_approved', { claimId: id, bookingRef: b.ref, payout: d.payout, amountCents: amount }, req.agent.isAgent);
    return reply.redirect(`/claims/${id}`, 303);
  });

  app.get<{ Params: { id: string } }>('/claims/:id', async (req, reply) => {
    const asJson = req.params.id.endsWith('.json');
    const id = asJson ? req.params.id.slice(0, -5) : req.params.id;
    const [c] = await sql<Claim[]>`select * from skylane_claims where id = ${id}`;
    if (!c) {
      if (asJson) return reply.code(404).send({ error: 'not_found' });
      return page(req, reply, { title: 'Not found', status: 404, body: html`<h1>Claim not found</h1>` });
    }
    if (asJson) return claimJson(c);
    const s = claimStatus(c);
    return page(req, reply, {
      title: `Claim ${c.id}`,
      body: html`<section class="card-sky claim" data-testid="claim-status" data-claim-id="${c.id}" data-booking-ref="${c.booking_ref}"
          data-status="${s}" data-amount-cents="${c.amount_cents}" data-payout="${c.payout}">
        <p class="muted">Compensation claim</p><h1 data-testid="claim-id">${c.id}</h1>
        <p class="status-big status-${s}" data-testid="claim-status-label" data-status="${s}">${STATUS_LABEL[s]}</p>
        <p>Booking ${c.booking_ref} · ${c.passenger}</p>
        <p data-testid="claim-amount" data-amount-cents="${c.amount_cents}">Amount: <strong>${usd(c.amount_cents)}</strong>
          ${c.payout === 'voucher' ? '(travel voucher)' : c.payout === 'original_card' ? 'to Visa ending 4417' : 'by bank transfer'}</p>
        ${s === 'approved' ? html`<p class="small">Payment is processed automatically. Refresh this page for updates.</p>` : ''}
      </section>`,
    });
  });
}

const CSS = `
body{background:#eef5fc;color:#0b2540;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}
a{color:#0a4d8c}
.site-header{display:flex;align-items:center;gap:28px;padding:14px 36px;background:#0a2a52;color:#fff}
.logo{font:700 24px "Helvetica Neue",Arial;color:#fff;text-decoration:none}.logo::before{content:"\\2708  ";color:#5ec2ff}
.site-header nav{display:flex;gap:20px;flex:1}.site-header nav a{color:#cfe6ff;text-decoration:none}
.signed-in{font-size:13px;color:#9fc4ea}.site-header a.signed-in{color:#fff}
main{max-width:820px;margin:0 auto;padding:32px 20px}
.hero{background:linear-gradient(160deg,#0a4d8c,#5ec2ff);color:#fff;border-radius:20px;padding:56px 40px}.hero h1{font-size:44px;margin:0}
.btn{display:inline-block;background:#ff8a00;color:#fff;border:0;border-radius:24px;padding:11px 26px;font:700 15px Arial;cursor:pointer;text-decoration:none}
.card-sky{background:#fff;border-radius:20px;padding:28px 34px;box-shadow:0 4px 24px rgba(10,42,82,.08)}
.flight{display:flex;justify-content:space-between;background:#f3f8fd;border-radius:14px;padding:16px 20px;margin:14px 0}
.delayed{background:#ffe1c2;color:#8a3b00;padding:4px 12px;border-radius:12px;font-weight:700}
.small{font-size:13px}.muted{color:#5b7590}
.claim-form{display:grid;gap:8px}.claim-form input,.claim-form select{font:15px Arial;padding:9px;border:1px solid #b4c9de;border-radius:10px}
fieldset{border:1px solid #d6e3f0;border-radius:12px}.radio{display:block;margin:4px 0}.bank{display:grid;gap:6px;margin-top:8px;font-size:13px}
.check{font-size:13px}
.rejected{background:#fdecea;border:2px solid #c0392b;border-radius:14px;padding:6px 18px;margin-bottom:16px;color:#7a1d14}
.status-big{font-size:26px;font-weight:700}.status-approved{color:#0a4d8c}.status-paid,.status-voucher_issued{color:#127a3e}
.site-footer{text-align:center;color:#5b7590;font-size:12px;padding:32px}
.card{max-width:520px;margin:40px auto;background:#fff;border-radius:20px;padding:28px}.btn-primary{background:#ff8a00;color:#fff}
`;

export const skylane: SiteDef = {
  key: 'skylane',
  theme: {
    css: CSS,
    logo: html`Skylane Air`,
    nav: [
      { href: '/', label: 'Book', testid: 'nav-book' },
      { href: '/manage', label: 'Manage booking', testid: 'nav-manage' },
      { href: '/claims/new', label: 'Delay compensation', testid: 'nav-claims' },
    ],
    footer: 'Skylane Air',
  },
  routes,
  adminSections: async () => {
    const claims = await sql<Claim[]>`select * from skylane_claims order by created_at`;
    return [
      { title: 'Bookings', rows: [...(await sql`select * from skylane_bookings`)] },
      { title: 'Claims', rows: claims.map(claimJson) },
    ];
  },
};
