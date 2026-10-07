import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Sokosumi CLI needs Node 24; point SOKOSUMI_NODE_BIN at that install when the shell default is older.
const env = { ...process.env, PATH: [process.env.SOKOSUMI_NODE_BIN, process.env.PATH].filter(Boolean).join(':') };

export const COWORKER_ID = process.env.COWORKER_ID ?? '';
/** Personal Workspace by default; set SOKOSUMI_ORG_ID (and SOKOSUMI_ORG_SLUG) for the event Workspace. */
export const scope = (kind: 'task' | 'runtime'): string[] =>
  !process.env.SOKOSUMI_ORG_ID ? ['--personal'] : kind === 'task' ? ['--organization-slug', process.env.SOKOSUMI_ORG_SLUG ?? ''] : ['--organization-id', process.env.SOKOSUMI_ORG_ID];

export function cli<T = any>(args: string[]): T {
  const out = execFileSync('sokosumi', ['--preprod', ...args, '--json'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 << 20, env });
  return JSON.parse(out) as T;
}

let runtime: Promise<any> | undefined;
/** The CLI's own runtime modules: vault credential and Coworker-scoped HTTP client. */
export function sokosumiRuntime() {
  runtime ??= (async () => {
    const skills = execFileSync('sokosumi', ['skills', 'path'], { encoding: 'utf8', timeout: 30_000, env }).trim();
    if (!isAbsolute(skills) || !skills.endsWith('/skills')) throw new Error('sokosumi skills path returned an unexpected path');
    const root = join(dirname(skills), 'dist', 'src');
    const mods = await Promise.all(['coworker/runtime-credentials.js', 'api/http-client.js', 'api/services/task-service.js'].map((p) => import(pathToFileURL(join(root, p)).href)));
    return Object.assign({}, ...mods);
  })();
  return runtime;
}

let core: any;
export async function coworkerCore() {
  if (!core) {
    const rt = await sokosumiRuntime();
    core = rt.createCoworkerHttpClient({ apiKey: rt.readRuntimeCredential(COWORKER_ID) });
  }
  return core as { get(path: string): Promise<any>; post(path: string, body: unknown): Promise<any> };
}
