import type { ToolContent, ToolDef } from '../tools.js';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  /** Normalised stop reason; `raw` keeps the provider value. */
  stop: 'tool_use' | 'end_turn' | 'max_tokens' | 'refusal' | 'malformed' | 'other';
  raw: string;
  usage: { inputTokens: number; outputTokens: number };
}
export interface ToolResult {
  id: string;
  content: ToolContent[];
  isError: boolean;
}
export type UserPart = { type: 'text'; text: string } | { type: 'image'; jpeg: Buffer };

/**
 * One conversation. The client keeps the provider-native history so assistant content (including reasoning /
 * thinking blocks) is echoed back unchanged, append-only.
 */
export interface Conversation {
  send(parts: UserPart[]): Promise<ModelTurn>;
  /** All results for one assistant turn go back in ONE user message, optionally followed by extra parts. */
  sendToolResults(results: ToolResult[], extra?: UserPart[]): Promise<ModelTurn>;
}
export interface ModelClient {
  readonly kind: 'bedrock' | 'anthropic';
  readonly model: string;
  start(system: string, tools: ToolDef[]): Conversation;
}
