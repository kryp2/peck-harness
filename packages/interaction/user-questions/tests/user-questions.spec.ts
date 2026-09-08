import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import UserQuestionService, {
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
  type UserQuestionAttempt,
  raceUserQuestionAttempts,
  UserQuestionError,
} from '@deepseek-ai/dsh-user-questions'

interface QuestionAnswerer {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

function registerAnswerer(ctx: Context, answerer: QuestionAnswerer): () => void {
  return ctx.on('user-questions/request', request => answerer.ask(request))
}

function provider(answer = 'approved'): QuestionAnswerer & { seen: AskUserQuestionRequest[] } {
  const seen: AskUserQuestionRequest[] = []
  return {
    seen,
    async ask(request) {
      seen.push(request)
      return {
        answers: request.questions.map(question => ({ id: question.id, selected: [answer] })),
      }
    },
  }
}

function stubAgent(id: string, delegationDepth = 0): Agent {
  const agentId = id as Agent['id']
  return {
    id: agentId,
    session: { id: agentId, header: { delegationDepth } },
  } as unknown as Agent
}

/** A controllable promise, used to hold attempts open and settle them in a chosen order. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Register a controllable racing attempt that captures its dispatch arguments. */
function gatedAttempt(
  ctx: Context,
  hooks: { seen?: { request: AskUserQuestionRequest; signal: AbortSignal }[] } = {},
): {
  claim: (answer: AskUserQuestionAnswer) => void
  decline: () => void
  failAuthoritative: (code: string) => void
  failAsChannel: () => void
} {
  const gate = deferred<AskUserQuestionAnswer | undefined>()
  const seen = hooks.seen ??= []
  const attempt: UserQuestionAttempt = (request, signal) => {
    seen.push({ request, signal })
    return gate.promise
  }
  void ctx.on('user-questions/ask', attempt)
  return {
    claim: (answer) => { gate.resolve(answer) },
    decline: () => { gate.resolve(undefined) },
    failAuthoritative: (code) => { gate.reject(new UserQuestionError(`authoritative ${code}`, code)) },
    failAsChannel: () => { gate.reject(new Error('channel transport failed')) },
  }
}

describe('UserQuestionService', () => {
  it('delegates ask requests to the registered provider', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider('yes')
    registerAnswerer(ctx, p)
    const questions = [{ id: 'confirm', question: 'Proceed?', options: [{ label: 'yes' }] }]

    const result = await ctx.userQuestions.ask({ questions })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
    expect(p.seen).toEqual([{ questions }])
  })

  it('rejects ask requests when no answerer is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('registers providers with HMR-safe disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider()
    const dispose = registerAnswerer(ctx, p)

    dispose()
    dispose()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ code: 'NO_ANSWERER' })
  })

  it('answers from the first composed answerer that claims the question', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    // Two racing answerers coexist on the event; the first to claim wins.
    ctx.userQuestions.registerProvider(provider('first'))
    ctx.userQuestions.registerProvider(provider('second'))

    const result = await ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['first'] }] })
  })

  it('delegates through composed waterfall answerers', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const delegated = vi.fn()
    ctx.on('user-questions/request', (_request, next) => {
      delegated()
      return next()
    })
    const p = provider('second')
    registerAnswerer(ctx, p)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?', options: [{ label: 'second' }] }],
    })).resolves.toEqual({ answers: [{ id: 'confirm', selected: ['second'] }] })
    expect(delegated).toHaveBeenCalledOnce()
  })

  it('fails before reaching the provider when the signal is already aborted', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [{ id: 'confirm', selected: ['too late'] }] })) }
    registerAnswerer(ctx, p)
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }], signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('normalizes an in-flight signal cancellation to ASK_ABORTED', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const pending = Promise.withResolvers<never>()
    registerAnswerer(ctx, { ask: () => pending.promise })
    const controller = new AbortController()
    const abortReason = new DOMException('This operation was aborted', 'AbortError')

    const answer = ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      signal: controller.signal,
    })
    controller.abort(abortReason)
    pending.reject(abortReason)

    await expect(answer).rejects.toMatchObject({
      name: 'UserQuestionError',
      code: 'ASK_ABORTED',
      cause: abortReason,
    })
  })

  it('preserves a domain rejection when its provider also aborts the signal', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const controller = new AbortController()
    const cancelled = new UserQuestionError('the user cancelled ask_user_question', 'ASK_CANCELLED')
    registerAnswerer(ctx, {
      ask: () => {
        controller.abort()
        return Promise.reject(cancelled)
      },
    })

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      signal: controller.signal,
    })).rejects.toBe(cancelled)
  })

  it('restores a transported provider rejection to UserQuestionError', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const transported = Object.assign(new Error('the user cancelled ask_user_question'), {
      name: 'UserQuestionError',
      code: 'ASK_CANCELLED',
    })
    registerAnswerer(ctx, { ask: () => Promise.reject(transported) })

    const rejection = await ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(rejection).toBeInstanceOf(UserQuestionError)
    expect(rejection).toMatchObject({
      name: 'UserQuestionError',
      code: 'ASK_CANCELLED',
      cause: transported,
    })
  })

  it.each([
    ['an ordinary Error', new Error('provider failed')],
    ['a namesake Error without a string code', Object.assign(new Error('provider failed'), {
      name: 'UserQuestionError',
    })],
    ['a non-Error rejection', { name: 'UserQuestionError', code: 'ASK_CANCELLED' }],
  ])('preserves %s from the provider', async (_label, rejection) => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    registerAnswerer(ctx, { ask: vi.fn().mockRejectedValue(rejection) })

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    })).rejects.toBe(rejection)
  })

  it('rejects empty question batches before reaching the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)

    await expect(ctx.userQuestions.ask({ questions: [] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a live runtime-owned agent before reaching the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)
    const root = stubAgent('root', 0)
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: child,
    })).rejects.toMatchObject({
      name: 'UserQuestionError',
      code: 'DELEGATED_CALLER',
      message: "human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
    })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('reaches the provider for a lineage-bearing session resumed as a runtime root', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = provider('yes')
    registerAnswerer(ctx, p)
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    const result = await ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?', options: [{ label: 'yes' }] }],
      agent,
    })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
  })

  it('rejects a supplied agent when no live registry can attest it', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('unattested'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a stale agent object that reuses a live id', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)
    const live = stubAgent('same-id')
    ctx.agents.enter(live, undefined)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('same-id'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('restores a transported UserQuestionError to the public error class', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const transported = Object.assign(new Error('the user cancelled ask_user_question'), {
      name: 'UserQuestionError',
      code: 'ASK_CANCELLED',
    })
    registerAnswerer(ctx, { ask: () => Promise.reject(transported) })

    const failure = await ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(UserQuestionError)
    expect(failure).toMatchObject({
      name: 'UserQuestionError', code: 'ASK_CANCELLED', cause: transported,
    })
  })

  it('preserves a provider rejection outside the UserQuestionError taxonomy', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const failure = new Error('provider failed')
    registerAnswerer(ctx, { ask: () => Promise.reject(failure) })

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    })).rejects.toBe(failure)
  })

  it('rejects an intent whose approve label names none of its own options', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)
    const question = { id: 'plan-review', question: 'Approve?', detail: '# Plan' }

    // A wrong label among offered options, and no options offered at all.
    for (const options of [[{ label: 'Approve' }], undefined]) {
      await expect(ctx.userQuestions.ask({
        questions: [{
          ...question,
          ...(options === undefined ? {} : { options }),
          intent: { kind: 'plan-review', approve: 'Ship it' },
        }],
      })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    }
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a plan-review intent on a question carrying no plan to review', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    registerAnswerer(ctx, p)

    // Detail IS the plan for this intent, so a UI honouring it would ask the
    // user to approve something they cannot see.
    await expect(ctx.userQuestions.ask({
      questions: [{
        id: 'plan-review', question: 'Approve?',
        options: [{ label: 'Approve' }, { label: 'Keep planning' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('passes an intent through once its approve label names an offered option', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider('Approve')
    registerAnswerer(ctx, p)
    const intent = { kind: 'plan-review', approve: 'Approve' } as const

    const result = await ctx.userQuestions.ask({
      questions: [
        { id: 'plain', question: 'Proceed?', options: [{ label: 'Approve' }] },
        {
          id: 'plan-review', question: 'Approve?', detail: '# Plan',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent,
        },
      ],
    })

    expect(result.answers).toEqual([
      { id: 'plain', selected: ['Approve'] },
      { id: 'plan-review', selected: ['Approve'] },
    ])
    expect(p.seen[0]?.questions[1]?.intent).toEqual(intent)
  })
})

describe('UserQuestionService racing registry', () => {
  const answer = (label: string): AskUserQuestionAnswer => ({ answers: [{ id: 'confirm', selected: [label] }] })

  it('delivers one ask to every composed answerer at the same time', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const seen: { request: AskUserQuestionRequest; signal: AbortSignal }[] = []
    const slow = gatedAttempt(ctx, { seen })
    gatedAttempt(ctx, { seen })
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })
    // True racing: both attempts hold the same request and share one race signal
    // before either has settled.
    expect(seen).toHaveLength(2)
    expect(seen[0]?.signal).toBe(seen[1]?.signal)

    slow.claim(answer('first'))
    await expect(asked).resolves.toEqual(answer('first'))
  })

  it('settles on the first answer regardless of listener order', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    // First-registered attempt answers second.
    const slow = gatedAttempt(ctx)
    const fast = gatedAttempt(ctx)
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    fast.claim(answer('second-registered-wins'))
    await expect(asked).resolves.toEqual(answer('second-registered-wins'))
    slow.decline()

    // And the mirror order through a fresh composition.
    const ctx2 = new Context()
    await ctx2.plugin(UserQuestionService)
    const fast2 = gatedAttempt(ctx2)
    gatedAttempt(ctx2)
    const asked2 = ctx2.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    fast2.claim(answer('first-registered-wins'))
    await expect(asked2).resolves.toEqual(answer('first-registered-wins'))
  })

  it('cancels losing attempts with a SUPERSEDED reason', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const loserSignals: AbortSignal[] = []
    const loser = deferred<AskUserQuestionAnswer | undefined>()
    void ctx.on('user-questions/ask', (_request, signal) => {
      loserSignals.push(signal)
      return loser.promise
    })
    void ctx.on('user-questions/ask', () => Promise.resolve(answer('winner')))

    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })
    await expect(asked).resolves.toEqual(answer('winner'))

    expect(loserSignals).toHaveLength(1)
    expect(loserSignals[0]?.aborted).toBe(true)
    expect(loserSignals[0]?.reason).toMatchObject({ code: 'SUPERSEDED' })
    // A late loser settlement after the race must not disturb the result.
    loser.resolve(answer('too late'))
    await expect(asked).resolves.toEqual(answer('winner'))
  })

  it('discards a late authoritative failure after settlement idempotently', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const late = deferred<AskUserQuestionAnswer | undefined>()
    void ctx.on('user-questions/ask', () => late.promise)
    void ctx.on('user-questions/ask', () => Promise.resolve(answer('winner')))

    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })
    await expect(asked).resolves.toEqual(answer('winner'))

    // The losing channel reports "user cancelled" only after another settled:
    // the guard keeps the winner and does not re-publish or throw.
    late.reject(new UserQuestionError('the user cancelled ask_user_question', 'ASK_CANCELLED'))
    await expect(asked).resolves.toEqual(answer('winner'))
  })

  it('lets an authoritative rejection settle the whole ask while others still race', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const seen: { request: AskUserQuestionRequest; signal: AbortSignal }[] = []
    void ctx.on('user-questions/ask', () =>
      Promise.reject(new UserQuestionError('the user cancelled ask_user_question', 'ASK_CANCELLED')))
    const survivor = gatedAttempt(ctx, { seen })

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_CANCELLED' })
    // The surviving attempt was dispatched concurrently, then cancelled with the
    // settling error as its signal reason.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.signal.aborted).toBe(true)
    expect(seen[0]?.signal.reason).toMatchObject({ code: 'ASK_CANCELLED' })
    survivor.decline()
  })

  it('treats foreign-error rejections and declines alike when nothing claims', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    void ctx.on('user-questions/ask', () => Promise.reject(new Error('channel transport exploded')))
    const declining = gatedAttempt(ctx)
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    // The channel failure freed one slot; the last open attempt keeps the ask
    // alive until it too bows out.
    await new Promise(resolve => setTimeout(resolve, 0))
    let settled = false
    void asked.then(() => { settled = true }, () => { settled = true })
    expect(settled).toBe(false)
    declining.decline()
    await expect(asked).rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })

    // A composition whose attempts all decline fails closed identically.
    const ctx2 = new Context()
    await ctx2.plugin(UserQuestionService)
    const first = gatedAttempt(ctx2)
    const second = gatedAttempt(ctx2)
    const asked2 = ctx2.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })
    first.decline()
    second.decline()
    await expect(asked2).rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('cancels every composed attempt when the caller aborts mid-flight', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const signals: AbortSignal[] = []
    void ctx.on('user-questions/ask', (_request, signal) => {
      signals.push(signal)
      return new Promise<undefined>(() => {})
    })
    void ctx.on('user-questions/ask', (_request, signal) => {
      signals.push(signal)
      return new Promise<undefined>(() => {})
    })
    const controller = new AbortController()
    const asked = ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      signal: controller.signal,
    })

    controller.abort()
    await expect(asked).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_ABORTED' })
    expect(signals).toHaveLength(2)
    for (const signal of signals) {
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toMatchObject({ code: 'ASK_ABORTED' })
    }
  })

  it('races a legacy registerProvider shim against event listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    ctx.userQuestions.registerProvider(provider('legacy'))
    const slow = gatedAttempt(ctx)
    const asked = ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    await expect(asked).resolves.toEqual({ answers: [{ id: 'confirm', selected: ['legacy'] }] })
    slow.decline()
  })
})

describe('raceUserQuestionAttempts engine', () => {
  const request: AskUserQuestionRequest = { questions: [{ id: 'q', question: 'Proceed?' }] }
  const answer = (label: string): AskUserQuestionAnswer => ({ answers: [{ id: 'q', selected: [label] }] })

  it('fails closed with NO_ANSWERER when no attempt exists', async () => {
    await expect(raceUserQuestionAttempts([], request))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_ANSWERER' })
  })

  it('classifies a synchronously throwing attempt by its error type', async () => {
    const authoritative: UserQuestionAttempt = () => {
      throw new UserQuestionError('cancelled before dispatch', 'ASK_CANCELLED')
    }
    await expect(raceUserQuestionAttempts([authoritative], request))
      .rejects.toMatchObject({ code: 'ASK_CANCELLED' })

    const channelFailure: UserQuestionAttempt = () => {
      throw new Error('sync channel crash')
    }
    await expect(raceUserQuestionAttempts([channelFailure], request))
      .rejects.toMatchObject({ code: 'NO_ANSWERER' })
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    let dispatched = 0
    const attempt: UserQuestionAttempt = () => {
      dispatched += 1
      return Promise.resolve(undefined)
    }
    await expect(raceUserQuestionAttempts([attempt], request, AbortSignal.abort()))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(dispatched).toBe(0)
  })

  it('stops listening to the caller signal once some path settled the ask', async () => {
    const gate = deferred<AskUserQuestionAnswer | undefined>()
    const attempt: UserQuestionAttempt = () => gate.promise
    const controller = new AbortController()
    const raced = raceUserQuestionAttempts([attempt], request, controller.signal)

    gate.resolve(answer('claim'))
    await expect(raced).resolves.toEqual(answer('claim'))

    // A caller abort after settlement must not reject the already-settled ask;
    // the listener removal keeps the settled promise untouched.
    controller.abort()
    await expect(raced).resolves.toEqual(answer('claim'))
  })

  it('settles exactly once under both concurrent resolution orders', async () => {
    // Order A: first-scheduled attempt fulfills first, second declines later.
    const aGate = deferred<AskUserQuestionAnswer | undefined>()
    const bGate = deferred<AskUserQuestionAnswer | undefined>()
    const racedA = raceUserQuestionAttempts([
      () => aGate.promise,
      () => bGate.promise,
    ], request)
    bGate.resolve(answer('b-first'))
    await expect(racedA).resolves.toEqual(answer('b-first'))
    aGate.resolve(answer('a-late'))
    await expect(racedA).resolves.toEqual(answer('b-first'))

    // Order B: the mirror interleaving with the same single-settlement guarantee.
    const cGate = deferred<AskUserQuestionAnswer | undefined>()
    const dGate = deferred<AskUserQuestionAnswer | undefined>()
    const racedB = raceUserQuestionAttempts([
      () => cGate.promise,
      () => dGate.promise,
    ], request)
    dGate.resolve(answer('d-first'))
    await expect(racedB).resolves.toEqual(answer('d-first'))
    cGate.reject(new UserQuestionError('late cancel', 'ASK_CANCELLED'))
    await expect(racedB).resolves.toEqual(answer('d-first'))
  })
})
