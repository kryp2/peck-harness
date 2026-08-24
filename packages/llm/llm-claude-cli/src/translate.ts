/**
 * `claude --print --output-format json` stdout → DSH `StreamChunk` stream.
 *
 * Claude Code emits a single JSON document per `--print` call. The bridge
 * emits one `text-delta` block carrying the model's text, an optional
 * `tool-call-delta` block per tool call the assistant emitted as JSON, a
 * `usage` chunk carrying token counts + cost, and a terminal `finish`.
 *
 * Tool-call detection is opportunistic: the serializer asks Claude Code not
 * to call tools, but the assistant may still emit them. We scan the text for
 * fenced JSON blocks matching a known tool schema and surface them as
 * `tool-call` blocks so DSH's tool loop can execute them.
 *
 * @module dsh-llm-claude-cli/translate
 */

import { CallId, type FinishReason, type StreamChunk, type TokenUsage, type ToolSchema } from '@deepseek-ai/dsh-llm'

/** Subset of the Claude-Code stdout payload the bridge reads. */
export interface ClaudeStdout {
  type: 'result'
  is_error: boolean
  result: string
  /** Claude Code stop reason; known values include `end_turn`, `max_tokens`, and `tool_use`. */
  stop_reason: string
  total_cost_usd: number
  duration_ms: number
  session_id: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    output_tokens_details?: { thinking_tokens?: number }
  }
}

/** Result of translating one Claude stdout payload. */
export interface Translation {
  /** Ordered `StreamChunk`s the adapter yields. */
  chunks: readonly StreamChunk[]
  /**
   * Cost in USD, for caller-side logging. Anthropic's local OAuth does not
   * surface cost on the wire; this comes straight from Claude Code.
   */
  costUsd: number
  /** Session id Claude Code assigned; logged for diagnostics. */
  sessionId: string
  /** Adapter-private envelope to carry in the terminal chunk's `replayState`. */
  replayState: unknown
}

/**
 * Translate one Claude stdout payload into a DSH stream. The translator is
 * pure: given a payload + the tool catalog the request declared, it returns
 * a fixed set of chunks. The adapter drives `stream()` over them.
 *
 * @param stdout - Parsed `claude --print` JSON result document.
 * @param tools - Tool schemas the request declared, used to recognize fenced-JSON tool calls; `undefined` when none.
 * @returns The chunk sequence and usage/cost facts for one response.
 */
export function translate(stdout: ClaudeStdout, tools: readonly ToolSchema[] | undefined): Translation {
  const chunks: StreamChunk[] = []
  let blockIndex = 0

  if (stdout.is_error) {
    chunks.push(finishChunk({ kind: 'error', failure: { message: stdout.result, code: 'CLAUDE_CLI_ERROR' } }))
    return { chunks, costUsd: stdout.total_cost_usd, sessionId: stdout.session_id, replayState: stdout }
  }

  // 1. Emit the assistant text as one text block (--print mode yields the
  //    whole answer as one string, no streaming tokens to split).
  chunks.push({ type: 'block-start', index: blockIndex, blockType: 'text' })
  chunks.push({ type: 'text-delta', index: blockIndex, text: stdout.result })
  chunks.push({ type: 'block-end', index: blockIndex, block: { type: 'text', text: stdout.result } })
  blockIndex++

  // 2. Scan for tool calls Claude emitted as JSON blocks even though
  //    --allowed-tools "" told it not to. Best-effort: only matches when
  //    the JSON parses AND its `tool` field names a known schema.
  const toolCalls = detectToolCalls(stdout.result, tools)
  for (const call of toolCalls) {
    chunks.push({ type: 'block-start', index: blockIndex, blockType: 'tool-call' })
    chunks.push({ type: 'tool-call-delta', index: blockIndex, id: call.id, name: call.name, argumentsDelta: call.argumentsJson })
    chunks.push({ type: 'block-end', index: blockIndex, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.argumentsJson } })
    blockIndex++
  }

  // 3. Usage comes before finish per the harness contract.
  const usage: TokenUsage = {
    inputTokens: stdout.usage.input_tokens,
    outputTokens: stdout.usage.output_tokens,
    ...stdout.usage.cache_read_input_tokens !== undefined ? { cacheReadTokens: stdout.usage.cache_read_input_tokens } : {},
    ...stdout.usage.cache_creation_input_tokens !== undefined ? { cacheWriteTokens: stdout.usage.cache_creation_input_tokens } : {},
    ...stdout.usage.output_tokens_details?.thinking_tokens !== undefined
      ? { reasoningTokens: stdout.usage.output_tokens_details.thinking_tokens }
      : {},
  }
  chunks.push({ type: 'usage', usage })

  // 4. Finish. tool-calls finish if any matched; otherwise stop/max_tokens.
  const finishReason: FinishReason = toolCalls.length > 0
    ? { kind: 'tool-calls' }
    : stdout.stop_reason === 'max_tokens'
      ? { kind: 'max-tokens' }
      : { kind: 'stop' }
  chunks.push(finishChunk(finishReason, stdout))

  return { chunks, costUsd: stdout.total_cost_usd, sessionId: stdout.session_id, replayState: stdout }
}

function finishChunk(reason: FinishReason, replayState?: unknown): StreamChunk {
  return {
    type: 'finish',
    reason,
    ...replayState === undefined ? {} : { replayState: { response: replayState } },
  }
}

/** One detected tool call inside the assistant text. */
interface DetectedToolCall {
  id: CallId
  name: string
  argumentsJson: string
}

/**
 * Find tool-call JSON blocks the assistant may have emitted. Only matches
 * when the JSON parses, has a `tool` field naming a known schema, and is
 * enclosed in ``` fences (so we don't false-positive on prose).
 *
 * V1 limitation: matches are text-anchored, not semantic. A Claude that
 * explains a tool call in prose without fencing it is missed. V2 can use
 * `--output-format stream-json` for structured events.
 */
function detectToolCalls(text: string, tools: readonly ToolSchema[] | undefined): readonly DetectedToolCall[] {
  if (tools === undefined || tools.length === 0) return []
  const knownNames = new Set(tools.map(t => t.name))
  const fenceRe = /```(?:json)?\s*([\s\S]+?)```/g
  const matches: DetectedToolCall[] = []
  let counter = 0
  for (const match of text.matchAll(fenceRe)) {
    const body = match[1]?.trim()
    /* v8 ignore next -- fenceRe's capture group always participates in a successful match, so match[1] is never undefined at runtime;
     * the guard only satisfies noUncheckedIndexedAccess typing. */
    if (body === undefined) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const obj = parsed as Record<string, unknown>
    const name = typeof obj.tool === 'string' ? obj.tool : undefined
    if (name === undefined || !knownNames.has(name)) continue
    const args = obj.arguments
    const argsJson = args === undefined ? '{}' : JSON.stringify(args)
    counter++
    matches.push({ id: CallId(`claude-cli-${counter}`), name, argumentsJson: argsJson })
  }
  return matches
}

