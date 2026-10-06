import type { FastifyInstance } from 'fastify';
import { buildSite } from './common.js';
import { config, portFor, SITES } from './config.js';
import { ensureSchema, seedIfNeeded, sql } from './db.js';
import { SITE_DEFS } from './sites/index.js';

async function main(): Promise<void> {
  await ensureSchema();
  await seedIfNeeded(SITES);
  const apps: FastifyInstance[] = [];
  for (const key of SITES) {
    const app = await buildSite(SITE_DEFS[key]);
    await app.listen({ port: portFor(key), host: config.host });
    apps.push(app);
  }
  const shutdown = async () => {
    await Promise.allSettled(apps.map((a) => a.close()));
    await sql.end({ timeout: 2 });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
