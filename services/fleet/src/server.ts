import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { z } from 'zod';
import type { FleetConfig } from './config.js';
import { logger } from './log.js';
import { selectModelClient, type ModelAvailability } from './model/index.js';
import { createProvider, type SessionProvider } from './providers/index.js';
import { loadRecipes, type Recipe } from './recipes.js';
import { TaskError, TaskManager, type FleetEvent } from './tasks.js';
import { Verifier } from './verify.js';

const SubmitBody = z.object({
  taskId: z.string().min(1).max(100),
  recipeId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['agent', 'scripted', 'auto']).optional(),
  retry: z.boolean().optional(),
});
const ApprovalBody = z.object({ approved: z.boolean(), approvalId: z.string().optional() });

export interface FleetApp {
  app: FastifyInstance;
  manager: TaskManager;
  provider: SessionProvider;
  models: ModelAvailability;
  recipes: Map<string, Recipe>;
  close(): Promise<void>;
}

export async function buildFleet(cfg: FleetConfig, opts: { models?: ModelAvailability; provider?: SessionProvider } = {}): Promise<FleetApp> {
  const recipes = loadRecipes();
  const provider = opts.provider ?? createProvider(cfg);
  await provider.init(); // throws with a clear message (e.g. agentcore without AWS creds)
  const models = opts.models ?? (await selectModelClient(cfg));
  const verifier = new Verifier(cfg);
  const manager = new TaskManager(cfg, recipes, provider, models.client, verifier);

  // Request logs are info-level; the http child logs warnings and errors only (frame polling would flood the log).
  const streams = new Set<import('node:http').ServerResponse>();
  const app = Fastify({ forceCloseConnections: true, loggerInstance: logger.child({ component: 'http' }, { level: 'warn' }) as unknown as FastifyBaseLogger });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TaskError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: z.prettifyError(err) });
    const e = err as { statusCode?: number; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'internal error' });
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'fleet',
    provider: provider.kind,
    region: provider.kind === 'agentcore' ? cfg.awsRegion : undefined,
    model: { client: models.client?.kind ?? null, model: models.client?.model ?? null, bedrock: models.bedrock, anthropic: models.anthropic, reason: models.reason },
    defaultMode: models.client ? 'agent' : 'scripted',
    activeSessions: provider.active(),
    maxSessions: cfg.maxSessions,
    queue: manager.queueStats(),
    recipes: [...recipes.keys()],
    holdsKeys: false,
  }));

  app.get('/recipes', async () => [...recipes.values()]);

  app.post('/tasks', async (req, reply) => {
    const body = SubmitBody.parse(req.body);
    const { task, created } = manager.submit(body);
    return reply.code(created ? 202 : 200).send(task);
  });

  app.get('/tasks', async () => manager.list());

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const t = manager.get(req.params.id);
    return t ? t : reply.code(404).send({ error: 'unknown task' });
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/approval', async (req) => {
    const body = ApprovalBody.parse(req.body);
    return manager.decideApproval(req.params.id, body.approved, body.approvalId);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/cancel', async (req) => manager.cancel(req.params.id));

  app.get<{ Params: { id: string; approvalId: string } }>('/tasks/:id/approvals/:approvalId', async (req, reply) => {
    const img = manager.approvalImage(req.params.id, req.params.approvalId.replace(/\.png$/, ''));
    if (!img) return reply.code(404).send({ error: 'no such approval screenshot' });
    return reply.type('image/png').header('cache-control', 'no-store').send(img);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/frame.jpg', async (req, reply) => {
    const sc = manager.screencast(req.params.id);
    if (!sc) return reply.code(404).send({ error: 'no live view for this task (not started, or unknown)' });
    const live = manager.session(req.params.id) !== null && manager.get(req.params.id)?.finishedAt === null;
    const frame = live ? await sc.frame() : sc.peek();
    if (!frame) return reply.code(404).send({ error: 'no frame yet' });
    return reply.type('image/jpeg').header('cache-control', 'no-store').send(frame);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/stream', async (req, reply) => {
    const sc = manager.screencast(req.params.id);
    if (!sc) return reply.code(404).send({ error: 'no live view for this task' });
    const boundary = 'overpaidframe';
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    const write = (jpeg: Buffer) => {
      res.write(`--${boundary}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write('\r\n');
    };
    const first = sc.peek();
    if (first) write(first);
    const unsub = sc.subscribe(write);
    // Re-send the latest frame periodically so idle pages still refresh slow clients.
    const keep = setInterval(() => {
      const f = sc.peek();
      if (f) write(f);
    }, 2000);
    req.raw.on('close', () => {
      unsub();
      clearInterval(keep);
    });
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/liveview', async (req, reply) => {
    const s = manager.session(req.params.id);
    const t = manager.get(req.params.id);
    if (!s || !t || t.finishedAt) return reply.code(404).send({ error: 'no live session for this task' });
    const lv = await s.liveView(); // agentcore: re-signs before the presigned URL expires
    return lv;
  });

  app.get('/events', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    streams.add(res);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(': fleet events\n\n');
    let seq = 0;
    const send = (e: FleetEvent) => res.write(`id: ${++seq}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...e.data, at: new Date().toISOString() })}\n\n`);
    // Snapshot of current tasks so a late subscriber can render tiles immediately.
    for (const t of manager.list()) {
      send({ type: 'task.updated', data: { taskId: t.taskId, state: t.state, step: t.step, mode: t.mode, recipeId: t.recipeId } });
    }
    const onEvent = (e: FleetEvent) => send(e);
    manager.events.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.raw.on('close', () => {
      manager.events.off('event', onEvent);
      clearInterval(ping);
      streams.delete(res);
    });
  });

  return {
    app,
    manager,
    provider,
    models,
    recipes,
    close: async () => {
      await manager.shutdown();
      for (const r of streams) r.end();
      await app.close();
      await provider.close();
      await verifier.close();
    },
  };
}
