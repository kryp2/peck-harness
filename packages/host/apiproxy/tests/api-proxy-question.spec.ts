import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

async function harness(): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
  }
}

function agent(ctx: Context): Agent {
  const session = ctx.sessions.create()
  const value = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(value)
  return value
}

function openMux(api: ApiProxy, abort: AbortController): {
  envelopes: RpcRequest<MuxFrame>[]
  waitForQuestion(): Promise<RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>>
} {
  const envelopes: RpcRequest<MuxFrame>[] = []
  let resolveQuestion!: (value: RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>) => void
  const question = new Promise<RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>>((resolve) => {
    resolveQuestion = resolve
  })
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: RpcId('question-mux'), payload: {} }, abort.signal)) {
      envelopes.push(envelope)
      if (envelope.payload.type === 'question/requested') {
        resolveQuestion(envelope as RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>)
      }
    }
  })()
  return { envelopes, waitForQuestion: () => question }
}

function answer(
  envelope: RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>,
  selected: string[],
  custom?: string,
): Parameters<ApiProxy['respond']>[0] {
  return {
    type: 'client-response',
    rpcId: envelope.rpcId,
    result: {
      ok: true,
      value: {
        sessionId: envelope.payload.sessionId,
        answer: {
          answers: [{
            id: envelope.payload.questions[0]?.id,
            selected,
            ...custom === undefined ? {} : { custom },
          }],
        },
      },
    },
  }
}

describe('question response validation', () => {
  it('accepts selected options with custom text for multi-select questions', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{
        id: 'targets',
        question: 'Choose targets and add another',
        multiSelect: true,
        options: [{ label: 'Code' }, { label: 'Docs' }],
      }],
    })
    const envelope = await mux.waitForQuestion()

    expect(await api.respond(answer(envelope, ['Code', 'Docs'], 'Release notes')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'targets', selected: ['Code', 'Docs'], custom: 'Release notes' }],
    })
    expect(mux.envelopes.some(item => item.payload.type === 'question/resolved')).toBe(true)
    abort.abort()
  })

  it('keeps selected options and custom text mutually exclusive for single-select questions', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{
        id: 'target',
        question: 'Choose one target',
        options: [{ label: 'Code' }, { label: 'Docs' }],
      }],
    })
    const envelope = await mux.waitForQuestion()

    expect(await api.respond(answer(envelope, ['Code'], 'Release notes')))
      .toEqual({ accepted: false, reason: 'bad-response' })
    expect(await api.respond(answer(envelope, [], 'Release notes')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'target', selected: [], custom: 'Release notes' }],
    })
    abort.abort()
  })
})

describe('question handler under racing', () => {
  it('withdraws the web surface without hanging when another channel claims first', async () => {
    const { ctx, api } = await harness()
    // A competitor channel whose claim is released on demand.
    let claim!: () => void
    const claimed = new Promise<void>((resolve) => { claim = resolve })
    void ctx.on('user-questions/ask', () =>
      claimed.then(() => ({ answers: [{ id: 'target', selected: ['Code'] }] })))

    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{ id: 'target', question: 'Choose one', options: [{ label: 'Code' }, { label: 'Docs' }] }],
    })
    const envelope = await mux.waitForQuestion()

    claim()
    // The losing web handler resolves (superseded) rather than dangling; the
    // answer travels from whichever channel won.
    await expect(asked).resolves.toEqual({ answers: [{ id: 'target', selected: ['Code'] }] })

    // The pending question left the GUI surface through the withdrawal frame...
    const withdrawn = mux.envelopes.some(item => item.payload.type === 'question/resolved'
      && item.payload.questionRpcId === envelope.rpcId)
    expect(withdrawn).toBe(true)
    // ...so a late GUI response to the stale rpcId is no longer pending.
    expect(await api.respond(answer(envelope, ['Docs'])))
      .toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('keeps the ask alive on the web channel when the GUI declines to answer it', async () => {
    const { ctx, api } = await harness()
    let claim!: () => void
    const claimed = new Promise<void>((resolve) => { claim = resolve })
    void ctx.on('user-questions/ask', () =>
      claimed.then(() => ({ answers: [{ id: 'target', selected: ['Docs'] }] })))

    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{ id: 'target', question: 'Choose one', options: [{ label: 'Code' }, { label: 'Docs' }] }],
    })
    const envelope = await mux.waitForQuestion()

    // The web channel itself fails authoritatively (user cancelled in the GUI):
    // that settles the whole ask even though the competitor had not answered.
    expect(await api.respond({
      type: 'client-response',
      rpcId: envelope.rpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'cancelled', details: {} } },
    })).toEqual({ accepted: true })
    await expect(asked).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_CANCELLED' })
    expect(mux.envelopes.some(item => item.payload.type === 'question/resolved')).toBe(true)
    claim()
    abort.abort()
  })
})
