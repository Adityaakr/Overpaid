import type { FleetConfig } from '../config.js';
import { awsCredentialsAvailable } from '../providers/agentcore.js';
import { AnthropicClient } from './anthropic.js';
import { BedrockConverseClient } from './bedrock.js';
import { OpenRouterClient } from './openrouter.js';
import type { ModelClient } from './types.js';

export interface ModelAvailability {
  client: ModelClient | null;
  bedrock: boolean;
  anthropic: boolean;
  reason: string;
}

/** Bedrock when AWS creds exist, else the Anthropic API, else OpenRouter, else none (scripted). */
export async function selectModelClient(cfg: FleetConfig, env: NodeJS.ProcessEnv = process.env): Promise<ModelAvailability> {
  const anthropic = Boolean(env.ANTHROPIC_API_KEY);
  const pref = cfg.modelClient;
  if (pref === 'none') return { client: null, bedrock: false, anthropic, reason: 'FLEET_MODEL_CLIENT=none' };
  const bedrock = pref === 'anthropic' ? false : await awsCredentialsAvailable();
  if ((pref === 'auto' || pref === 'bedrock') && bedrock) {
    return { client: new BedrockConverseClient(cfg.bedrockModelId, cfg.awsRegion), bedrock, anthropic, reason: `bedrock ${cfg.bedrockModelId} in ${cfg.awsRegion}` };
  }
  if ((pref === 'auto' || pref === 'anthropic') && anthropic) {
    return { client: new AnthropicClient(cfg.anthropicModel), bedrock, anthropic, reason: `anthropic ${cfg.anthropicModel}` };
  }
  if (pref === 'auto' && env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5';
    return { client: new OpenRouterClient(model, env.OPENROUTER_API_KEY), bedrock, anthropic, reason: `openrouter ${model}` };
  }
  return { client: null, bedrock, anthropic, reason: 'no model credentials (AWS chain, ANTHROPIC_API_KEY or OPENROUTER_API_KEY); tasks run scripted' };
}
export type { ModelClient } from './types.js';
