import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { RecipeSchema, loadRecipes, renderTemplate, resolveRecipe } from '../src/recipes.js';
import { scriptedPath } from '../src/scripted.js';

const cfg = loadConfig({});

describe('recipes', () => {
  const recipes = loadRecipes();

  it('loads the five demo recipes and every one validates', () => {
    expect([...recipes.keys()].sort()).toEqual(['cartwell-duplicate', 'cartwell-price-adjust', 'parcelo-undelivered', 'research-merchant', 'skylane-claim', 'vistaflix-cancel']);
    for (const r of recipes.values()) {
      expect(RecipeSchema.parse(r)).toEqual(r);
      if (!r.research) expect(r.irreversibleSteps.length).toBeGreaterThan(0);
      expect(r.allowedDomains.length).toBeGreaterThan(0);
    }
  });

  it('every recipe names a scripted solution that exists in services/merchants/scripted', () => {
    for (const r of recipes.values()) {
      if (r.research) continue; // read-only research runs on real sites have no scripted fallback
      expect(r.scripted, r.id).toBeTruthy();
      expect(scriptedPath(r.scripted!), `${r.id} -> ${r.scripted}`).not.toBeNull();
    }
  });

  it('resolves templates against the merchant origin and params', () => {
    const r = resolveRecipe(recipes.get('vistaflix-cancel')!, { planId: 'vf-plan-basic' }, cfg);
    expect(r.origin).toBe('http://localhost:4101');
    expect(r.allowedDomains).toEqual(['localhost:4101']);
    expect(r.statusUrl).toBe('http://localhost:4101/account');
    expect(r.statusSelector).toBe('[data-testid="plan-row-vf-plan-basic"]');
    expect(r.goal).toContain('vf-plan-basic');
    expect(r.hints.some((h) => h.selector === '[data-testid=manage-plan-vf-plan-basic]')).toBe(true);
  });

  it('applies defaults and rejects missing required params', () => {
    expect(resolveRecipe(recipes.get('cartwell-duplicate')!, {}, cfg).params.orderId).toBe('CW-4417');
    expect(() => resolveRecipe(recipes.get('parcelo-undelivered')!, {}, cfg)).toThrow(/requires param "orderId"/);
  });

  it('honours MERCHANTS_PORT_OFFSET', () => {
    const r = resolveRecipe(recipes.get('skylane-claim')!, {}, loadConfig({ MERCHANTS_PORT_OFFSET: '2000' }));
    expect(r.origin).toBe('http://localhost:6103');
    expect(r.followLink).toBe('[data-testid=existing-claim]');
  });

  it('rejects malformed recipes', () => {
    const good = recipes.get('vistaflix-cancel')!;
    expect(RecipeSchema.safeParse({ ...good, merchant: 'acme' }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...good, allowedDomains: [] }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...good, evaluate: true }).success).toBe(false); // strict: unknown keys rejected
    expect(RecipeSchema.safeParse({ ...good, blockedPaths: ['express-fee'] }).success).toBe(false);
    const { successSignal: _s, ...noSignal } = good;
    expect(RecipeSchema.safeParse(noSignal).success).toBe(false);
  });

  it('rejects a recipe whose file name does not match its id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-'));
    fs.writeFileSync(path.join(dir, 'wrong.json'), JSON.stringify(recipes.get('vistaflix-cancel')));
    expect(() => loadRecipes(dir)).toThrow(/file name must match/);
  });

  it('renderTemplate fails loudly on unknown variables', () => {
    expect(renderTemplate('{{a}}-{{ b }}', { a: '1', b: '2' })).toBe('1-2');
    expect(() => renderTemplate('{{nope}}', {})).toThrow(/missing/);
  });
});
