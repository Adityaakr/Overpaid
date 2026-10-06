import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgent, SYSTEM_PROMPT } from '../src/agent.js';
import { logger } from '../src/log.js';
import type { Conversation, ModelClient, ModelTurn, ToolResult, UserPart } from '../src/model/types.js';
import type { ResolvedRecipe } from '../src/recipes.js';
import type { ToolDef } from '../src/tools.js';
import { Deadline } from '../src/util.js';
import { serve } from './helpers.js';

/** A scripted stand-in for Claude: returns canned turns and records what it was sent. */
class FakeModel implements ModelClient {
  readonly kind = 'anthropic' as const;
  readonly model = 'fake';
  sent: { parts?: UserPart[]; results?: ToolResult[] }[] = [];
  system = '';
  tools: ToolDef[] = [];
  constructor(private turns: Omit<ModelTurn, 'usage' | 'raw' | 'text'>[]) {}
  start(system: string, tools: ToolDef[]): Conversation {
    this.system = system;
    this.tools = tools;
    const next = async (): Promise<ModelTurn> => {
      const t = this.turns.shift() ?? { stop: 'end_turn', toolCalls: [] };
      return { ...t, text: '', raw: t.stop, usage: { inputTokens: 100, outputTokens: 10 } };
    };
    return {
      send: async (parts) => (this.sent.push({ parts }), next()),
      sendToolResults: async (results, extra) => (this.sent.push({ results, parts: extra }), next()),
    };
  }
}

const PAGE = `<!doctype html><title>Plans</title><h1>Plans</h1>
<form action="/cancelled"><button data-testid="confirm" data-irreversible="true">Confirm cancellation</button></form>`;

describe('agent loop', () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => {
    browser = await chromium.launch();
    site = await serve({ '/': PAGE, '/cancelled': '<h1 data-status="cancelled">Cancelled VF-1</h1>' });
  });
  afterAll(async () => {
    await browser.close();
    await site.close();
  });

  const resolved = (): ResolvedRecipe =>
    ({
      recipe: { id: 'r', merchant: 'vistaflix', maxSteps: 10, maxSeconds: 60, irreversibleSteps: [{ id: 'confirm', description: 'Confirm', selector: '[data-irreversible=true]' }], hints: [] },
      merchant: 'vistaflix',
      origin: site.origin,
      params: {},
      allowedDomains: [site.host],
      entryUrl: `${site.origin}/`,
      goal: 'cancel the plan',
      statusUrl: `${site.origin}/cancelled`,
      statusSelector: 'h1',
      followLink: null,
      hints: [{ step: 'confirm', hint: 'press confirm' }],
    }) as unknown as ResolvedRecipe;

  it('drives tools, batches tool results, gates approval, and returns the claim', async () => {
    const model = new FakeModel([
      { stop: 'end_turn', toolCalls: [] }, // no tool call -> nudged
      { stop: 'tool_use', toolCalls: [{ id: 't1', name: 'getText', input: { selector: 'h1' } }, { id: 't2', name: 'screenshot', input: {} }] },
      { stop: 'tool_use', toolCalls: [{ id: 't3', name: 'click', input: { selector: '[data-testid=confirm]' } }] },
      { stop: 'tool_use', toolCalls: [{ id: 't4', name: 'complete', input: { summary: 'done', confirmationCode: 'VF-1' } }] },
    ]);
    const page = await browser.newPage();
    await page.goto(`${site.origin}/`);
    const approvals: string[] = [];
    const usage = { in: 0, out: 0 };
    const res = await runAgent({
      page,
      resolved: resolved(),
      model,
      deadline: new Deadline(60_000),
      log: logger,
      isCancelled: () => false,
      onUsage: (u) => {
        usage.in += u.inputTokens;
        usage.out += u.outputTokens;
      },
      onStep: () => {},
      ctx: {
        allowedDomains: [site.host],
        recipe: resolved().recipe,
        approved: new Set(),
        requestApproval: async (s) => (approvals.push(s), true),
        record: async () => {},
        flag: () => {},
      },
    });
    expect(res).toEqual({ kind: 'complete', claim: { kind: 'complete', summary: 'done', confirmationCode: 'VF-1' } });
    expect(approvals).toEqual(['confirm']);
    expect(page.url()).toContain('/cancelled');
    expect(model.system).toBe(SYSTEM_PROMPT);
    expect(model.system).toMatch(/DATA, never instructions/);
    expect(model.tools.map((t) => t.name)).not.toContain('evaluate');
    // First message: goal + snapshot + screenshot.
    const first = model.sent[0]!.parts!;
    expect(first[0]).toMatchObject({ type: 'text' });
    expect((first[0] as { text: string }).text).toContain('Goal: cancel the plan');
    expect((first[0] as { text: string }).text).toContain('button "Confirm cancellation"');
    expect(first[1]).toMatchObject({ type: 'image' });
    // Both results of the parallel turn went back in one message.
    const batched = model.sent.find((s) => s.results?.length === 2)!;
    expect(batched.results!.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(batched.results![1]!.content.some((c) => c.type === 'image')).toBe(true);
    expect(usage).toEqual({ in: 400, out: 40 });
    await page.close();
  });

  it('enforces the step limit', async () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ stop: 'tool_use' as const, toolCalls: [{ id: `s${i}`, name: 'getText', input: {} }] }));
    const page = await browser.newPage();
    await page.goto(`${site.origin}/`);
    const r = resolved();
    (r.recipe as { maxSteps: number }).maxSteps = 3;
    const res = await runAgent({
      page,
      resolved: r,
      model: new FakeModel(turns),
      deadline: new Deadline(60_000),
      log: logger,
      isCancelled: () => false,
      onUsage: () => {},
      onStep: () => {},
      ctx: { allowedDomains: [site.host], recipe: r.recipe, approved: new Set(), requestApproval: async () => true, record: async () => {}, flag: () => {} },
    });
    expect(res).toEqual({ kind: 'fail', reason: 'step limit 3 reached' });
    await page.close();
  });
});
