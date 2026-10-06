import Anthropic from '@anthropic-ai/sdk';
import type { ToolDef } from '../tools.js';
import type { Conversation, ModelClient, ModelTurn, ToolResult, UserPart } from './types.js';

type Block = Anthropic.Beta.BetaContentBlockParam;
const img = (jpeg: Buffer): Anthropic.Beta.BetaImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
});
const toBlocks = (parts: UserPart[]): Block[] => parts.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : img(p.jpeg)));

/**
 * Claude through the Anthropic API. Sonnet 5.5: no sampling params, no forced tool_choice, thinking stays adaptive
 * (default), effort set explicitly. Server-side refusal fallback is on by default (ANTHROPIC_FALLBACKS=off to disable).
 */
export class AnthropicClient implements ModelClient {
  readonly kind = 'anthropic' as const;
  private client = new Anthropic();
  constructor(
    readonly model: string,
    private maxTokens = 16000,
    private fallbacks = process.env.ANTHROPIC_FALLBACKS !== 'off',
  ) {}

  start(system: string, tools: ToolDef[]): Conversation {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    const toolParams: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const call = async (): Promise<ModelTurn> => {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        tools: toolParams,
        messages,
        output_config: { effort: 'medium' },
        ...(this.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      // Append the full content unchanged (thinking blocks are bound to this conversation).
      messages.push({ role: 'assistant', content: res.content as Block[] });
      const raw = res.stop_reason ?? 'unknown';
      return {
        text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
        toolCalls: res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [])),
        stop:
          raw === 'tool_use' ? 'tool_use'
          : raw === 'end_turn' || raw === 'stop_sequence' ? 'end_turn'
          : raw === 'max_tokens' || raw === 'model_context_window_exceeded' ? 'max_tokens'
          : raw === 'refusal' ? 'refusal'
          : 'other',
        raw,
        usage: { inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens },
      };
    };
    return {
      send: async (parts) => {
        messages.push({ role: 'user', content: toBlocks(parts) });
        return call();
      },
      sendToolResults: async (results: ToolResult[], extra: UserPart[] = []) => {
        const blocks: Block[] = results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          is_error: r.isError,
          content: r.content.map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : img(c.jpeg))),
        }));
        messages.push({ role: 'user', content: [...blocks, ...toBlocks(extra)] });
        return call();
      },
    };
  }
}
