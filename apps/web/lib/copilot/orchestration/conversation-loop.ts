import 'server-only'

/**
 * Build Phase 11, Wave 3 — the shared, provider-agnostic tool-use loop.
 *
 * Both `anthropic-copilot-provider.ts` (real Anthropic API calls) and
 * `copilot-test-provider.ts` (wave 5's deterministic, offline test double)
 * implement `ModelCaller` — "make ONE model call, given the system prompt,
 * the message history so far, and the tool definitions on offer" — and
 * plug it into `runCopilotToolLoop` below. This means the actual
 * tool-calling MECHANICS (iterate until the model calls the reserved
 * `submit_copilot_response` tool, feed every other tool call through the
 * caller's `executeTool`, enforce the hard iteration cap, honor
 * cancellation) are implemented and tested exactly ONCE, and a wave 5 test
 * built on the deterministic provider is exercising this exact same loop
 * code a live Anthropic call would run through — never a parallel,
 * divergent re-implementation.
 *
 * WHY A HARD ITERATION CAP (governing brief: cost risk + safety risk): an
 * agentic tool-use loop with no cap can in principle keep calling tools
 * forever (a confused or adversarially-steered model looping on the same
 * tool, or chaining through all 13 tools repeatedly) — each iteration is a
 * full model call, so an unbounded loop is both an unbounded cost and an
 * unbounded amount of tool-executed database reads per user turn. 8 is
 * chosen as the cap: comfortably more than any of the 13 tools' realistic
 * legitimate combinations for a single recruiter question (in practice 1-3
 * tool calls resolve almost every real question this copilot answers), but
 * small enough that a runaway loop costs at most ~8 model calls before this
 * code forcibly stops it, never an unbounded amount.
 */

export const COPILOT_MAX_TOOL_ITERATIONS = 8

/** The reserved, non-domain tool every model call is always offered alongside whatever domain tools the role/conversation allows. Calling this tool is the ONLY way a turn produces a final answer — a model that stops calling tools but never calls this one is treated as `iteration_budget_exceeded` once the cap is hit, never silently accepted as "done" from free-form `end_turn` text. Forcing the final answer through a structured tool call (rather than trusting free prose) is what makes `run-copilot-turn.ts`'s citation-grounding check possible at all: the model must self-report `claims`/citations in a fixed shape, exactly like Phase 9's `submit_outreach_draft` tool forces `personalizationEvidence`. This name is deliberately NOT one of `TOOL_REGISTRY`'s 13 entries and is never written to `copilot_tool_calls` (whose `tool_name` CHECK constraint would reject it) — it is a provider-protocol control tool, not a copilot capability. */
export const SUBMIT_RESPONSE_TOOL_NAME = 'submit_copilot_response'

export type CopilotProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }

export interface CopilotProviderMessage {
  role: 'user' | 'assistant'
  content: CopilotProviderContentBlock[]
}

export interface CopilotProviderToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class CopilotProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'provider_error' | 'not_configured',
  ) {
    super(message)
    this.name = 'CopilotProviderError'
  }
}

export interface ModelCallResult {
  model: string
  contentBlocks: CopilotProviderContentBlock[]
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'other'
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}

/** Makes exactly ONE model call (one loop iteration). Throws `CopilotProviderError` on failure — never returns a partial/invalid result silently. */
export type ModelCaller = (params: {
  systemPrompt: string
  messages: CopilotProviderMessage[]
  tools: CopilotProviderToolDefinition[]
}) => Promise<ModelCallResult>

/** One domain tool call the loop asked `executeTool` to run, and what came back — used by `run-copilot-turn.ts` only for logging/telemetry; the actual DB persistence happens INSIDE `executeTool` itself, synchronously, before this array entry is even appended (see this file's cancellation note below). */
export interface ExecutedToolCallRecord {
  name: string
  input: unknown
  resultContent: string
  isError: boolean
}

export interface CopilotToolExecutionResult {
  /** Fed back to the model as this tool_use's tool_result content — always framed as untrusted DATA by the caller, never as instructions (see run-copilot-turn.ts's executeTool implementation). */
  content: string
  isError: boolean
  /** Set only when this specific call must abort the ENTIRE turn rather than be fed back as a recoverable error (currently: a role-level unauthorized-tool attempt — see run-copilot-turn.ts's fail-closed policy). Absent (undefined) for every ordinary recoverable error (bad input, resource not owned, output failed its schema). */
  terminal?: { reason: 'unauthorized_tool_attempt' }
}

/** Runs the caller's already-authorized, already-persisted tool execution for one `tool_use` block. Called once per tool_use the model emits, in order. Never trusted to have "already checked authorization" by this loop — the loop calls this for every tool_use it sees, including one naming a tool NOT in the `tools` list this iteration offered (a hallucinating or adversarially-steered model can still emit an arbitrary tool name; this loop does not filter tool_use blocks against the offered `tools` list itself — that is `executeTool`'s job, exactly the "never trust anything the model claims" rule the governing brief states for tool-registry.ts). */
export type CopilotToolExecutor = (
  toolName: string,
  input: unknown,
) => Promise<CopilotToolExecutionResult>

export interface CopilotConversationLoopResult {
  status: 'final' | 'iteration_budget_exceeded' | 'terminal_denied' | 'cancelled'
  model: string | null
  /** The raw (not yet Zod-validated) input the model passed to `submit_copilot_response`, only when status === 'final'. */
  finalRaw: unknown
  toolCallsExecuted: ExecutedToolCallRecord[]
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  iterations: number
  terminalReason?: 'unauthorized_tool_attempt'
}

const SUBMIT_RESPONSE_TOOL: CopilotProviderToolDefinition = {
  name: SUBMIT_RESPONSE_TOOL_NAME,
  description:
    'Submit your final answer to the recruiter for this turn. This is the ONLY way to end the turn — you must call this tool exactly once you are ready to answer, even for a purely conversational reply. Every specific factual claim about a candidate, job, scorecard, evidence, shortlist, or POC result MUST have a matching entry in `claims`, each citing one authorized record id returned by a tool call THIS turn. Never invent a citation. A reply with no factual claims (e.g. a purely procedural or clarifying answer) may submit an empty `claims` array.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The final answer text shown to the recruiter.' },
      claims: {
        type: 'array',
        description:
          'One entry per factual claim made in `text` about a candidate/job/evidence/shortlist/POC record.',
        items: {
          type: 'object',
          properties: {
            claimText: { type: 'string' },
            citation: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                id: { type: 'string' },
                excerpt: { type: ['string', 'null'] },
              },
              required: ['kind', 'id', 'excerpt'],
            },
          },
          required: ['claimText', 'citation'],
        },
      },
    },
    required: ['text', 'claims'],
  },
}

/**
 * Factory rather than a bare function so `callModel` is bound once (each
 * provider constructs its own runner from its own `ModelCaller`) instead of
 * threaded through every call site — `AnthropicCopilotProvider` and
 * `TestCopilotProvider` each expose `runConversationTurn` as a thin call
 * into the runner this returns.
 */
export function createCopilotToolLoopRunner(callModel: ModelCaller) {
  return async function run(params: {
    systemPrompt: string
    priorMessages: CopilotProviderMessage[]
    userMessage: string
    tools: CopilotProviderToolDefinition[]
    executeTool: CopilotToolExecutor
    maxToolIterations?: number
    signal?: AbortSignal
  }): Promise<CopilotConversationLoopResult> {
    const maxIterations = params.maxToolIterations ?? COPILOT_MAX_TOOL_ITERATIONS
    const offeredTools = [...params.tools, SUBMIT_RESPONSE_TOOL]

    const messages: CopilotProviderMessage[] = [
      ...params.priorMessages,
      { role: 'user', content: [{ type: 'text', text: params.userMessage }] },
    ]

    let inputTokens = 0
    let outputTokens = 0
    let costUsd: number | null = null
    let lastModel: string | null = null
    const toolCallsExecuted: ExecutedToolCallRecord[] = []

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      if (params.signal?.aborted) {
        return {
          status: 'cancelled',
          model: lastModel,
          finalRaw: null,
          toolCallsExecuted,
          inputTokens,
          outputTokens,
          costUsd,
          iterations: iteration - 1,
        }
      }

      const call = await callModel({
        systemPrompt: params.systemPrompt,
        messages,
        tools: offeredTools,
      })
      lastModel = call.model
      inputTokens += call.inputTokens ?? 0
      outputTokens += call.outputTokens ?? 0
      if (call.costUsd !== null) costUsd = (costUsd ?? 0) + call.costUsd

      const toolUseBlocks = call.contentBlocks.filter(
        (block): block is Extract<CopilotProviderContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use',
      )

      const submitCall = toolUseBlocks.find((block) => block.name === SUBMIT_RESPONSE_TOOL_NAME)
      if (submitCall) {
        return {
          status: 'final',
          model: lastModel,
          finalRaw: submitCall.input,
          toolCallsExecuted,
          inputTokens,
          outputTokens,
          costUsd,
          iterations: iteration,
        }
      }

      if (toolUseBlocks.length === 0) {
        // The model produced only text and never called submit_copilot_response
        // — never accepted as a final answer (see this module's header note).
        // Push what it said back as an assistant turn and nudge it to finalize.
        messages.push({ role: 'assistant', content: call.contentBlocks })
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'You must call submit_copilot_response to finish your turn — plain text alone is never accepted as a final answer.',
            },
          ],
        })
        continue
      }

      messages.push({ role: 'assistant', content: call.contentBlocks })

      const toolResultBlocks: CopilotProviderContentBlock[] = []
      for (const toolUse of toolUseBlocks) {
        if (params.signal?.aborted) {
          return {
            status: 'cancelled',
            model: lastModel,
            finalRaw: null,
            toolCallsExecuted,
            inputTokens,
            outputTokens,
            costUsd,
            iterations: iteration,
          }
        }

        const result = await params.executeTool(toolUse.name, toolUse.input)
        toolCallsExecuted.push({
          name: toolUse.name,
          input: toolUse.input,
          resultContent: result.content,
          isError: result.isError,
        })
        toolResultBlocks.push({
          type: 'tool_result',
          toolUseId: toolUse.id,
          content: result.content,
          isError: result.isError,
        })

        if (result.terminal) {
          return {
            status: 'terminal_denied',
            model: lastModel,
            finalRaw: null,
            toolCallsExecuted,
            inputTokens,
            outputTokens,
            costUsd,
            iterations: iteration,
            terminalReason: result.terminal.reason,
          }
        }
      }

      messages.push({ role: 'user', content: toolResultBlocks })
    }

    return {
      status: 'iteration_budget_exceeded',
      model: lastModel,
      finalRaw: null,
      toolCallsExecuted,
      inputTokens,
      outputTokens,
      costUsd,
      iterations: maxIterations,
    }
  }
}
