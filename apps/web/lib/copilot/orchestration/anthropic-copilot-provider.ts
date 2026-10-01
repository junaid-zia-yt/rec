import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env, anthropicConfigured } from '@/lib/env'
import {
  CopilotProviderError,
  createCopilotToolLoopRunner,
  type CopilotConversationLoopResult,
  type CopilotProviderContentBlock,
  type CopilotProviderMessage,
  type CopilotProviderToolDefinition,
  type CopilotToolExecutor,
  type ModelCallResult,
} from './conversation-loop'

/**
 * Build Phase 11, Wave 3 — the real, Anthropic-backed copilot conversation
 * provider. Mirrors `anthropic-outreach-draft-provider.ts`'s exact SDK usage
 * pattern (model selection, timeout, error mapping) — extended here to a
 * MULTI-TURN, tool-calling loop rather than that file's single forced-tool
 * call, via `createCopilotToolLoopRunner` (conversation-loop.ts), which owns
 * the actual iterate-until-`submit_copilot_response` mechanics shared with
 * `copilot-test-provider.ts`.
 *
 * No `ANTHROPIC_API_KEY` is configured in this environment (checked:
 * `anthropicConfigured` is false here) — this class has never been
 * exercised against the real API in this repo. Its behavior is verified
 * instead via `copilot-test-provider.ts` and `run-copilot-turn.test.ts`,
 * exactly like every other AI workflow in this codebase.
 */

const COPILOT_MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 60_000

function toAnthropicTool(tool: CopilotProviderToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }
}

function toAnthropicMessages(messages: CopilotProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((block): Anthropic.ContentBlockParam => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'tool_use')
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      }
    }),
  }))
}

function fromAnthropicContent(content: Anthropic.ContentBlock[]): CopilotProviderContentBlock[] {
  const blocks: CopilotProviderContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') blocks.push({ type: 'text', text: block.text })
    else if (block.type === 'tool_use')
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    // Other Anthropic content block types (thinking, redacted_thinking, etc.)
    // carry no information this loop acts on — silently omitted, never
    // treated as an error.
  }
  return blocks
}

export class AnthropicCopilotProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic
  private readonly runLoop: ReturnType<typeof createCopilotToolLoopRunner>

  constructor() {
    if (!anthropicConfigured) {
      throw new CopilotProviderError('Anthropic API key is not configured', 'not_configured')
    }
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS })
    this.runLoop = createCopilotToolLoopRunner(
      async ({ systemPrompt, messages, tools }): Promise<ModelCallResult> => {
        try {
          const response = await this.client.messages.create({
            model: COPILOT_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: systemPrompt,
            messages: toAnthropicMessages(messages),
            tools: tools.map(toAnthropicTool),
            tool_choice: { type: 'auto' },
          })

          const stopReason: ModelCallResult['stopReason'] =
            response.stop_reason === 'tool_use'
              ? 'tool_use'
              : response.stop_reason === 'end_turn'
                ? 'end_turn'
                : response.stop_reason === 'max_tokens'
                  ? 'max_tokens'
                  : 'other'

          return {
            model: response.model,
            contentBlocks: fromAnthropicContent(response.content),
            stopReason,
            inputTokens: response.usage?.input_tokens ?? null,
            outputTokens: response.usage?.output_tokens ?? null,
            costUsd: null,
          }
        } catch (error) {
          if (error instanceof Anthropic.APIConnectionTimeoutError) {
            throw new CopilotProviderError('The AI copilot request timed out', 'timeout')
          }
          if (error instanceof Anthropic.APIConnectionError) {
            throw new CopilotProviderError('Could not reach the AI provider', 'network')
          }
          // Never surface the raw provider exception message — it could echo
          // candidate-evidence/job-description content back (same rule as
          // the matching/outreach providers).
          throw new CopilotProviderError('The AI provider returned an error', 'provider_error')
        }
      },
    )
  }

  async runConversationTurn(params: {
    systemPrompt: string
    priorMessages: CopilotProviderMessage[]
    userMessage: string
    tools: CopilotProviderToolDefinition[]
    executeTool: CopilotToolExecutor
    maxToolIterations?: number
    signal?: AbortSignal
  }): Promise<CopilotConversationLoopResult> {
    return this.runLoop(params)
  }
}

/** Construct the real provider only when configured; throws CopilotProviderError('not_configured') otherwise — same convention as createAnthropicOutreachDraftProvider / createAnthropicMatchingProvider. */
export function createAnthropicCopilotProvider(): AnthropicCopilotProvider {
  return new AnthropicCopilotProvider()
}
