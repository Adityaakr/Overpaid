import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { VigilType, type MerchantKey } from '@overpaid/shared';
import { FLEET_ROOT, merchantOrigin, type FleetConfig } from './config.js';

export const MerchantKeySchema = z.enum(['vistaflix', 'cartwell', 'skylane', 'parcelo', 'external']);

const Template = z.string().min(1);

export const RecipeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    merchant: MerchantKeySchema,
    vigil: VigilType,
    /** Host patterns (see allowlist.ts). Templated: {{host}}, {{hostname}}. */
    allowedDomains: z.array(Template).min(1),
    /** Path prefixes blocked even on allowed hosts (payment bait, trap pages). */
    blockedPaths: z.array(z.string().startsWith('/')).default([]),
    /** Templated: {{origin}} plus params. */
    entryUrl: Template,
    goal: Template,
    params: z
      .record(z.string(), z.object({ description: z.string(), default: z.string().optional(), required: z.boolean().default(true) }))
      .default({}),
    hints: z.array(z.object({ step: z.string(), hint: z.string(), selector: z.string().optional() })).default([]),
    /** Research run: read-only on a real merchant's site; no verification page, the agent's findings are the result. */
    research: z.boolean().default(false),
    successSignal: z.object({
      /** Status page re-read in a fresh page to verify the outcome. Templated. */
      statusUrl: Template,
      /** Element carrying the data attributes. Templated. */
      selector: Template,
      /** Optional link on statusUrl to follow first (the last match wins, i.e. the newest ticket/claim). Templated. */
      followLink: Template.optional(),
      statusAttr: z.string().default('data-status'),
      /** Statuses that prove the request was accepted by the merchant. */
      successValues: z.array(z.string()).min(1),
      /** Statuses that prove the money was actually recovered; the verifier polls for these up to waitSeconds. */
      finalValues: z.array(z.string()).default([]),
      confirmationAttr: z.string().default('data-confirmation'),
      amountAttr: z.string().default('data-amount-cents'),
      /** Poll the status page this long for a success value (merchants resolve asynchronously). */
      waitSeconds: z.number().int().min(0).max(600).default(30),
    }).optional(),
    irreversibleSteps: z
      .array(
        z.object({
          id: z.string(),
          description: z.string(),
          /** If set, a click/press on an element matching this selector is gated on approval even if the agent forgot to ask. */
          selector: z.string().optional(),
        }),
      )
      .default([]),
    evidenceCheckpoints: z.array(z.object({ id: z.string(), description: z.string() })).default([]),
    maxSteps: z.number().int().positive().max(200).default(40),
    maxSeconds: z.number().int().positive().max(3600).default(300),
    /** Module name under services/merchants/scripted (without extension). */
    scripted: z.string().regex(/^[a-z0-9-]+$/).nullable().default(null),
  })
  .strict()
  .refine((r) => r.research || r.successSignal !== undefined, { message: 'successSignal is required unless research is true' });
export type Recipe = z.infer<typeof RecipeSchema>;

export const RECIPES_DIR = path.join(FLEET_ROOT, 'recipes');

export function loadRecipes(dir = RECIPES_DIR): Map<string, Recipe> {
  const out = new Map<string, Recipe>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as unknown;
    const parsed = RecipeSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`recipe ${f} is invalid: ${z.prettifyError(parsed.error)}`);
    if (`${parsed.data.id}.json` !== f) throw new Error(`recipe ${f} has id "${parsed.data.id}"; file name must match`);
    out.set(parsed.data.id, parsed.data);
  }
  return out;
}

export function renderTemplate(t: string, vars: Record<string, string>): string {
  return t.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`template variable "${k}" is missing`);
    return v;
  });
}

/** A recipe with every template resolved for one task. */
export interface ResolvedRecipe {
  recipe: Recipe;
  merchant: MerchantKey | 'external';
  origin: string;
  params: Record<string, string>;
  allowedDomains: string[];
  entryUrl: string;
  goal: string;
  statusUrl: string;
  statusSelector: string;
  followLink: string | null;
  hints: { step: string; hint: string; selector?: string }[];
}

export function resolveRecipe(recipe: Recipe, input: Record<string, unknown>, cfg: FleetConfig): ResolvedRecipe {
  const params: Record<string, string> = {};
  for (const [name, spec] of Object.entries(recipe.params)) {
    const v = input[name];
    if (v !== undefined && v !== null && v !== '') params[name] = String(v);
    else if (spec.default !== undefined) params[name] = spec.default;
    else if (spec.required) throw new Error(`recipe ${recipe.id} requires param "${name}" (${spec.description})`);
  }
  const origin = merchantOrigin(cfg, recipe.merchant);
  const u = new URL(origin);
  const vars = { ...params, origin, host: u.host, hostname: u.hostname };
  return {
    recipe,
    merchant: recipe.merchant,
    origin,
    params,
    allowedDomains: recipe.allowedDomains.map((d) => renderTemplate(d, vars)),
    entryUrl: renderTemplate(recipe.entryUrl, vars),
    goal: renderTemplate(recipe.goal, vars),
    statusUrl: recipe.successSignal ? renderTemplate(recipe.successSignal.statusUrl, vars) : '',
    statusSelector: recipe.successSignal ? renderTemplate(recipe.successSignal.selector, vars) : '',
    hints: recipe.hints.map((h) => ({ ...h, hint: renderTemplate(h.hint, vars), ...(h.selector ? { selector: renderTemplate(h.selector, vars) } : {}) })),
    followLink: recipe.successSignal?.followLink ? renderTemplate(recipe.successSignal.followLink, vars) : null,
  };
}
