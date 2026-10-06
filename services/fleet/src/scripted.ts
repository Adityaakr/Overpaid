import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { REPO_ROOT } from './config.js';

export const SCRIPTED_DIR = process.env.MERCHANTS_SCRIPTED_DIR
  ? path.resolve(process.env.MERCHANTS_SCRIPTED_DIR)
  : path.join(REPO_ROOT, 'services', 'merchants', 'scripted');

/** Mirrors services/merchants/scripted/lib.ts ApprovalRequest (kept structural so the fleet has no build dep on it). */
export interface ScriptedApprovalRequest {
  recipe: string;
  merchant: string;
  action: string;
  description: string;
  url: string;
  amountCents: number | null;
}
/** Mirrors services/merchants/scripted/lib.ts RecipeResult. */
export interface ScriptedResult {
  outcome: 'success' | 'pending' | 'approval_denied' | 'failed';
  confirmationCode: string | null;
  amountCents: number | null;
  merchantStatus: string | null;
  statusUrl: string | null;
  error?: string;
  steps: { url: string; action: string }[];
}

/** Options handed to a merchant's scripted Playwright solution: `run(page, opts)`. Recipe params are spread in too. */
export interface ScriptedOptions {
  /** Merchant origin, e.g. http://localhost:4101 */
  baseUrl: string;
  /** Called right before each irreversible click; pauses until the user decides. */
  requestApproval: (req: ScriptedApprovalRequest) => Promise<boolean>;
  /** The fleet already injected the demo cookie into the context. */
  injectSession: boolean;
  waitForFinal: boolean;
  actionTimeoutMs: number;
  [param: string]: unknown;
}

export function isScriptedResult(x: unknown): x is ScriptedResult {
  return typeof x === 'object' && x !== null && typeof (x as { outcome?: unknown }).outcome === 'string';
}
export type ScriptedRun = (page: Page, opts: ScriptedOptions) => Promise<unknown>;

export function scriptedPath(name: string): string | null {
  for (const ext of ['.ts', '.js', '.mjs']) {
    const p = path.join(SCRIPTED_DIR, name + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function loadScripted(name: string): Promise<ScriptedRun> {
  const p = scriptedPath(name);
  if (!p) throw new Error(`scripted solution "${name}" not found in ${SCRIPTED_DIR}`);
  const mod = (await import(pathToFileURL(p).href)) as { run?: unknown; default?: { run?: unknown } | unknown };
  const run = typeof mod.run === 'function' ? mod.run : typeof (mod.default as { run?: unknown })?.run === 'function' ? (mod.default as { run: unknown }).run : mod.default;
  if (typeof run !== 'function') throw new Error(`scripted module ${p} does not export run(page, opts)`);
  return run as ScriptedRun;
}
