/**
 * `ClaudeCliAdapter` — `LlmAdapter` over the `claude --print --output-format
 * json` subprocess. The adapter is transport-only: per-call, it spawns one
 * child, ships the conversation on stdin, waits for the JSON document on
 * stdout, and translates it into harness `StreamChunk`s.
 *
 * The lifecycle is bounded by `AbortSignal`: caller abort kills the child
 * group; idle-watchdog expires the call when no stdout appears within
 * `streamIdleTimeoutMs`. Failure paths surface as `LlmError` with stable
 * codes (`AUTH`, `TIMEOUT`, `TRANSPORT`, `CLAUDE_CLI_ERROR`).
 *
 * @module dsh-llm-claude-cli/adapter
 */

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog } from '@deepseek-ai/dsh-timeout'

import { buildInvocation, type ClaudeCliCatalogModel, type ClaudeCliConnectionOptions } from './serialize.ts'
import { translate, type ClaudeStdout } from './translate.ts'

/** Defaults mirrored from {@link @deepseek-ai/dsh-llm-deepseek}. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
/** Default per-request output cap forwarded nowhere; Claude Code applies its own policy. */
export const DEFAULT_MAX_TOKENS = 32_000
/** Default idle gap between stdout bytes after which the subprocess is considered hung. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Settings JSON passed to `--settings`; pins the model alias + effort so a
 *  global `~/.claude/settings.json` (often `opus` + `xhigh`) does not hijack
 *  the route. The harness controls the alias, not the user. */
const DEFAULT_SETTINGS_JSON = '{"model":"sonnet","effortLevel":"medium"}'
const DEFAULT_MAX_SYSTEM_PROMPT_CHARS = 32_000

const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'
const TRANSPORT_CODE = 'TRANSPORT'
const AUTH_CODE = 'AUTH'
const CLAUDE_CLI_ERROR_CODE = 'CLAUDE_CLI_ERROR'

const DEFAULT_MODELS: readonly ClaudeCliCatalogModel[] = [
  { id: 'sonnet', name: 'Claude Sonnet', contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS },
  { id: 'haiku', name: 'Claude Haiku', contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS },
  { id: 'opus', name: 'Claude Opus', contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS },
]

/** Constructor options for {@link ClaudeCliAdapter}. */
export interface ClaudeCliAdapterOptions {
  /** Current validated connection facts; called once per stream. */
  options: () => ClaudeCliConnectionOptions
}

function modelInfo(provider: string, model: ClaudeCliCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    inputModalities: ['text'],
  }
}

/**
 * The Claude-CLI adapter. One instance serves every alias it was registered
 * under; the harness model name IS the wire alias.
 */
export class ClaudeCliAdapter extends LlmAdapter {
  constructor(private readonly config: ClaudeCliAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Claude (CLI)' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    // Subprocess spawn is cheap; no retry layer of our own — the harness's
    // policy applies at the call site. Return a no-retry policy that lets
    // harness retry wrap this adapter cleanly.
    return {
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: [],
      initialDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
    }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(m => modelInfo(provider, m)))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const configured = connection.models.find(m => m.id === model)
    if (configured === undefined) {
      return Promise.resolve({
        provider,
        id: model,
        name: model,
        inputModalities: ['text' as const],
        context: { contextWindow: DEFAULT_CONTEXT_WINDOW },
        defaultMaxTokens: connection.maxTokens,
      })
    }
    return Promise.resolve({
      ...modelInfo(provider, configured),
      context: { contextWindow: configured.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: configured.maxTokens ?? connection.maxTokens,
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.config.options()
    const invocation = buildInvocation(options, connection)

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, DEFAULT_STREAM_IDLE_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_CODE)
    watchdog.pulse()

    let stdoutBuf = ''
    let stderrBuf = ''
    let spawnError: Error | undefined

    const child = spawn(connection.binary, [...invocation.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Pass through the host environment unchanged. Claude Code reads its
      // own OAuth credentials from the host keychain on macOS/Linux; setting
      // CLAUDE_CODE_SIMPLE=1 here would force --bare mode which requires an
      // ANTHROPIC_API_KEY, defeating the bridge's OAuth-only design.
      env: process.env,
    })

    // Forward signal abort to child kill.
    const onAbort = (): void => {
      consumer.abort('Claude-CLI stream aborted')
      try {
        child.kill('SIGTERM')
      } catch {
        // Already exited; ignore.
      }
      // Hard-kill fallback in case Claude Code is mid-tool-call and ignores
      // SIGTERM. 5s is enough for a graceful shutdown of an in-process CLI.
      /* v8 ignore next 8 -- delay() has no AbortSignal to reject with and the SIGKILL call is contained by its inner try, so the trailing
       * rejection guard cannot execute; it stays as defense for future edits of this callback. */
      void delay(5_000).then(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      })
        .catch(() => undefined)
    }
    upstream.addEventListener('abort', onAbort, { once: true })

    const stdoutDone = new Promise<void>((resolve) => {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuf += chunk
        watchdog.pulse()
      })
      child.stdout.on('end', resolve)
      child.stdout.on('error', resolve)
    })
    const stderrDone = new Promise<void>((resolve) => {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrBuf += chunk
      })
      child.stderr.on('end', resolve)
      child.stderr.on('error', resolve)
    })
    const exitDone = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('error', (err) => {
        spawnError = err
        resolve({ code: null, signal: null })
      })
      child.on('exit', (code, signal) => { resolve({ code, signal }) })
    })

    child.stdin.end(invocation.stdin)

    await Promise.all([stdoutDone, stderrDone, exitDone])

    if (spawnError !== undefined) {
      throw new LlmError(
        `Claude CLI spawn failed for "${connection.binary}": ${spawnError.message}`,
        spawnError.message.includes('ENOENT') ? AUTH_CODE : TRANSPORT_CODE,
        { cause: spawnError },
      )
    }

    let parsed: ClaudeStdout
    try {
      parsed = JSON.parse(stdoutBuf) as ClaudeStdout
    } catch (err) {
      const hint = stderrBuf.trim().length > 0 ? `\nstderr: ${stderrBuf.trim().slice(0, 500)}` : ''
      throw new LlmError(
        `Claude CLI produced unparseable JSON${hint}`,
        classifyJsonError(stderrBuf),
        { cause: err },
      )
    }

    if ((parsed as { type?: string }).type !== 'result') {
      throw new LlmError(
        `Claude CLI returned unexpected document type "${(parsed as { type?: string }).type ?? 'missing'}"`,
        CLAUDE_CLI_ERROR_CODE,
      )
    }

    const translation = translate(parsed, options.tools)
    for (const chunk of translation.chunks) {
      yield chunk
    }
  }
}

/**
 * Classify JSON parse failure by inspecting stderr. Common cases:
 * - Auth failure surfaces as `Authentication required` / `Please run /login` etc.
 * - Missing CLI surfaces as `command not found`.
 * - Other CLI errors surface as `Error:` lines.
 */
function classifyJsonError(stderr: string): string {
  const s = stderr.toLowerCase()
  if (s.includes('authentication') || s.includes('/login') || s.includes('not authenticated') || s.includes('unauthorized')) {
    return AUTH_CODE
  }
  if (s.includes('command not found') || s.includes('enoent')) {
    return TRANSPORT_CODE
  }
  return CLAUDE_CLI_ERROR_CODE
}

/** Adapter-side defaults exposed for the plugin glue in index.ts; test hooks read the same object. */
export const __adapterDefaults = {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_SETTINGS_JSON,
  DEFAULT_MAX_SYSTEM_PROMPT_CHARS,
  DEFAULT_MODELS,
} as const

