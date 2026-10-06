import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { CARTWELL_PRICE_PROTECTION_DAYS, DEMO_TODAY, DEMO_USER } from '@overpaid/shared';
import { config } from '../config.js';
import { digitsFrom, logEvent, sql } from '../db.js';
import { html, type SafeHtml } from '../html.js';
import { issuesList, secondsSince, usd, type SiteCtx, type SiteDef } from '../common.js';

type Order = { order_id: string; item: string; paid_cents: number; price_now_cents: number | null; ordered_on: string };
type Charge = { id: number; order_id: string; amount_cents: number; label: string; on_date: string };
type Ticket = {
  id: string;
  order_id: string;
  reason: Reason;
  kind: 'duplicate_charge' | 'price_adjustment' | 'general';
  amount_cents: number;
  store_credit: boolean;
  details: string;
  email: string;
  created_at: Date;
};

const REASONS = [
  ['other', 'Other'],
  ['duplicate_charge', 'Duplicate charge'],
  ['price_adjustment', 'Price adjustment'],
] as const;
type Reason = (typeof REASONS)[number][0];

const SupportSchema = z.object({
  reason: z.enum(['other', 'duplicate_charge', 'price_adjustment'], { message: 'Choose a reason.' }),
  orderId: z.string({ message: 'Choose the order this is about.' }).regex(/^CW-\d+$/, { message: 'Choose the order this is about.' }),
  details: z.string({ message: 'Describe the problem.' }).trim().min(10, { message: 'Describe the problem (at least 10 characters).' }).max(2000),
  email: z.email({ message: 'Enter a valid contact email.' }),
  storeCredit: z.literal('on').optional(),
});

export type TicketStatus = 'under_review' | 'refund_issued' | 'price_adjustment_issued' | 'store_credit_issued';

export function ticketStatus(t: Ticket): TicketStatus {
  if (t.kind === 'general') return 'under_review';
  if (secondsSince(t.created_at) < config.cartwellResolveDelaySeconds) return 'under_review';
  if (t.store_credit) return 'store_credit_issued';
  return t.kind === 'duplicate_charge' ? 'refund_issued' : 'price_adjustment_issued';
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  under_review: 'Under review',
  refund_issued: 'Refund issued',
  price_adjustment_issued: 'Price adjustment issued',
  store_credit_issued: 'Store credit issued',
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const inProtectionWindow = (o: Order) =>
  o.price_now_cents !== null && o.price_now_cents < o.paid_cents && daysBetween(o.ordered_on, DEMO_TODAY) <= CARTWELL_PRICE_PROTECTION_DAYS;

const ticketJson = (t: Ticket) => ({
  merchant: 'cartwell',
  ticketId: t.id,
  orderId: t.order_id,
  kind: t.kind,
  status: ticketStatus(t),
  statusLabel: STATUS_LABEL[ticketStatus(t)],
  amountCents: t.amount_cents,
  resolution: t.store_credit ? 'store_credit' : 'card_refund',
  createdAt: t.created_at.toISOString(),
});

function routes(app: FastifyInstance, { page }: SiteCtx): void {
  const allOrders = () => sql<Order[]>`select * from cartwell_orders order by sort`;

  app.get('/', async (req, reply) =>
    page(req, reply, {
      title: 'Home',
      body: html`<section class="hero">
        <h1>Good things, fairly priced.</h1>
        <p>Free returns within 30 days. Price protection for ${CARTWELL_PRICE_PROTECTION_DAYS} days on every order.</p>
        <p><a class="btn" href="/orders" data-testid="orders-link">Your orders</a> <a class="btn btn-quiet" href="/support" data-testid="support-link">Help and support</a></p>
      </section>`,
    }),
  );

  app.get('/orders', async (req, reply) => {
    const orders = await allOrders();
    return page(req, reply, {
      title: 'Your orders',
      body: html`<section>
        <h1>Your orders</h1>
        <div class="orders">${orders.map(
          (o) => html`<article class="order-card" data-testid="order-${o.order_id}" data-order-id="${o.order_id}">
            <div><h2><a href="/orders/${o.order_id}" data-testid="order-link-${o.order_id}">${o.item}</a></h2>
              <p class="muted">Order ${o.order_id} · placed ${o.ordered_on}</p></div>
            <div class="price">${usd(o.paid_cents)}
              ${o.price_now_cents !== null ? html`<p class="now" data-testid="price-now-${o.order_id}" data-price-now-cents="${o.price_now_cents}">Now ${usd(o.price_now_cents)}</p>` : ''}</div>
          </article>`,
        )}</div>
      </section>`,
    });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const [o] = await sql<Order[]>`select * from cartwell_orders where order_id = ${req.params.id}`;
    if (!o) return page(req, reply, { title: 'Not found', status: 404, body: html`<h1>Order not found</h1>` });
    const charges = await sql<Charge[]>`select * from cartwell_charges where order_id = ${o.order_id} order by id`;
    const tickets = await sql<Ticket[]>`select * from cartwell_tickets where order_id = ${o.order_id} order by created_at`;
    const resolved = tickets.filter((t) => t.kind !== 'general' && ticketStatus(t) !== 'under_review');
    return page(req, reply, {
      title: `Order ${o.order_id}`,
      body: html`<section class="order-detail" data-order-id="${o.order_id}" data-charge-count="${charges.length}">
        <h1>${o.item}</h1>
        <p class="muted">Order ${o.order_id} · placed ${o.ordered_on} · Delivered</p>
        <p>You paid <strong>${usd(o.paid_cents)}</strong>${o.price_now_cents !== null
          ? html` · Current price <strong data-price-now-cents="${o.price_now_cents}">${usd(o.price_now_cents)}</strong>`
          : ''}</p>
        <h2>Payment history</h2>
        <table class="history" data-testid="payment-history">
          <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
          <tbody>
            ${charges.map((c) => html`<tr data-testid="payment-row" data-kind="charge" data-amount-cents="${c.amount_cents}"><td>${c.on_date}</td><td>${c.label}</td><td>${usd(c.amount_cents)}</td></tr>`)}
            ${resolved.map((t) => html`<tr data-testid="payment-row" data-kind="${t.store_credit ? 'store_credit' : 'refund'}" data-amount-cents="${-t.amount_cents}">
              <td>${t.created_at.toISOString().slice(0, 10)}</td>
              <td>${t.store_credit ? 'Store credit' : 'Refund to Visa ending 4417'} (ticket ${t.id})</td><td>-${usd(t.amount_cents)}</td></tr>`)}
          </tbody>
        </table>
        ${tickets.length ? html`<h2>Support requests</h2><ul>${tickets.map((t) => html`<li><a href="/support/tickets/${t.id}">${t.id}</a> · ${STATUS_LABEL[ticketStatus(t)]}</li>`)}</ul>` : ''}
        <p><a href="/support" data-testid="support-link">Problem with this order? Contact support</a></p>
      </section>`,
    });
  });

  const supportForm = async (errors: string[], values: Partial<Record<string, string>> = {}): Promise<SafeHtml> => {
    const orders = await allOrders();
    const reason = values.reason ?? 'other';
    const storeCredit = values.storeCredit === undefined ? true : values.storeCredit === 'on';
    return html`<section class="support">
      <h1>Contact support</h1>
      <p class="muted">Most requests are answered within 5 to 7 business days.</p>
      ${errors.length ? issuesList(errors) : ''}
      <form method="post" action="/support" data-testid="support-form" novalidate>
        <label for="reason">What can we help with?</label>
        <select id="reason" name="reason" data-testid="support-reason" required>
          ${REASONS.map(([v, l]) => html`<option value="${v}" ${v === reason ? 'selected' : ''}>${l}</option>`)}
        </select>
        <label for="orderId">Order</label>
        <select id="orderId" name="orderId" data-testid="support-order" required>
          <option value="">Choose an order</option>
          ${orders.map((o) => html`<option value="${o.order_id}" ${o.order_id === values.orderId ? 'selected' : ''}>${o.order_id}: ${o.item}</option>`)}
        </select>
        <label for="details">Describe the problem</label>
        <textarea id="details" name="details" rows="4" data-testid="support-details" required>${values.details ?? ''}</textarea>
        <label for="email">Contact email</label>
        <input id="email" name="email" type="email" value="${values.email ?? DEMO_USER.email}" data-testid="support-email" required>
        <label class="check"><input type="checkbox" name="storeCredit" value="on" data-testid="support-store-credit" ${storeCredit ? 'checked' : ''}>
          Accept store credit instead (faster, and get a bonus 5% to spend at Cartwell)</label>
        <button type="submit" class="btn" data-testid="support-submit" data-irreversible="true">Submit request</button>
      </form>
    </section>`;
  };

  app.get('/support', async (req, reply) => page(req, reply, { title: 'Support', body: await supportForm([]) }));

  app.post('/support', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const parsed = SupportSchema.safeParse(body);
    if (!parsed.success) {
      return page(req, reply, { title: 'Support', status: 422, body: await supportForm(parsed.error.issues.map((i) => i.message), { ...body, storeCredit: body.storeCredit ?? 'off' }) });
    }
    const d = parsed.data;
    const [o] = await sql<Order[]>`select * from cartwell_orders where order_id = ${d.orderId}`;
    const fail = async (msg: string, status = 422) => {
      await logEvent('cartwell', 'support_rejected', { orderId: d.orderId, reason: d.reason, message: msg }, req.agent.isAgent);
      return page(req, reply, { title: 'Support', status, body: await supportForm([msg], { ...body, storeCredit: body.storeCredit ?? 'off' }) });
    };
    if (!o) return fail('We could not find that order.');

    let kind: Ticket['kind'] = 'general';
    let amount = 0;
    if (d.reason === 'duplicate_charge') {
      const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int as n from cartwell_charges where order_id = ${o.order_id}`;
      if (n < 2) return fail(`Order ${o.order_id} was only charged once, so there is no duplicate charge to refund.`);
      kind = 'duplicate_charge';
      amount = o.paid_cents * (n - 1);
    } else if (d.reason === 'price_adjustment') {
      if (!inProtectionWindow(o)) {
        return fail(`Order ${o.order_id} is not eligible for a price adjustment (the price has not dropped within ${CARTWELL_PRICE_PROTECTION_DAYS} days of purchase).`);
      }
      kind = 'price_adjustment';
      amount = o.paid_cents - (o.price_now_cents ?? o.paid_cents);
    }

    if (kind !== 'general') {
      const [existing] = await sql<Ticket[]>`select * from cartwell_tickets where order_id = ${o.order_id} and kind = ${kind}`;
      if (existing) {
        return page(req, reply, {
          title: 'Support',
          status: 409,
          body: html`<section class="support"><div class="error-box" role="alert" data-testid="duplicate-ticket" data-ticket-id="${existing.id}">
            A ${kind === 'duplicate_charge' ? 'duplicate charge' : 'price adjustment'} request for ${o.order_id} already exists:
            <a href="/support/tickets/${existing.id}">${existing.id}</a>.</div></section>`,
        });
      }
    }

    const [{ n: seq } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int as n from cartwell_tickets`;
    const id = `CW-T-${digitsFrom(`cartwell:${o.order_id}:${kind}:${seq}`)}`;
    await sql`insert into cartwell_tickets (id, order_id, reason, kind, amount_cents, store_credit, details, email)
      values (${id}, ${o.order_id}, ${d.reason}, ${kind}, ${amount}, ${d.storeCredit === 'on'}, ${d.details}, ${d.email})`;
    await logEvent('cartwell', 'ticket_created', { ticketId: id, orderId: o.order_id, kind, amountCents: amount, storeCredit: d.storeCredit === 'on' }, req.agent.isAgent);
    return reply.redirect(`/support/tickets/${id}`, 303);
  });

  app.get<{ Params: { id: string } }>('/support/tickets/:id', async (req, reply) => {
    const asJson = req.params.id.endsWith('.json');
    const id = asJson ? req.params.id.slice(0, -5) : req.params.id;
    const [t] = await sql<Ticket[]>`select * from cartwell_tickets where id = ${id}`;
    if (!t) {
      if (asJson) return reply.code(404).send({ error: 'not_found' });
      return page(req, reply, { title: 'Not found', status: 404, body: html`<h1>Ticket not found</h1>` });
    }
    if (asJson) return ticketJson(t);
    const status = ticketStatus(t);
    const resolved = status !== 'under_review';
    return page(req, reply, {
      title: `Ticket ${t.id}`,
      body: html`<section class="ticket" data-testid="ticket-status" data-ticket-id="${t.id}" data-order-id="${t.order_id}" data-kind="${t.kind}"
          data-status="${status}" data-amount-cents="${t.amount_cents}" data-resolution="${t.store_credit ? 'store_credit' : 'card_refund'}">
        <p class="muted">Support ticket</p>
        <h1><span data-testid="ticket-id">${t.id}</span></h1>
        <p>Order <a href="/orders/${t.order_id}">${t.order_id}</a> · ${REASONS.find(([v]) => v === t.reason)?.[1] ?? t.reason}</p>
        <p class="status-line">Status: <strong class="status status-${status}" data-testid="ticket-status-label" data-status="${status}">${STATUS_LABEL[status]}</strong></p>
        ${t.kind === 'general'
          ? html`<p>Your message is in our general queue. A specialist will reply within 5 to 7 business days.</p>`
          : resolved
            ? html`<p data-testid="ticket-amount" data-amount-cents="${t.amount_cents}">${t.store_credit ? 'Store credit' : 'Refund to Visa ending 4417'}: <strong>${usd(t.amount_cents)}</strong></p>`
            : html`<p>We are reviewing your request for <strong data-amount-cents="${t.amount_cents}">${usd(t.amount_cents)}</strong>. Refresh this page for updates.</p>`}
      </section>`,
    });
  });
}

const CSS = `
body{background:#f7f1e6;color:#2b2418;font:16px/1.55 Georgia,"Iowan Old Style",serif}
a{color:#1f6f4a}
.site-header{display:flex;align-items:center;gap:28px;padding:18px 40px;border-bottom:3px double #2b2418;background:#fffaf0}
.logo{font:italic 700 30px Georgia,serif;color:#1f6f4a;text-decoration:none}
.site-header nav{display:flex;gap:20px;flex:1;font:15px system-ui,sans-serif}.site-header nav a{color:#2b2418}
.signed-in{font:13px system-ui,sans-serif;color:#6b5f4b}
main{max-width:860px;margin:0 auto;padding:32px 24px}
h1{font-weight:700;font-size:34px;margin:.2em 0}
.hero{background:#fffaf0;border:1px solid #e3d6bd;padding:40px;border-radius:4px}
.btn{display:inline-block;background:#1f6f4a;color:#fff;border:0;padding:10px 20px;border-radius:3px;font:600 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn-quiet{background:#e3d6bd;color:#2b2418}
.orders{display:grid;gap:12px}.order-card{display:flex;justify-content:space-between;background:#fffaf0;border:1px solid #e3d6bd;padding:16px 20px}
.order-card h2{font-size:20px;margin:0}.price{text-align:right;font:600 18px system-ui}.price .now{font-size:12px;color:#8a7a5c;margin:4px 0 0}
.history{width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;background:#fffaf0}
.history td,.history th{border-bottom:1px solid #e3d6bd;padding:8px;text-align:left}
.support form{display:grid;gap:8px;max-width:560px;font-family:system-ui,sans-serif}
.support select,.support input[type=email],.support textarea{font:15px system-ui;padding:8px;border:1px solid #bfae8a;background:#fff}
.check{font-size:13px;color:#4a3f2c;margin:8px 0}
.ticket{background:#fffaf0;border:1px solid #e3d6bd;padding:28px}
.status{padding:2px 10px;border-radius:3px;font-family:system-ui}.status-under_review{background:#f3e3b5}
.status-refund_issued,.status-price_adjustment_issued{background:#cfe8d9;color:#11492f}.status-store_credit_issued{background:#e3d6bd}
.site-footer{text-align:center;color:#8a7a5c;font:12px system-ui;padding:32px}
.card{max-width:520px;margin:40px auto;background:#fffaf0;border:1px solid #e3d6bd;padding:28px}
.btn-primary{background:#1f6f4a;color:#fff}
`;

export const cartwell: SiteDef = {
  key: 'cartwell',
  theme: {
    css: CSS,
    logo: html`Cartwell`,
    nav: [
      { href: '/', label: 'Shop', testid: 'nav-shop' },
      { href: '/orders', label: 'Orders', testid: 'nav-orders' },
      { href: '/support', label: 'Support', testid: 'nav-support' },
    ],
    footer: 'Cartwell General Goods',
  },
  routes,
  adminSections: async () => {
    const tickets = await sql<Ticket[]>`select * from cartwell_tickets order by created_at`;
    return [
      { title: 'Orders', rows: [...(await sql`select * from cartwell_orders order by sort`)] },
      { title: 'Charges', rows: [...(await sql`select * from cartwell_charges order by id`)] },
      { title: 'Tickets', rows: tickets.map((t) => ({ ...ticketJson(t), details: t.details })) },
    ];
  },
};
