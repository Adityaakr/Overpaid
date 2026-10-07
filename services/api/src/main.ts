import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createDb } from '@overpaid/db';
import { PORTS } from '@overpaid/shared';
import { Bus } from './bus.js';
import { registerGuard, webOrigins } from './guard.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerProductRoutes } from './routes/product.js';
import { Orchestrator } from './orchestrator.js';
import { followHires, registerSpecialistRoutes } from './routes/specialist.js';
import { followBloc, registerBlocRoutes } from './routes/bloc.js';
import { registerFeeRoutes } from './routes/fees.js';
import { registerAnchorRoutes } from './routes/anchor.js';
import { registerX402AuditRoutes } from './routes/x402audit.js';

const db = createDb();
const bus = new Bus(db);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  genReqId: () => crypto.randomUUID().slice(0, 8),
});
await app.register(cors, { origin: webOrigins(), allowedHeaders: ['content-type', 'x-overpaid-client', 'x-operator-token', 'last-event-id'] });
registerGuard(app);

await registerCoreRoutes(app, { db, bus });
const orch = new Orchestrator(db, bus);
await registerProductRoutes(app, { db, bus }, orch);
void orch.follow();
await registerSpecialistRoutes(app, { db, bus });
void followHires(db, bus);
await registerBlocRoutes(app, { bus });
void followBloc(bus);
await registerFeeRoutes(app, { db, bus });
await registerAnchorRoutes(app, { db, bus });
await registerX402AuditRoutes(app);

const port = Number(process.env.API_PORT ?? PORTS.api);
await app.listen({ port, host: '127.0.0.1' });
