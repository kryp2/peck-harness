/**
 * Real-composition guard for the Claude-CLI adapter: LlmRuntime + plugin boot
 * from a test-only cordis.yml through the actual Loader path, the adapter
 * instance is registered, and a single GenerateOptions call drives one real
 * `claude --print` subprocess end-to-end.
 *
 * The e2e test is opt-in: it runs only with `DSH_CLAUDE_CLI_E2E=1` and a
 * `claude` binary on $PATH, because each run spends the operator's Claude
 * subscription quota. Routine unit and coverage runs skip it.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as ClaudeCli from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(binary: string): Promise<{ ctx: Context }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-claude-cli-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: llm-claude-cli',
    "  name: '@deepseek-ai/dsh-llm-claude-cli'",
    '  config:',
    `    binary: ${JSON.stringify(binary)}`,
    '    settingsJson: \'{"model":"haiku","effortLevel":"low"}\'',
    '    maxSystemPromptChars: 8000',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-llm-claude-cli', ClaudeCli],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx }
}

describe('llm-claude-cli real composition', () => {
  // Opt-in, then self-skip when the CLI is not on PATH. The launcher's
  // `which claude` is the cheapest probe; --version is safer but slower.
  const hasCli = process.env['DSH_CLAUDE_CLI_E2E'] === '1'
    && (existsSync('/home/thomas/.local/bin/claude')
      || process.env['PATH']?.split(':').some(p => existsSync(join(p, 'claude'))) === true)

  it.skipIf(!hasCli)('boots from cordis.yml and routes a GenerateOptions call through `claude --print`', async () => {
    const binary = hasCli ? '/home/thomas/.local/bin/claude' : 'claude'
    const { ctx } = await loadComposition(binary)
    const llm = ctx.get('llm') as LlmRuntime
    const provider = llm.listProviders().find(p => p.id === 'claude-cli')
    expect(provider?.name).toBe('Claude (CLI)')

    const collected: StreamChunk[] = []
    for await (const chunk of llm.stream({
      provider: 'claude-cli',
      model: 'haiku',
      system: 'You are a test agent. Always reply with the single word OK and nothing else. Never call any tools.',
      messages: [{
        id: 'm1',
        role: 'user',
        source: { kind: 'user' } as never,
        content: [{ type: 'text', text: 'Reply with OK.' }],
      } as never],
    })) {
      collected.push(chunk)
    }

    // Claude Code is non-deterministic under --print; assert the structural
    // round-trip (text + usage + finish) rather than exact wording.
    const text = collected.filter(c => c.type === 'text-delta').map(c => c.type === 'text-delta' ? c.text : '').join('')
    expect(text.length).toBeGreaterThan(0)
    const finish = collected.find(c => c.type === 'finish')
    expect(finish?.type).toBe('finish')
    if (finish?.type === 'finish') {
      // finish.kind may be 'stop' or 'tool-calls' depending on whether the
      // assistant emitted JSON tool blocks; both are valid round-trips.
      expect(['stop', 'tool-calls', 'max-tokens']).toContain(finish.reason.kind)
    }
    const usage = collected.find(c => c.type === 'usage')
    expect(usage?.type).toBe('usage')
    if (usage?.type === 'usage') {
      expect(usage.usage.outputTokens).toBeGreaterThan(0)
    }
  }, 120_000)

  it.skipIf(hasCli)('skips the e2e call when `claude` is not on PATH', () => {
    // Placeholder so the file still reports at least one passing test.
    expect(hasCli).toBe(false)
  })
})

