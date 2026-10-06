/**
 * Secrets and chain config from the environment. Seeds come from process.env (SEED_A/B/C) or the repo-root
 * `.env.wallets` (dotenv syntax, gitignored, mode 600). Nothing here ever logs a value.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_BLOCKFROST_BASE_URL } from './constants.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export class PrerequisiteError extends Error {
  constructor(message: string, readonly needs: string[]) {
    super(message);
    this.name = 'PrerequisiteError';
  }
}

/** Minimal dotenv parser: KEY=value, optional single/double quotes, # comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]!] = v;
  }
  return out;
}

let fileCache: Record<string, string> | null = null;
function walletsFile(): Record<string, string> {
  if (fileCache) return fileCache;
  const file = process.env.WALLETS_FILE ?? path.join(REPO_ROOT, '.env.wallets');
  fileCache = existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  return fileCache;
}

export type SeedName = 'A' | 'B' | 'C';
/** Returns the mnemonic for a seed or throws PrerequisiteError. Callers must never log it. */
export function seedMnemonic(seed: SeedName): string {
  const key = `SEED_${seed}`;
  const v = (process.env[key] || walletsFile()[key] || '').trim();
  if (!v) throw new PrerequisiteError(`${key} is not set (repo-root .env.wallets or env); run scripts/gen-wallets.ts`, [key]);
  const words = v.split(/\s+/).length;
  if (words !== 24 && words !== 15 && words !== 12) throw new PrerequisiteError(`${key} is not a BIP-39 mnemonic`, [key]);
  return v;
}

export interface BlockfrostConfig {
  baseUrl: string;
  projectId: string;
}

export function blockfrostConfig(env: NodeJS.ProcessEnv = process.env): BlockfrostConfig | null {
  const projectId = (env.BLOCKFROST_PROJECT_ID ?? '').trim();
  if (!projectId) return null;
  if (!projectId.startsWith('preprod')) throw new Error('BLOCKFROST_PROJECT_ID must be a preprod key (starts with "preprod")');
  return { baseUrl: (env.BLOCKFROST_BASE_URL || DEFAULT_BLOCKFROST_BASE_URL).replace(/\/+$/, ''), projectId };
}

export function requireBlockfrost(env: NodeJS.ProcessEnv = process.env): BlockfrostConfig {
  const c = blockfrostConfig(env);
  if (!c) throw new PrerequisiteError('needs BLOCKFROST_PROJECT_ID (a Blockfrost preprod project id) in the environment or repo-root .env', ['BLOCKFROST_PROJECT_ID']);
  return c;
}
