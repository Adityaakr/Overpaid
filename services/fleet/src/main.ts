import { loadConfig } from './config.js';
import { logger } from './log.js';
import { buildFleet } from './server.js';

const cfg = loadConfig();
let fleet: Awaited<ReturnType<typeof buildFleet>>;
try {
  fleet = await buildFleet(cfg);
} catch (err) {
  logger.fatal({ err: (err as Error).message }, 'fleet failed to start');
  process.exit(1);
}
await fleet.app.listen({ host: cfg.host, port: cfg.port });
logger.info(
  {
    url: `http://${cfg.host}:${cfg.port}`,
    provider: fleet.provider.kind,
    model: fleet.models.reason,
    defaultMode: fleet.models.client ? 'agent' : 'scripted',
    recipes: [...fleet.recipes.keys()],
    maxSessions: cfg.maxSessions,
  },
  fleet.models.client ? 'fleet listening' : 'fleet listening (no model credentials: tasks will run in SCRIPTED mode)',
);

const stop = async (sig: string) => {
  logger.info({ sig }, 'shutting down');
  await fleet.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
