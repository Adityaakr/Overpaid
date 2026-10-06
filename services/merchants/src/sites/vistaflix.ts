import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { codeFrom, logEvent, sql } from '../db.js';
import { html } from '../html.js';
import { issuesList, usd, type SiteCtx, type SiteDef } from '../common.js';

type Plan = {
  id: string;
  plan: string;
  amount_cents: number;
  cadence: string;
  started_on: string;
  last_watched: string | null;
  next_renewal: string;
  from_free_trial: boolean;
  status: 'active' | 'paused' | 'cancelled';
  cancel_stage: 'none' | 'pause_declined' | 'offer_declined' | 'surveyed';
  survey_reason: string | null;
  discount_pct: number;
  confirmation_code: string | null;
  cancelled_at: Date | null;
};

const STAGE_ORDER = ['none', 'pause_declined', 'offer_declined', 'surveyed'] as const;
const atLeast = (p: Plan, s: Plan['cancel_stage']) => STAGE_ORDER.indexOf(p.cancel_stage) >= STAGE_ORDER.indexOf(s);

export const SURVEY_REASONS = [
  ['too_expensive', 'It is too expensive'],
  ['not_watching', 'I am not watching enough'],
  ['missing_content', 'Missing shows or films I want'],
  ['technical', 'Technical or streaming problems'],
  ['switching', 'Switching to another service'],
  ['other', 'Something else'],
] as const;

const SurveySchema = z.object({
  reason: z.enum(SURVEY_REASONS.map(([v]) => v) as [string, ...string[]], { message: 'Choose a reason for leaving.' }),
  comments: z.string().max(1000).optional(),
});

/** Deterministic confirmation code derived from the plan id. */
export const vistaflixConfirmation = (planId: string) => `VF-CXL-${codeFrom(`vistaflix:${planId}`)}`;

async function getPlan(id: string): Promise<Plan | undefined> {
  const [p] = await sql<Plan[]>`select * from vistaflix_plans where id = ${id}`;
  return p;
}

const statusLabel = (p: Plan) => (p.status === 'cancelled' ? 'Cancelled' : p.status === 'paused' ? 'Paused' : 'Active');

function routes(app: FastifyInstance, { page }: SiteCtx): void {
  const notFound = (req: Parameters<SiteCtx['page']>[0], reply: Parameters<SiteCtx['page']>[1]) =>
    page(req, reply, { title: 'Not found', status: 404, body: html`<section class="panel"><h1>We could not find that plan.</h1></section>` });

  app.get('/', async (req, reply) =>
    page(req, reply, {
      title: 'Home',
      body: html`<section class="hero">
        <h1>Welcome back, Alex</h1>
        <p>Pick up where you left off. New this week: <em>The Lighthouse Accord</em>, season 3.</p>
        <div class="rows">${['Continue watching', 'Trending now', 'Because you watched Harbor Lights'].map(
          (r) => html`<div class="row"><h2>${r}</h2><div class="tiles">${[1, 2, 3, 4, 5].map(() => html`<div class="tile"></div>`)}</div></div>`,
        )}</div>
        <p><a class="btn btn-ghost" href="/account" data-testid="account-link">Go to your account</a></p>
      </section>`,
    }),
  );

  app.get('/account', async (req, reply) => {
    const plans = await sql<Plan[]>`select * from vistaflix_plans order by sort`;
    return page(req, reply, {
      title: 'Account',
      body: html`<section class="panel">
        <h1>Account</h1>
        <p class="muted">Member since March 2026 · alex.rivera@demo.overpaid.test</p>
        <h2>Your plans</h2>
        <table class="plans" data-testid="plans-table">
          <thead><tr><th>Plan</th><th>Price</th><th>Status</th><th>Next renewal</th><th>Cancellation code</th></tr></thead>
          <tbody>${plans.map(
            (p) => html`<tr data-testid="plan-row-${p.id}" data-plan-id="${p.id}" data-status="${p.status}"
                data-amount-cents="${p.amount_cents}" data-confirmation="${p.confirmation_code ?? ''}">
              <td>${p.plan}${p.from_free_trial ? html` <span class="pill">from free trial</span>` : ''}</td>
              <td>${usd(p.amount_cents)}/mo${p.discount_pct ? html` <span class="pill">${p.discount_pct}% off</span>` : ''}</td>
              <td><span class="status status-${p.status}" data-testid="plan-status-${p.id}" data-status="${p.status}">${statusLabel(p)}</span></td>
              <td>${p.status === 'cancelled' ? 'Will not renew' : p.next_renewal}</td>
              <td>${p.confirmation_code
                ? html`<code data-testid="plan-confirmation-${p.id}" data-confirmation="${p.confirmation_code}">${p.confirmation_code}</code>`
                : ''}</td>
            </tr>`,
          )}</tbody>
        </table>
        <p>To change or end a plan, open <a href="/account/settings" data-testid="settings-link">Settings</a>.</p>
      </section>`,
    });
  });

  app.get('/account/status.json', async () => {
    const plans = await sql<Plan[]>`select * from vistaflix_plans order by sort`;
    return {
      merchant: 'vistaflix',
      plans: plans.map((p) => ({ planId: p.id, plan: p.plan, status: p.status, confirmationCode: p.confirmation_code, amountCents: p.amount_cents })),
    };
  });

  app.get('/account/settings', async (req, reply) => {
    const plans = await sql<Plan[]>`select * from vistaflix_plans order by sort`;
    return page(req, reply, {
      title: 'Settings',
      body: html`<section class="panel">
        <h1>Settings</h1>
        <div class="settings-grid">
          <div class="setting"><h3>Profiles</h3><p>Alex, Kids</p><a href="#" class="muted">Edit profiles</a></div>
          <div class="setting"><h3>Playback</h3><p>Autoplay next episode: on</p><a href="#" class="muted">Change</a></div>
          <div class="setting"><h3>Notifications</h3><p>Email, push</p><a href="#" class="muted">Change</a></div>
          <div class="setting"><h3>Download quality</h3><p>High</p><a href="#" class="muted">Change</a></div>
        </div>
        <h2>Plans and billing</h2>
        <ul class="plan-list">${plans.map(
          (p) => html`<li data-plan-id="${p.id}" data-status="${p.status}">
            <strong>${p.plan}</strong> · ${usd(p.amount_cents)}/mo · ${statusLabel(p)}
            <a class="manage" href="/account/plans/${p.id}" data-testid="manage-plan-${p.id}" aria-label="Manage plan ${p.plan}">Manage plan</a>
          </li>`,
        )}</ul>
      </section>`,
    });
  });

  app.get<{ Params: { id: string } }>('/account/plans/:id', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    const offer = (req.query as Record<string, string>).offer === 'accepted';
    return page(req, reply, {
      title: `Manage ${p.plan}`,
      body: html`<section class="panel" data-plan-id="${p.id}" data-status="${p.status}">
        <h1>Manage plan: ${p.plan}</h1>
        ${offer ? html`<p class="notice" data-testid="offer-accepted">Great news: you kept your plan at ${p.discount_pct}% off.</p>` : ''}
        <p>${usd(p.amount_cents)} per month · Status: <span class="status status-${p.status}" data-status="${p.status}">${statusLabel(p)}</span></p>
        ${p.status === 'cancelled'
          ? html`<p>This plan is cancelled. Confirmation code <code data-confirmation="${p.confirmation_code ?? ''}">${p.confirmation_code}</code>.</p>`
          : html`<div class="cta-stack">
              <a class="btn btn-primary btn-xl" href="/account/settings" data-testid="upgrade-plan">Upgrade to Vistaflix Ultra</a>
              <a class="btn btn-ghost" href="/account/settings" data-testid="change-plan">Change plan</a>
            </div>
            <p class="fine"><a href="/account/plans/${p.id}/cancel" class="quiet-link" data-testid="cancel-plan">Cancel plan</a></p>`}
      </section>`,
    });
  });

  // Step 1: "Pause instead?" interstitial.
  app.get<{ Params: { id: string } }>('/account/plans/:id/cancel', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (p.status === 'cancelled') return reply.redirect(`/account/plans/${p.id}/cancelled`, 303);
    return page(req, reply, {
      title: 'Pause instead?',
      body: html`<section class="panel center" data-step="pause-interstitial">
        <h1>Pause instead?</h1>
        <p>Take a break without losing your profiles, watch history and recommendations. We will remind you before you are billed again.</p>
        <form method="post" action="/account/plans/${p.id}/pause">
          <button class="btn btn-primary btn-xl" type="submit" data-testid="pause-plan">Pause my plan for 1 month</button>
        </form>
        <form method="post" action="/account/plans/${p.id}/cancel/continue">
          <button class="link-button" type="submit" data-testid="continue-cancel">No thanks, continue to cancel</button>
        </form>
      </section>`,
    });
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/pause', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (p.status !== 'cancelled') await sql`update vistaflix_plans set status = 'paused', cancel_stage = 'none' where id = ${p.id}`;
    await logEvent('vistaflix', 'plan_paused', { planId: p.id }, req.agent.isAgent);
    return reply.redirect(`/account/plans/${p.id}`, 303);
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/cancel/continue', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (!atLeast(p, 'pause_declined')) await sql`update vistaflix_plans set cancel_stage = 'pause_declined' where id = ${p.id}`;
    return reply.redirect(`/account/plans/${p.id}/cancel/offer`, 303);
  });

  // Step 2: 50% retention offer.
  app.get<{ Params: { id: string } }>('/account/plans/:id/cancel/offer', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (!atLeast(p, 'pause_declined')) return reply.redirect(`/account/plans/${p.id}/cancel`, 303);
    return page(req, reply, {
      title: 'A special offer',
      body: html`<section class="panel center offer" data-step="retention-offer">
        <p class="eyebrow">Before you go</p>
        <h1>Stay for 50% off</h1>
        <p class="big-price">${usd(Math.round(p.amount_cents / 2))}<small>/mo for 3 months</small></p>
        <form method="post" action="/account/plans/${p.id}/cancel/offer/accept">
          <button class="btn btn-primary btn-xl" type="submit" data-testid="accept-offer">Yes! Keep ${p.plan} at 50% off</button>
        </form>
        <form method="post" action="/account/plans/${p.id}/cancel/offer/decline">
          <button class="link-button tiny" type="submit" data-testid="decline-offer">No thanks, I still want to cancel</button>
        </form>
      </section>`,
    });
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/cancel/offer/accept', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    await sql`update vistaflix_plans set discount_pct = 50, cancel_stage = 'none' where id = ${p.id} and status <> 'cancelled'`;
    await logEvent('vistaflix', 'retention_offer_accepted', { planId: p.id }, req.agent.isAgent);
    return reply.redirect(`/account/plans/${p.id}?offer=accepted`, 303);
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/cancel/offer/decline', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (!atLeast(p, 'pause_declined')) return reply.redirect(`/account/plans/${p.id}/cancel`, 303);
    if (!atLeast(p, 'offer_declined')) await sql`update vistaflix_plans set cancel_stage = 'offer_declined' where id = ${p.id}`;
    return reply.redirect(`/account/plans/${p.id}/cancel/survey`, 303);
  });

  // Step 3: required exit survey.
  const surveyPage = (planId: string, errors: string[]) => html`<section class="panel" data-step="exit-survey">
    <h1>Help us improve</h1>
    <p>Tell us why you are leaving. This is required to continue.</p>
    ${errors.length ? issuesList(errors) : ''}
    <form method="post" action="/account/plans/${planId}/cancel/survey" data-testid="survey-form">
      <fieldset><legend>Why are you cancelling?</legend>
        ${SURVEY_REASONS.map(
          ([v, label]) => html`<label class="radio"><input type="radio" name="reason" value="${v}" data-testid="survey-reason-${v}" required> ${label}</label>`,
        )}
      </fieldset>
      <label for="comments">Anything else? (optional)</label>
      <textarea id="comments" name="comments" rows="3"></textarea>
      <button class="btn btn-ghost" type="submit" data-testid="survey-submit">Continue</button>
    </form>
  </section>`;

  app.get<{ Params: { id: string } }>('/account/plans/:id/cancel/survey', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (!atLeast(p, 'offer_declined')) return reply.redirect(`/account/plans/${p.id}/cancel`, 303);
    return page(req, reply, { title: 'Exit survey', body: surveyPage(p.id, []) });
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/cancel/survey', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (!atLeast(p, 'offer_declined')) return reply.redirect(`/account/plans/${p.id}/cancel`, 303);
    const parsed = SurveySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return page(req, reply, { title: 'Exit survey', status: 422, body: surveyPage(p.id, parsed.error.issues.map((i) => i.message)) });
    }
    await sql`update vistaflix_plans set cancel_stage = 'surveyed', survey_reason = ${parsed.data.reason} where id = ${p.id}`;
    return reply.redirect(`/account/plans/${p.id}/cancel/confirm`, 303);
  });

  // Step 4: final confirm (the irreversible step), deliberately low-contrast.
  app.get<{ Params: { id: string } }>('/account/plans/:id/cancel/confirm', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (p.status === 'cancelled') return reply.redirect(`/account/plans/${p.id}/cancelled`, 303);
    if (!atLeast(p, 'surveyed')) return reply.redirect(`/account/plans/${p.id}/cancel/survey`, 303);
    return page(req, reply, {
      title: 'Confirm cancellation',
      body: html`<section class="panel center" data-step="confirm">
        <h1>We will miss you</h1>
        <p>If you cancel, you lose access to ${p.plan} at the end of your billing period, and your watch history may be deleted after 10 months.</p>
        <a class="btn btn-primary btn-xl" href="/account/plans/${p.id}" data-testid="keep-plan">Keep my plan</a>
        <form method="post" action="/account/plans/${p.id}/cancel/confirm" class="lowcontrast-form">
          <button class="lowcontrast" type="submit" data-testid="confirm-cancellation" data-irreversible="true">Confirm cancellation</button>
        </form>
      </section>`,
    });
  });

  app.post<{ Params: { id: string } }>('/account/plans/:id/cancel/confirm', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (p.status !== 'cancelled') {
      if (!atLeast(p, 'surveyed')) return reply.redirect(`/account/plans/${p.id}/cancel/survey`, 303);
      const code = vistaflixConfirmation(p.id);
      await sql`update vistaflix_plans set status = 'cancelled', confirmation_code = ${code}, cancelled_at = now() where id = ${p.id}`;
      await logEvent('vistaflix', 'plan_cancelled', { planId: p.id, confirmationCode: code }, req.agent.isAgent);
    }
    return reply.redirect(`/account/plans/${p.id}/cancelled`, 303);
  });

  app.get<{ Params: { id: string } }>('/account/plans/:id/cancelled', async (req, reply) => {
    const p = await getPlan(req.params.id);
    if (!p) return notFound(req, reply);
    if (p.status !== 'cancelled') return reply.redirect(`/account/plans/${p.id}`, 303);
    return page(req, reply, {
      title: 'Cancellation confirmed',
      body: html`<section class="panel center success" data-testid="cancellation-success" data-plan-id="${p.id}" data-status="cancelled"
          data-confirmation="${p.confirmation_code ?? ''}" data-amount-cents="${p.amount_cents}">
        <h1>Your ${p.plan} plan is cancelled</h1>
        <p>You will not be charged ${usd(p.amount_cents)} again.</p>
        <p>Confirmation code: <code class="code" data-testid="confirmation-code">${p.confirmation_code}</code></p>
        <p><a href="/account" data-testid="account-link">Back to account</a></p>
      </section>`,
    });
  });
}

const CSS = `
body{background:#0d0b1e;color:#ecebff;font:16px/1.5 "Avenir Next",Avenir,"Segoe UI",system-ui,sans-serif}
a{color:#b8a6ff}
.site-header{display:flex;align-items:center;gap:24px;padding:16px 32px;background:linear-gradient(90deg,#1a1240,#0d0b1e)}
.logo{font:800 26px/1 "Avenir Next",system-ui;letter-spacing:.08em;color:#7c5cff;text-decoration:none;text-transform:uppercase}
.site-header nav{display:flex;gap:18px;flex:1}.site-header nav a{color:#ecebff;text-decoration:none}
.signed-in{font-size:13px;color:#a9a6c9}
main{max-width:980px;margin:0 auto;padding:32px}
.panel{background:#17142e;border:1px solid #2b2650;border-radius:14px;padding:28px 32px}
.center{text-align:center}.center form{margin:14px 0}
h1{font-weight:800;letter-spacing:-.01em}
.hero h1{font-size:40px}.row h2{font-size:18px;margin:18px 0 8px}
.tiles{display:flex;gap:10px}.tile{flex:1;height:90px;border-radius:8px;background:linear-gradient(135deg,#2c2263,#5a3fd1)}
.btn{display:inline-block;border:0;border-radius:999px;padding:10px 22px;font:700 15px system-ui;cursor:pointer;text-decoration:none}
.btn-primary{background:#7c5cff;color:#fff}.btn-ghost{background:transparent;color:#ecebff;border:1px solid #5c54a0}
.btn-xl{font-size:20px;padding:16px 36px}
.cta-stack{display:flex;gap:12px;margin:20px 0}
.fine{font-size:12px;margin-top:40px}.quiet-link{color:#6d6890}
.link-button{background:none;border:0;color:#b8a6ff;text-decoration:underline;cursor:pointer;font:inherit}
.link-button.tiny{font-size:11px;color:#77739a}
.lowcontrast{background:none;border:0;color:#2b2650;font-size:12px;cursor:pointer;margin-top:24px}
.plans{width:100%;border-collapse:collapse}.plans td,.plans th{padding:10px;border-bottom:1px solid #2b2650;text-align:left}
.status{padding:2px 10px;border-radius:999px;font-size:13px}.status-active{background:#1e4a33;color:#8ff0b8}
.status-paused{background:#4a3e1e;color:#f0d68f}.status-cancelled{background:#4a1e2a;color:#f08fa8}
.pill{font-size:11px;background:#2b2650;border-radius:999px;padding:1px 8px}
.settings-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.setting{background:#1f1b3d;border-radius:10px;padding:12px 16px}
.plan-list li{margin:10px 0}.manage{margin-left:12px}
.offer .eyebrow{text-transform:uppercase;letter-spacing:.2em;color:#7c5cff}.big-price{font-size:48px;font-weight:800;margin:8px 0}
.radio{display:block;margin:6px 0}textarea{width:100%;background:#0d0b1e;color:#ecebff;border:1px solid #2b2650;border-radius:8px}
fieldset{border:1px solid #2b2650;border-radius:10px;margin-bottom:16px}
.code{font-size:22px;background:#0d0b1e;padding:4px 12px;border-radius:6px}
.notice{background:#1e4a33;padding:8px 12px;border-radius:8px}
.site-footer{text-align:center;color:#6d6890;font-size:12px;padding:32px}
.card{max-width:520px;margin:40px auto;background:#17142e;padding:28px;border-radius:14px}
`;

export const vistaflix: SiteDef = {
  key: 'vistaflix',
  theme: {
    css: CSS,
    logo: html`Vistaflix`,
    nav: [
      { href: '/', label: 'Browse', testid: 'nav-browse' },
      { href: '/account', label: 'Account', testid: 'nav-account' },
      { href: '/account/settings', label: 'Settings', testid: 'nav-settings' },
    ],
    footer: 'Vistaflix Streaming',
  },
  routes,
  adminSections: async () => [
    { title: 'Plans', rows: [...(await sql`select id, plan, amount_cents, status, cancel_stage, survey_reason, discount_pct, confirmation_code, cancelled_at from vistaflix_plans order by sort`)] },
  ],
};
