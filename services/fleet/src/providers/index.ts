import type { FleetConfig } from '../config.js';
import { AgentCoreProvider } from './agentcore.js';
import { LocalProvider } from './local.js';
import type { SessionProvider } from './types.js';

export function createProvider(cfg: FleetConfig): SessionProvider {
  return cfg.provider === 'agentcore' ? new AgentCoreProvider(cfg) : new LocalProvider(cfg);
}
export * from './types.js';
