import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type { ToolDef } from '../tools.js';
import type { Conversation, ModelClient, ModelTurn, ToolResult, UserPart } from './types.js';

const toBlocks = (parts: UserPart[]): ContentBlock[] =>
  parts.map((p) => (p.type === 'text' ? { text: p.text } : { image: { format: 'jpeg', source: { bytes: new Uint8Array(p.jpeg) } } }));

/** Claude through the Bedrock Converse API (docs/research/agentcore-browser.md section 4). Default credential chain. */
export class BedrockConverseClient implements ModelClient {
  readonly kind = 'bedrock' as const;
  private client: BedrockRuntimeClient;
  constructor(
    readonly model: string,
    region: string,
    private maxTokens = 4096,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }

  start(system: string, tools: ToolDef[]): Conversation {
    const messages: Message[] = [];
    // toolChoice omitted (auto): the 5.5 generation rejects forced tool choice.
    const toolConfig = {
      tools: tools.map((t): Tool => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } } })),
    };
    const call = async (): Promise<ModelTurn> => {
      const res = await this.client.send(
        new ConverseCommand({ modelId: this.model, system: [{ text: system }], messages, toolConfig, inferenceConfig: { maxTokens: this.maxTokens } }),
      );
      const content = res.output?.message?.content ?? [];
      // Push the whole assistant content unchanged (reasoningContent blocks must be echoed back).
      messages.push({ role: 'assistant', content });
      const raw = res.stopReason ?? 'unknown';
      return {
        text: content.map((b) => ('text' in b && b.text ? b.text : '')).join(''),
        toolCalls: content.flatMap((b) =>
          b.toolUse ? [{ id: b.toolUse.toolUseId ?? '', name: b.toolUse.name ?? '', input: (b.toolUse.input ?? {}) as Record<string, unknown> }] : [],
        ),
        stop:
          raw === 'tool_use' ? 'tool_use'
          : raw === 'end_turn' || raw === 'stop_sequence' ? 'end_turn'
          : raw === 'max_tokens' || raw === 'model_context_window_exceeded' ? 'max_tokens'
          : raw === 'guardrail_intervened' || raw === 'content_filtered' ? 'refusal'
          : raw === 'malformed_model_output' || raw === 'malformed_tool_use' ? 'malformed'
          : 'other',
        raw,
        usage: { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 },
      };
    };
    return {
      send: async (parts) => {
        messages.push({ role: 'user', content: toBlocks(parts) });
        return call();
      },
      sendToolResults: async (results: ToolResult[], extra: UserPart[] = []) => {
        const blocks: ContentBlock[] = results.map((r) => ({
          toolResult: {
            toolUseId: r.id,
            status: r.isError ? 'error' : 'success',
            content: r.content.map(
              (c): ToolResultContentBlock => (c.type === 'text' ? { text: c.text } : { image: { format: 'jpeg', source: { bytes: new Uint8Array(c.jpeg) } } }),
            ),
          },
        }));
        messages.push({ role: 'user', content: [...blocks, ...toBlocks(extra)] });
        return call();
      },
    };
  }
}
