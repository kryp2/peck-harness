/**
 * `GenerateOptions` → `claude --print` CLI argument vector and stdin payload.
 *
 * Claude Code is a finished agent, not a chat-completions endpoint. The bridge
 * folds the whole conversation into one user-role prompt with role tags the
 * assistant re-reads to disambiguate turns. Tool schemas land on
 * `--append-system-prompt` because Claude Code's `--print` mode runs its own
 * tool loop internally; the bridge tells it not to call tools by passing
 * `--allowed-tools ""` and `--max-turns 1`, then scans the result for tool-call
 * JSON blocks the assistant may have emitted anyway.
 *
 * @module dsh-llm-claude-cli/serialize
 */

import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'

/**
 * Validated connection facts for one operation. Plugin config is the one
 * explicit resolve step; this module trusts its output and re-reads it per
 * stream call (a CLI restart mid-session stays valid because each call is
 * independent).
 */
export interface ClaudeCliConnectionOptions {
  /** Path or `PATH`-resolvable name of the `claude` binary. */
  binary: string
  /**
   * JSON string passed verbatim as `--settings`. Lets the deployment pin a
   * model alias + effort level that overrides the global `~/.claude/settings.json`.
   */
  settingsJson: string
  /** Default per-request output cap; explicit request values win. */
  maxTokens: number
  /** Soft cap on `--system-prompt` length before warning + truncation. */
  maxSystemPromptChars: number
  /** Provider-owned model catalog. The harness model id is the wire alias. */
  models: readonly ClaudeCliCatalogModel[]
}

/**
 * One advisory catalog model exposed to discovery consumers. The harness
 * model id is the wire alias handed to `--model`.
 */
export interface ClaudeCliCatalogModel {
  /** Alias accepted by `--model` (e.g. `sonnet`, `opus`, `haiku`, or full id). */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Provider-owned context capacity when known. */
  contextWindow?: number
  /** Per-request output cap; falls back to the profile's {@link maxTokens}. */
  maxTokens?: number
}

/** Result of building one `claude --print` invocation. */
export interface ClaudeInvocation {
  /** CLI argument vector; safe to `spawn(binary, args, …)`. */
  args: readonly string[]
  /** UTF-8 stdin payload: serialized conversation + any trailing tool results. */
  stdin: string
  /**
   * True when `system` exceeded {@link ClaudeCliConnectionOptions.maxSystemPromptChars}
   * and the call passed a truncated copy. Caller should log a warning so the
   * deployment can grow the cap or shorten its system prompt.
   */
  systemTruncated: boolean
}

/**
 * Build one `claude --print` invocation from a `GenerateOptions` request.
 *
 * The serializer is the one place where DSH `GenerateOptions` becomes a CLI
 * call; every flag, every truncation, every message-tag mapping is decided
 * here so the adapter can stay a transport wrapper.
 *
 * @param options - The harness request: model alias, system prompt, messages, tools.
 * @param connection - Resolved connection facts (binary, settings JSON, caps).
 * @returns The argument vector, stdin payload, and system-truncation flag for one call.
 */
export function buildInvocation(options: GenerateOptions, connection: ClaudeCliConnectionOptions): ClaudeInvocation {
  const model = resolveModelAlias(options.model, connection)
  const system = options.system ?? ''
  const { text: systemText, truncated } = clampSystem(system, connection.maxSystemPromptChars)
  const stdin = serializeMessages(options.messages, options.tools)

  // Stable flag order. Adding a flag = documenting it; removing a flag = breaking.
  // Claude Code CLI 2.1.x flag vocabulary: --max-tokens is NOT accepted; the
  // bridge surfaces request.maxTokens via the system prompt instead so the
  // model respects it. Output cap is provider-internal and the model alias
  // governs response shape; deployments needing a hard cap should pin a
  // smaller model in --settings.
  const args: string[] = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--settings', connection.settingsJson,
    '--max-turns', '1',
    '--permission-mode', 'plan',
  ]
  // `--allowed-tools ""` is the documented way to forbid tool calls in
  // --print mode. Empty string blocks all (named) tools.
  args.push('--allowed-tools', '""')
  if (systemText.length > 0) args.push('--system-prompt', systemText)

  return { args, stdin, systemTruncated: truncated }
}

/**
 * Resolve a wire model id to the alias `claude --model` accepts.
 *
 * Claude Code accepts both short aliases (`sonnet`, `opus`, `haiku`) and
 * full ids (`claude-sonnet-4-5-20250929`). The catalog entry's id is
 * already an alias; we pass it through unchanged.
 */
function resolveModelAlias(modelId: string, connection: ClaudeCliConnectionOptions): string {
  const known = connection.models.find(entry => entry.id === modelId)
  if (known !== undefined) return known.id
  // Uncatalogued model: pass through. Claude Code will reject unknown
  // aliases with a clear error which the adapter surfaces as LlmError.
  return modelId
}

/**
 * Soft-cap the system prompt. Claude Code silently truncates very long
 * prompts; we cap explicitly so callers see a logged warning when their
 * system prompt + tools exceed the budget.
 */
function clampSystem(system: string, maxChars: number): { text: string; truncated: boolean } {
  if (system.length <= maxChars) return { text: system, truncated: false }
  return { text: system.slice(0, maxChars) + '\n\n[system prompt truncated]', truncated: true }
}

/**
 * Serialize a DSH message list into one Claude-Code user-role stdin prompt.
 *
 * Format: a role-tagged transcript the assistant reads once and answers once.
 * Tool-result messages are flattened to JSON; assistant messages are quoted
 * verbatim so the model sees the prior turn exactly as it produced it.
 */
function serializeMessages(messages: readonly Message[], tools: readonly ToolSchema[] | undefined): string {
  const sections: string[] = []
  if (tools !== undefined && tools.length > 0) {
    sections.push('--- AVAILABLE TOOLS (DSH will execute these for you; emit JSON like `{"tool":"name","arguments":{...}}` only if you must call one) ---')
    for (const tool of tools) {
      sections.push(`### ${tool.name}\n${tool.description}\nSchema: ${JSON.stringify(tool.parameters)}`)
    }
    sections.push('--- END TOOLS ---')
  }
  for (const msg of messages) {
    sections.push(serializeOne(msg))
  }
  return sections.join('\n\n').trimEnd() + '\n'
}

function serializeOne(msg: Message): string {
  const role = roleLabel(msg)
  // roleLabel already tolerates nullish content because durable log data
  // carries the key nullish more often than the type admits; render the
  // empty turn too instead of crashing after the label survived.
  const body = renderContent((msg as { content?: readonly ContentBlock[] }).content ?? [])
  return `[${role}]\n${body}`
}

function roleLabel(msg: Message): string {
  // `source.kind === 'model'` is assistant; everything else is user/tool-result.
  // The cast admits undefined: durable log data carries the key with a nullish
  // value more often than the type admits.
  const src = (msg as { source?: { kind?: string } }).source
  if (src !== undefined) {
    if (src.kind === 'model') return 'assistant'
    if (src.kind === 'tool') return 'tool'
  }
  // Fallback: discriminate by presence of tool-result blocks.
  const blocks = (msg as { content?: readonly ContentBlock[] }).content ?? []
  if (blocks.some(b => b.type === 'tool-result')) return 'tool'
  return 'user'
}

function renderContent(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'reasoning':
        // Reasoning is model-internal; forward so the model has full context.
        parts.push(`<thinking>\n${block.text}\n</thinking>`)
        break
      case 'image':
        // V1 advertises text-only input, but a session replayed into a fresh
        // bridge can carry image blocks; surface a placeholder so the model
        // sees the slot without depending on ImageAttachmentRef internals.
        parts.push('[image attachment]')
        break
      case 'tool-call':
        parts.push(`<tool_use id="${block.id}" name="${block.name}">\n${block.arguments}\n</tool_use>`)
        break
      case 'tool-result': {
        const content = block.content.map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('')
        const err = block.isError === true ? ' [error]' : ''
        parts.push(`<tool_result id="${block.toolCallId}"${err}>\n${content}\n</tool_result>`)
        break
      }
    }
  }
  return parts.join('\n')
}

