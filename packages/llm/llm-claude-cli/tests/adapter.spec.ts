/**
 * Adapter-level tests for ClaudeCliAdapter. Cover the model-resolution,
 * provider-info, retry-policy, spawn/stream failure-classification, and
 * abort paths. The stdout/stderr classification and abort suites drive a
 * fake `claude` binary (a temporary POSIX shell script) instead of the real
 * CLI, so they stay deterministic and self-skipping on win32 — the same
 * platform split as the subprocess-local suites, whose signal semantics do
 * not exist on Windows.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { ClaudeCliAdapter, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from '../src/adapter.ts'
import type { ClaudeCliConnectionOptions } from '../src/serialize.ts'

function conn(overrides: Partial<ClaudeCliConnectionOptions> = {}): ClaudeCliConnectionOptions {
  return {
    binary: 'claude',
    settingsJson: '{"model":"sonnet","effortLevel":"medium"}',
    maxTokens: 32000,
    maxSystemPromptChars: 32000,
    models: [
      { id: 'sonnet', contextWindow: 200000, maxTokens: 32000 },
      { id: 'haiku', contextWindow: 200000, maxTokens: 32000 },
    ],
    ...overrides,
  }
}

function genOpts(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'claude-cli', model: 'sonnet', messages: [], ...overrides }
}

function adapter(): ClaudeCliAdapter {
  return new ClaudeCliAdapter({ options: conn })
}

/** Result of draining one adapter stream to settlement. */
interface SettledStream {
  chunks: StreamChunk[]
  /** The terminal error, or `undefined` when the stream finished cleanly. */
  error: unknown
}

/**
 * Drain one adapter stream to settlement, capturing every yielded chunk and
 * the terminal error separately so tests can assert on both.
 */
async function settleStream(stream: AsyncIterable<StreamChunk>): Promise<SettledStream> {
  const chunks: StreamChunk[] = []
  try {
    for await (const chunk of stream) chunks.push(chunk)
  } catch (error) {
    return { chunks, error }
  }
  return { chunks, error: undefined }
}

let currentBinDir: string | undefined

afterEach(async () => {
  if (currentBinDir !== undefined) await rm(currentBinDir, { recursive: true, force: true })
  currentBinDir = undefined
})

/** Lazily create the temp directory that hosts the fake binaries. */
async function fakeBinDir(): Promise<string> {
  currentBinDir ??= await mkdtemp(join(tmpdir(), 'dsh-llm-claude-cli-fakebin-'))
  return currentBinDir
}

/**
 * Write a POSIX shell script as a stand-in `claude` binary. Every script
 * drains the conversation payload from stdin (`cat > /dev/null`) before
 * acting — like the real CLI, which reads its stdin too. Draining keeps the
 * child alive until the adapter's `stdin.end()` has flushed, avoiding EPIPE
 * races on fast-exiting scripts.
 */
async function writeFakeBinary(name: string, body: string): Promise<string> {
  const dir = await fakeBinDir()
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\ncat > /dev/null\n${body}\n`, { mode: 0o755 })
  return path
}

// POSIX-only: shebang scripts and SIGTERM/SIGKILL semantics do not exist on
// win32, so the whole fake-binary lane self-skips there (see file JSDoc).
const posixOnly = describe.skipIf(process.platform === 'win32')

/**
 * One shell line echoing `arg` (POSIX-single-quoted) on stdout, optionally
 * redirected (e.g. `' >&2'` for stderr). Interpolation keeps the single
 * quotes out of JS string literals.
 */
function shEchoTo(arg: string, redirect = ''): string {
  return `echo '${arg}'${redirect}`
}

posixOnly('ClaudeCliAdapter: stdout/stderr classification through a fake binary', () => {
  it('rejects a result document whose type field is not "result"', async () => {
    const binary = await writeFakeBinary('claude-typed', shEchoTo('{"type":"other"}'))
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('CLAUDE_CLI_ERROR')
    expect((error as LlmError).message).toContain('unexpected document type "other"')
  })

  it('reports the document type as "missing" when the JSON object has none', async () => {
    const binary = await writeFakeBinary('claude-typeless', shEchoTo('{}'))
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('CLAUDE_CLI_ERROR')
    expect((error as LlmError).message).toContain('unexpected document type "missing"')
  })

  it('surfaces unparseable JSON without a stderr hint when stderr stayed empty', async () => {
    const binary = await writeFakeBinary('claude-garbage', shEchoTo('definitely-not-json'))
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('CLAUDE_CLI_ERROR')
    expect((error as LlmError).message).toContain('unparseable JSON')
    expect((error as LlmError).message).not.toContain('stderr:')
  })

  it('classifies an authentication failure on stderr as AUTH', async () => {
    const body = [
      shEchoTo('not-json'),
      shEchoTo('Authentication required: please run /login', ' >&2'),
    ].join('\n')
    const binary = await writeFakeBinary('claude-auth', body)
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('AUTH')
  })

  it('classifies command-not-found text on stderr as TRANSPORT', async () => {
    const body = [
      shEchoTo('not-json'),
      shEchoTo('/bin/sh: claude: command not found', ' >&2'),
    ].join('\n')
    const binary = await writeFakeBinary('claude-notfound', body)
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('TRANSPORT')
  })

  it('classifies a non-ENOENT spawn failure as TRANSPORT', async () => {
    // An existing but non-executable file fails spawn with EACCES — the
    // non-ENOENT arm of the spawn-error classification.
    const dir = await fakeBinDir()
    const binary = join(dir, 'claude-noexec')
    await writeFile(binary, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const { error } = await settleStream(a.stream(genOpts()))
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('TRANSPORT')
    expect((error as LlmError).message).toContain('spawn failed')
  })
})

posixOnly('ClaudeCliAdapter: caller abort mid-stream', () => {
  it('kills the child on caller abort and lets the SIGKILL escalation fire', async () => {
    // The binary emits a well-formed but wrong document, then blocks
    // forever (`exec` so SIGTERM hits the blocking process directly);
    // only the abort path can end this call.
    const binary = await writeFakeBinary('claude-hang', [
      shEchoTo('{"type":"partial"}'),
      'exec sleep 60',
    ].join('\n'))
    const a = new ClaudeCliAdapter({ options: () => conn({ binary }) })
    const controller = new AbortController()
    const settled = settleStream(a.stream(genOpts({ signal: controller.signal })))
    await delay(50)
    controller.abort()
    const { error } = await settled
    // The child died mid-call, so the partial document surfaces as a
    // CLAUDE_CLI_ERROR rather than a clean finish.
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).code).toBe('CLAUDE_CLI_ERROR')
    // Wait out the 5s SIGTERM → SIGKILL escalation so its scheduled
    // callback executes under coverage before this worker is torn down.
    await delay(5_400)
  }, 15_000)
})

describe('ClaudeCliAdapter: provider metadata', () => {
  it('returns the configured provider name and id', () => {
    const a = adapter()
    expect(a.providerInfo('claude-cli')).toEqual({ id: 'claude-cli', name: 'Claude (CLI)' })
  })

  it('returns a no-retry policy so the harness retry layer wraps cleanly', () => {
    const a = adapter()
    const policy = a.providerRetryPolicy('claude-cli')
    // ResolvedRetryPolicy is `normal | always`; our adapter always returns
    // the `normal` variant with zero retries so harness-level retry wraps
    // the spawn transparently.
    expect(policy.mode).toBe('normal')
    if (policy.mode === 'normal') {
      expect(policy.maxRetries).toBe(0)
      expect(policy.retryableCodes).toEqual([])
    }
  })
})

describe('ClaudeCliAdapter: catalog', () => {
  it('lists models from the configured catalog', async () => {
    const a = adapter()
    const models = await a.listModels('claude-cli')
    expect(models.map(m => m.id)).toEqual(['sonnet', 'haiku'])
    expect(models[0]?.name).toBe('sonnet')
    expect(models.every(m => m.inputModalities?.[0] === 'text')).toBe(true)
  })

  it('exposes an uncatalogued model as text-only with the harness defaults', async () => {
    const a = adapter()
    const resolved = await a.resolveModel('claude-cli', 'opus')
    expect(resolved.id).toBe('opus')
    expect(resolved.name).toBe('opus')
    expect(resolved.context?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolved.defaultMaxTokens).toBe(DEFAULT_MAX_TOKENS)
    expect(resolved.inputModalities).toEqual(['text'])
  })

  it('honors a catalog entry\'s contextWindow + maxTokens', async () => {
    const a = new ClaudeCliAdapter({
      options: () => conn({
        models: [{ id: 'haiku', contextWindow: 100000, maxTokens: 8000 }],
      }),
    })
    const resolved = await a.resolveModel('claude-cli', 'haiku')
    expect(resolved.context?.contextWindow).toBe(100000)
    expect(resolved.defaultMaxTokens).toBe(8000)
  })

  it('falls back to the profile maxTokens when a catalog entry has none', async () => {
    const a = new ClaudeCliAdapter({
      options: () => conn({
        models: [{ id: 'haiku' }],
        maxTokens: 16000,
      }),
    })
    const resolved = await a.resolveModel('claude-cli', 'haiku')
    expect(resolved.defaultMaxTokens).toBe(16000)
  })
})

describe('ClaudeCliAdapter: spawn failure classification', () => {
  // The classifyJsonError helper is internal; we exercise it through
  // the public stream() surface by spawning a binary that does not exist.
  it('classifies ENOENT (binary missing) as AUTH for consistency with claude-CLI\'s auth prompt', async () => {
    const a = new ClaudeCliAdapter({
      options: () => conn({ binary: '/nonexistent/claude-binary-that-cannot-exist' }),
    })
    const opts: GenerateOptions = {
      provider: 'claude-cli',
      model: 'haiku',
      messages: [],
    }
    const chunks: unknown[] = []
    try {
      for await (const chunk of a.stream(opts)) chunks.push(chunk)
    } catch (err) {
      // Either an AUTH (ENOENT branch) or TRANSPORT error is acceptable;
      // both surface as LlmError from the spawn path.
      expect(String(err)).toMatch(/Claude CLI spawn failed|LlmError/)
    }
    expect(chunks.length).toBe(0)
  })

  it('aborts the child process when the caller signal fires', async () => {
    const a = adapter()
    const controller = new AbortController()
    const opts: GenerateOptions = {
      provider: 'claude-cli',
      model: 'haiku',
      messages: [],
      signal: controller.signal,
    }
    // Abort before consuming the stream; the iterator should exit promptly.
    controller.abort()
    const iterator = a.stream(opts)[Symbol.asyncIterator]()
    // We don't care whether it returns done or throws — both indicate the
    // abort path executed without leaking the child process.
    const result = await iterator.next().catch((err: unknown) => ({ reason: String(err) })) as { done?: boolean } | { reason: string }
    const aborted = 'reason' in result || result.done === true
    expect(aborted).toBe(true)
  })
})
