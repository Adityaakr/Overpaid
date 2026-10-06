import type { ToolDef } from '../tools.js';
import type { Conversation, ModelClient, ModelTurn, ToolResult, UserPart } from './types.js';

// Claude through OpenRouter's OpenAI-compatible chat API.
const URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';

type Msg =
  | { role: 'system' | 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; tool_calls?: Call[] }
  | { role: 'tool'; tool_call_id: string; content: string };
type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };

const toParts = (parts: UserPart[]): Part[] =>
  parts.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.jpeg.toString('base64')}` } }));

export class OpenRouterClient implements ModelClient {
  readonly kind = 'openrouter' as const;
  constructor(
    readonly model: string,
    private apiKey: string,
    private maxTokens = 8000,
  ) {}

  start(system: string, tools: ToolDef[]): Conversation {
    const messages: Msg[] = [{ role: 'system', content: system }];
    const toolParams = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const call = async (): Promise<ModelTurn> => {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'x-title': 'Overpaid fleet',
        },
        body: JSON.stringify({ model: this.model, max_tokens: this.maxTokens, messages, tools: toolParams }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await res.json()) as any;
      if (!res.ok || body.error) throw new Error(`openrouter ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
      const choice = body.choices?.[0];
      const msg = choice?.message ?? {};
      const calls: Call[] = msg.tool_calls ?? [];
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      const raw = String(choice?.finish_reason ?? 'unknown');
      const toolCalls = calls.flatMap((c) => {
        try {
          return [{ id: c.id, name: c.function.name, input: (c.function.arguments ? JSON.parse(c.function.arguments) : {}) as Record<string, unknown> }];
        } catch {
          return [];
        }
      });
      return {
        text: typeof msg.content === 'string' ? msg.content : '',
        toolCalls,
        stop:
          calls.length && toolCalls.length < calls.length ? 'malformed'
          : raw === 'tool_calls' || toolCalls.length ? 'tool_use'
          : raw === 'stop' ? 'end_turn'
          : raw === 'length' ? 'max_tokens'
          : raw === 'content_filter' ? 'refusal'
          : 'other',
        raw,
        usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      };
    };
    return {
      send: async (parts) => {
        messages.push({ role: 'user', content: toParts(parts) });
        return call();
      },
      sendToolResults: async (results: ToolResult[], extra: UserPart[] = []) => {
        const images: UserPart[] = [];
        for (const r of results) {
          const text = r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
          for (const c of r.content) if (c.type === 'image') images.push({ type: 'image', jpeg: c.jpeg });
          messages.push({ role: 'tool', tool_call_id: r.id, content: `${r.isError ? 'ERROR: ' : ''}${text || '(see image)'}` });
        }
        // Tool messages are text only here, so screenshots follow in one user message.
        const follow = [...images, ...extra];
        if (follow.length) messages.push({ role: 'user', content: toParts(follow) });
        return call();
      },
    };
  }
}
