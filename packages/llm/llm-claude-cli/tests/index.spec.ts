/**
 * Plugin-glue tests for the llm-claude-cli entry point: `resolveAdapterOptions`
 * defaults and failure arms, plus the mounted function plugin wired against a
 * real LlmRuntime and a real (in-memory) settings provider, so a stored
 * settings change is observable through subsequent adapter calls.
 *
 * The Loader-level composition guard lives in loader-composition.spec.ts.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { resolveAdapterOptions } from '../src/index.ts'
import * as ClaudeCli from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** Mirrors the plugin's own settings namespace; not exported by the entry. */
const NS: SettingsNamespace = settingsNamespace('llm-claude-cli')

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Boot the llm runtime, the in-memory settings provider, and the plugin under
 * test on one context; every registration rides fibers disposed in afterEach.
 */
async function boot(config: Config): Promise<{ ctx: Context; settingsFiber: Context['fiber'] }> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(ClaudeCli, config)
  return { ctx, settingsFiber }
}

/** Drain one streaming model call into the collected chunk list. */
async function drain(llm: LlmRuntime, opts: GenerateOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of llm.stream(opts)) chunks.push(chunk)
  return chunks
}

/**
 * The adapter-boundary failure message from one drained stream. The runtime
 * turns adapter errors into a terminal error-finish chunk rather than a
 * thrown error, and that message carries the binary the call attempted.
 */
function failureMessage(chunks: readonly StreamChunk[]): string {
  const finish = chunks.find(c => c.type === 'finish')
  if (finish?.type !== 'finish' || finish.reason.kind !== 'error') return ''
  return finish.reason.failure.message
}

describe('llm-claude-cli plugin glue', () => {
  it('registers the claude-cli adapter route and configurable-provider entry', async () => {
    await boot({ binary: 'claude' })
    const llm = context?.get('llm') as LlmRuntime
    expect(llm.listProviders()).toEqual([{ id: 'claude-cli', name: 'Claude (CLI)' }])
    const entry = llm.listConfigurableProviders().find(p => p.provider === 'claude-cli')
    expect(entry?.displayName).toBe('Claude (CLI)')
    expect(entry?.settingsNs).toBe(NS)
  })

  it('re-reads connection facts from the settings scope on each call', async () => {
    const { settingsFiber } = await boot({ binary: 'claude-original' })
    const llm = context?.get('llm') as LlmRuntime
    const opts: GenerateOptions = { provider: 'claude-cli', model: 'sonnet', messages: [] }
    // Before any stored change the composed binary is used verbatim.
    expect(failureMessage(await drain(llm, opts))).toContain('claude-original')
    await settingsFiber.ctx.settings.replace(NS, { binary: 'claude-swapped' })
    // A stored change must reach the next stream call through the swapped source.
    expect(failureMessage(await drain(llm, opts))).toContain('claude-swapped')
  })
})

describe('resolveAdapterOptions', () => {
  it('applies every default to an empty config', () => {
    const resolved = resolveAdapterOptions({})
    expect(resolved.binary).toBe('claude')
    expect(resolved.settingsJson).toBe('{"model":"sonnet","effortLevel":"medium"}')
    expect(resolved.maxTokens).toBe(32_000)
    expect(resolved.maxSystemPromptChars).toBe(32_000)
    expect(resolved.models.map(m => m.id)).toEqual(['sonnet', 'haiku', 'opus'])
  })

  it('keeps explicitly provided values over the defaults', () => {
    expect(resolveAdapterOptions({
      binary: '/opt/claude',
      settingsJson: '{"model":"opus"}',
      maxTokens: 4_096,
      maxSystemPromptChars: 8_000,
      models: [{ id: 'opus', name: 'Claude Opus', contextWindow: 100_000, maxTokens: 2_000 }],
    })).toEqual({
      binary: '/opt/claude',
      settingsJson: '{"model":"opus"}',
      maxTokens: 4_096,
      maxSystemPromptChars: 8_000,
      models: [{ id: 'opus', name: 'Claude Opus', contextWindow: 100_000, maxTokens: 2_000 }],
    })
  })

  it.each([0, -1, 12.5, Number.NaN])('rejects maxTokens %p as not a positive integer', (maxTokens) => {
    expect(() => resolveAdapterOptions({ maxTokens }))
      .toThrow(/maxTokens must be a positive integer/)
  })

  it.each([0, -3])('rejects maxSystemPromptChars %p', (maxSystemPromptChars) => {
    expect(() => resolveAdapterOptions({ maxSystemPromptChars }))
      .toThrow(/maxSystemPromptChars must be a positive integer/)
  })

  it('rejects duplicate catalog model ids', () => {
    expect(() => resolveAdapterOptions({ models: [{ id: 'sonnet' }, { id: 'sonnet' }] }))
      .toThrow(/duplicate catalog model "sonnet"/)
  })
})
