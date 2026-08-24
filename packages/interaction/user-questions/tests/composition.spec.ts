import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'

/**
 * Real-composition proof for the racing dispatch: a test-only cordis.yml boots the
 * actual Service Definition plus two stub answerer plugins through the Loader, so
 * concurrency, single settlement, and loser cancellation are observed through the
 * same plugin pipeline production uses.
 */

/** One dispatched attempt as a stub channel observed it. */
interface AttemptRecord {
  channel: string
  request: AskUserQuestionRequest
  signal: AbortSignal
}

let attempts: AttemptRecord[] = []
const gates = new Map<string, Promise<AskUserQuestionAnswer | undefined>>()

function release(channel: string, outcome: Promise<AskUserQuestionAnswer | undefined>): void {
  gates.set(channel, outcome)
}

/** Minimal racing answerer plugin: records its dispatch, then follows its gate. */
function stubAnswerer(channel: string): { name: string; inject: string[]; apply(ctx: Context): void } {
  return {
    name: channel,
    inject: [],
    apply(ctx: Context): void {
      ctx.on('user-questions/ask', (request, signal) => {
        attempts.push({ channel, request, signal })
        // A missing gate declines, exercising the decline arm of the contract.
        return gates.get(channel) ?? Promise.resolve(undefined)
      })
    },
  }
}

const answer = (label: string): AskUserQuestionAnswer => ({ answers: [{ id: 'confirm', selected: [label] }] })

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  attempts = []
  gates.clear()
  root = await mkdtemp(join(tmpdir(), 'dsh-user-questions-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: 'stub-web'",
    "- name: 'stub-tg'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['stub-web', stubAnswerer('web')],
    ['stub-tg', stubAnswerer('tg')],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('user-questions Loader composition', () => {
  it('delivers one ask to every composed channel and settles exactly once', async () => {
    const ctx = await loadComposition()

    release('tg', Promise.resolve(answer('telegram')))
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    // Concurrent delivery through the real pipeline: both channels hold the same
    // request before either settles.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(attempts.map(record => record.channel)).toEqual(['web', 'tg'])
    const webSignal = attempts.find(record => record.channel === 'web')?.signal

    await expect(asked).resolves.toEqual(answer('telegram'))
    // The losing channel was cancelled deterministically with the supersession reason.
    expect(webSignal?.aborted).toBe(true)
    expect(webSignal?.reason).toMatchObject({ code: 'SUPERSEDED' })

    // A late claim from the loser changes nothing: the ask settled once.
    release('web', Promise.resolve(answer('web-late')))
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(asked).resolves.toEqual(answer('telegram'))
  })

  it('crown the first channel to answer regardless of composition order', async () => {
    const ctx = await loadComposition()

    release('web', Promise.resolve(answer('web')))
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    await expect(asked).resolves.toEqual(answer('web'))
    const tgSignal = attempts.find(record => record.channel === 'tg')?.signal
    expect(tgSignal?.aborted).toBe(true)
    expect(tgSignal?.reason).toMatchObject({ code: 'SUPERSEDED' })
  })

  it('fails closed when both composed channels decline', async () => {
    const ctx = await loadComposition()

    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })
    await expect(asked).rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
    expect(attempts).toHaveLength(2)
  })
})
