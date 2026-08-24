import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ShellExecutor, ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import {
  answerItemFor,
  formatQuestion,
  keyboardFor,
  name as pluginName,
  inject as pluginInject,
  apply as applyAnswerer,
} from '@deepseek-ai/dsh-telegram-answerer'

const CHAT = '123456'

describe('telegram-answerer pure helpers', () => {
  it('builds one inline button per option with opt:N callback data', () => {
    const keyboard = keyboardFor({
      id: 'q', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }],
    })

    expect(keyboard).toEqual({
      inline_keyboard: [
        [{ text: 'A', callback_data: 'opt:0' }],
        [{ text: 'B', callback_data: 'opt:1' }],
      ],
    })
  })

  it('embeds the per-question nonce in callback data when one is supplied', () => {
    const keyboard = keyboardFor(
      { id: 'q', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] },
      'a1b2c3d4',
    )

    expect(keyboard).toEqual({
      inline_keyboard: [
        [{ text: 'A', callback_data: 'opt:0:a1b2c3d4' }],
        [{ text: 'B', callback_data: 'opt:1:a1b2c3d4' }],
      ],
    })
  })

  it('returns undefined keyboard for a question without options', () => {
    expect(keyboardFor({ id: 'q', question: 'Say something' })).toBeUndefined()
    expect(keyboardFor({ id: 'q', question: 'Empty', options: [] })).toBeUndefined()
  })

  it('renders a question with header and detail, and a batch prefix only when total > 1', () => {
    const question = { id: 'q', header: 'Confirm', question: 'Proceed?', detail: 'Plan text' }

    expect(formatQuestion(question, 0, 1)).toBe('Confirm\nProceed?\n\nPlan text')
    expect(formatQuestion(question, 1, 2)).toBe('[2/2] Confirm\nProceed?\n\nPlan text')
  })

  it('maps a callback reply to the selected option label, with or without a nonce suffix', () => {
    const question = { id: 'q', question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }

    expect(answerItemFor({ kind: 'callback', value: 'opt:1' }, question))
      .toEqual({ id: 'q', selected: ['B'] })
    expect(answerItemFor({ kind: 'callback', value: 'opt:1:deadbeef' }, question))
      .toEqual({ id: 'q', selected: ['B'] })
  })

  it('maps free text to the custom field and empty text to no selection', () => {
    const question = { id: 'q', question: 'Say' }

    expect(answerItemFor({ kind: 'text', value: 'hello' }, question))
      .toEqual({ id: 'q', selected: [], custom: 'hello' })
    expect(answerItemFor({ kind: 'text', value: '' }, question))
      .toEqual({ id: 'q', selected: [] })
  })

  it('falls back to free text when a callback index is not a recognised option or shape', () => {
    const question = { id: 'q', question: 'Pick', options: [{ label: 'A' }] }

    expect(answerItemFor({ kind: 'callback', value: 'opt:9' }, question))
      .toEqual({ id: 'q', selected: [], custom: 'opt:9' })
    expect(answerItemFor({ kind: 'callback', value: 'bogus' }, question))
      .toEqual({ id: 'q', selected: [], custom: 'bogus' })
  })
})

describe('telegram-answerer plugin shape', () => {
  it('exports the function-plugin name and inject surface without a default export', async () => {
    expect(pluginName).toBe('telegram-answerer')
    expect(pluginInject).toEqual([])
    const mod = await import('@deepseek-ai/dsh-telegram-answerer')
    expect('default' in mod).toBe(false)
  })

  it('applies as a no-op when shell or credentials are absent', async () => {
    const ctx = new Context()
    // No shell / credentials provided; apply must not throw and must not require injection.
    const { apply } = await import('@deepseek-ai/dsh-telegram-answerer')
    expect(() => { apply(ctx) }).not.toThrow()
  })
})

function shellResult(over: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
    stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false },
    ...over,
  }
}

/** Which Bot API call one resolved spec represents, judged by the env-carried URL. */
type CallKind = 'send' | 'drain-probe' | 'poll'

const kindOf = (spec: ShellExecSpec): CallKind => {
  const url = spec.env?.TELEGRAM_BOT_URL ?? ''
  return url.includes('/sendMessage') ? 'send'
    : url.includes('offset=-1') ? 'drain-probe'
      : 'poll'
}

const sendOk = (messageId: number): string => JSON.stringify({ ok: true, result: { message_id: messageId } })

/** Duck-typed shell whose scripted `run` returns per call kind, recording each resolved spec. */
function shell(
  run: (kind: CallKind, spec: ShellExecSpec, nthPoll: number) => Promise<ShellRunResult>,
): { executor: ShellExecutor; specs: ShellExecSpec[] } {
  const specs: ShellExecSpec[] = []
  let polls = 0
  const executor = {
    resolve(request: ShellExecRequest): ShellExecSpec {
      return {
        command: request.command, workdir: request.workdir ?? '/stub',
        timeoutMs: request.timeoutMs ?? 0, stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...request.signal ? { signal: request.signal } : {},
        ...request.stdin !== undefined ? { stdin: request.stdin } : {},
        ...request.env !== undefined ? { env: request.env } : {},
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    async run(spec: ShellExecSpec): Promise<ShellRunResult> {
      specs.push(spec)
      const kind = kindOf(spec)
      if (kind === 'poll') polls += 1
      return await run(kind, spec, polls)
    },
  } as unknown as ShellExecutor
  return { executor, specs }
}

function credentials(value: { token: string; chatId: string } | undefined): CredentialProvider {
  return {
    async resolve(ref: string) {
      if (ref === 'TELEGRAM_BOT_TOKEN') return value === undefined ? undefined : { value: value.token, source: 'file' as const }
      if (ref === 'TELEGRAM_CHAT_ID') return value === undefined ? undefined : { value: value.chatId, source: 'file' as const }
      return undefined
    },
  } as unknown as CredentialProvider
}

/** Assert the token never appears on a command line and always travels via the env URL. */
function expectTokenOffArgv(specs: ShellExecSpec[]): void {
  expect(specs.length).toBeGreaterThan(0)
  for (const spec of specs) {
    expect(spec.command).not.toContain('tok')
    expect(spec.env?.TELEGRAM_BOT_URL).toContain('/bottok/')
  }
}

async function wired(
  run: (kind: CallKind, spec: ShellExecSpec, nthPoll: number) => Promise<ShellRunResult>,
  config: { timeoutMs?: number } = {},
): Promise<{ ctx: Context; specs: ShellExecSpec[] }> {
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  const { executor, specs } = shell(run)
  ctx.provide('shell', executor)
  ctx.provide('credentials', credentials({ token: 'tok', chatId: CHAT }))
  applyAnswerer(ctx, config)
  return { ctx, specs }
}

describe('telegram-answerer wired answer path', () => {
  it('answers a callback press correlated to the message it sent, over a drained cursor', async () => {
    let nonce = ''
    const { ctx, specs } = await wired(async (kind, spec) => {
      if (kind === 'send') {
        nonce = /\(q:([0-9a-f]{8})\)/.exec(spec.stdin ?? '')?.[1] ?? ''
        return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      }
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      return shellResult({
        stdout: {
          text: JSON.stringify({
            ok: true,
            result: [{ update_id: 5, callback_query: { from: { id: Number(CHAT) }, data: `opt:0:${nonce}`, message: { message_id: 100 } } }],
          }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({
      questions: [{ id: 'q', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
    })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: ['A'] }] })
    expect(nonce).toMatch(/^[0-9a-f]{8}$/)
    // The drain probe ran before the send, and the poll carried no offset yet.
    const kinds = specs.map(kindOf)
    expect(kinds.indexOf('drain-probe')).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf('drain-probe')).toBeLessThan(kinds.indexOf('send'))
    const poll = specs.find(s => kindOf(s) === 'poll')
    expect(poll?.env?.TELEGRAM_BOT_URL).not.toContain('offset=')
    expectTokenOffArgv(specs)
  })

  it('drains a pending stale update before sending, then polls past its update id', async () => {
    const { ctx, specs } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') {
        return shellResult({
          stdout: {
            text: JSON.stringify({ ok: true, result: [{ update_id: 7, message: { chat: { id: Number(CHAT) }, text: 'stale answer' } }] }),
            truncated: false,
          },
        })
      }
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 9, message: { chat: { id: Number(CHAT) }, text: 'fresh answer' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'fresh answer' }] })
    // The stale text was consumed by the drain (cursor 8), so the poll starts at offset 8.
    const poll = specs.find(s => kindOf(s) === 'poll')
    expect(poll?.env?.TELEGRAM_BOT_URL).toContain('offset=8')
  })

  it('ignores a callback press that references an earlier question message', async () => {
    let polls = 0
    const { ctx, specs } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      // A drain entry without an update id cannot advance the cursor.
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [{ shape: 'malformed' }] }), truncated: false } })
      polls += 1
      if (polls === 1) {
        // A press left over from a previous question's keyboard: right chat, old message.
        return shellResult({
          stdout: {
            text: JSON.stringify({
              ok: true,
              result: [{ update_id: 3, callback_query: { from: { id: Number(CHAT) }, data: 'opt:0:stale', message: { message_id: 99 } } }],
            }),
            truncated: false,
          },
        })
      }
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 4, message: { chat: { id: Number(CHAT) }, text: 'typed instead' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({
      questions: [{ id: 'q', question: 'Pick', options: [{ label: 'A' }] }],
    })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'typed instead' }] })
    expect(polls).toBe(2)
    expectTokenOffArgv(specs)
  })

  it('reuses the established cursor across consecutive asks without probing again', async () => {
    let lastUpdateId = 20
    const { ctx, specs } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(lastUpdateId + 1000), truncated: false } })
      if (kind === 'drain-probe') {
        return shellResult({
          stdout: {
            text: JSON.stringify({ ok: true, result: [{ update_id: 20, message: { chat: { id: Number(CHAT) }, text: 'old' } }] }),
            truncated: false,
          },
        })
      }
      lastUpdateId += 1
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: lastUpdateId, message: { chat: { id: Number(CHAT) }, text: `answer ${lastUpdateId}` } }] }),
          truncated: false,
        },
      })
    })

    await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'First?' }] })
    await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Second?' }] })

    // Exactly one drain probe across both asks; later polls advance the shared cursor.
    expect(specs.filter(s => kindOf(s) === 'drain-probe')).toHaveLength(1)
    const pollOffsets = specs.filter(s => kindOf(s) === 'poll')
      .map(s => Number(/offset=(\d+)/.exec(s.env?.TELEGRAM_BOT_URL ?? '')?.[1]))
    expect(pollOffsets.length).toBe(2)
    expect(pollOffsets[1]).toBeGreaterThan(pollOffsets[0]!)
  }, 15_000)

  it('serializes concurrent asks so their sends and polls never interleave', async () => {
    let releaseFirstPoll: (() => void) | undefined
    const firstPollGate = new Promise<void>((resolve) => { releaseFirstPoll = resolve })
    let polls = 0
    const { ctx, specs } = await wired(async (kind, _spec, nthPoll) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(nthPoll === 0 ? 500 : 600), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      polls += 1
      if (polls === 1) await firstPollGate
      const sent = polls === 1 ? 500 : 600
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: polls, message: { chat: { id: Number(CHAT) }, text: `reply ${sent}` } }] }),
          truncated: false,
        },
      })
    }, { timeoutMs: 10_000 })

    const first = ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'First' }] })
    // Wait until the first ask is inside its poll, then queue a second ask behind it.
    await new Promise(resolve => setTimeout(resolve, 30))
    const second = ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Second' }] })
    await new Promise(resolve => setTimeout(resolve, 30))

    // The queued ask cannot touch Telegram while the first still owns the chat.
    expect(specs.filter(s => kindOf(s) === 'send')).toHaveLength(1)

    releaseFirstPoll!()
    await expect(first).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'reply 500' }] })
    await expect(second).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'reply 600' }] })
    expect(specs.filter(s => kindOf(s) === 'send')).toHaveLength(2)
  }, 15_000)

  it('recovers the serialized queue after a failed ask', async () => {
    let sends = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      if (kind === 'send') {
        sends += 1
        if (sends === 1) return shellResult({ exitCode: 1, stdout: { text: 'curl failed', truncated: false } })
        return shellResult({ stdout: { text: sendOk(300), truncated: false } })
      }
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 2, message: { chat: { id: Number(CHAT) }, text: 'after recovery' } }] }),
          truncated: false,
        },
      })
    })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Fails' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Works' }] }))
      .resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'after recovery' }] })
  })

  it('falls through when the drain probe fails closed against Telegram', async () => {
    const { ctx } = await wired(async (kind) => {
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: false }), truncated: false } })
      throw new Error('unexpected call beyond the drain probe')
    })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('falls through when the send response carries no message id', async () => {
    let sends = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') {
        sends += 1
        // First a missing result object, then an object without the message id.
        const text = sends === 1
          ? JSON.stringify({ ok: true })
          : JSON.stringify({ ok: true, result: {} })
        return shellResult({ stdout: { text, truncated: false } })
      }
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      throw new Error('unexpected poll after a failed send')
    })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say again' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('falls through when Telegram rejects the send transport', async () => {
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ exitCode: 1, stdout: { text: 'curl failed', truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      throw new Error('unexpected poll after a failed send')
    })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('falls through to the next answerer when Telegram is unconfigured', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    ctx.provide('shell', shell(async () => shellResult()).executor)
    ctx.provide('credentials', credentials(undefined))
    applyAnswerer(ctx, { timeoutMs: 2000 })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('answers a free-text question from a plain reply message', async () => {
    const { ctx, specs } = await wired(async (kind, spec) => {
      if (kind === 'send') {
        expect(spec.stdin).toContain('(q:')
        return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      }
      // A non-array drain result means "nothing pending"; the cursor stays unset.
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: {} }), truncated: false } })
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: Number(CHAT) }, text: 'hello there' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'hello there' }] })
    expectTokenOffArgv(specs)
  })

  it('ignores a reply from a non-authorized chat and then answers from the authorized one', async () => {
    let polls = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      polls += 1
      if (polls === 1) {
        return shellResult({
          stdout: {
            text: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 999999 }, text: 'wrong chat' } }] }),
            truncated: false,
          },
        })
      }
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 2, message: { chat: { id: Number(CHAT) }, text: 'right chat' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'right chat' }] })
    expect(polls).toBe(2)
  })

  it('falls through when the answer deadline elapses before a reply', async () => {
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      // A non-array poll result contributes nothing; the loop then hits its deadline.
      return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: null }), truncated: false } })
    }, { timeoutMs: 1 })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('skips a malformed getUpdates response and eventually answers', async () => {
    let polls = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      polls += 1
      if (polls === 1) return shellResult({ stdout: { text: 'not json', truncated: false } })
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: Number(CHAT) }, text: 'after bad json' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'after bad json' }] })
    expect(polls).toBe(2)
  })

  it('skips a non-ok getUpdates envelope and eventually answers', async () => {
    let polls = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      polls += 1
      if (polls === 1) return shellResult({ stdout: { text: JSON.stringify({ ok: false, description: 'restarted' }), truncated: false } })
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: Number(CHAT) }, text: 'after bad ok' } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Say something' }] })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: [], custom: 'after bad ok' }] })
    expect(polls).toBe(2)
  })

  it('ignores malformed updates, wrong-chat callbacks, and uncorrelated callbacks before answering', async () => {
    let polls = 0
    const { ctx } = await wired(async (kind) => {
      if (kind === 'send') return shellResult({ stdout: { text: sendOk(100), truncated: false } })
      if (kind === 'drain-probe') return shellResult({ stdout: { text: JSON.stringify({ ok: true, result: [] }), truncated: false } })
      polls += 1
      if (polls === 1) {
        return shellResult({
          stdout: {
            text: JSON.stringify({
              ok: true,
              result: [
                'garbage',
                { update_id: 1, callback_query: { from: { id: 999999 }, data: 'opt:0:x', message: { message_id: 100 } } },
                { update_id: 2, callback_query: { from: { id: Number(CHAT) }, data: 'opt:0:x', message: { message_id: 55 } } },
                { update_id: 3, callback_query: { from: { id: Number(CHAT) }, message: { message_id: 100 } } },
              ],
            }),
            truncated: false,
          },
        })
      }
      return shellResult({
        stdout: {
          text: JSON.stringify({ ok: true, result: [{ update_id: 4, callback_query: { from: { id: Number(CHAT) }, data: 'opt:0:abc', message: { message_id: 100 } } }] }),
          truncated: false,
        },
      })
    })

    const answer = await ctx.userQuestions.ask({
      questions: [{ id: 'q', question: 'Pick', options: [{ label: 'A' }] }],
    })

    expect(answer).toEqual({ answers: [{ id: 'q', selected: ['A'] }] })
    expect(polls).toBe(2)
  })
})
