/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages register
 * answerers on the `'user-questions/ask'` event and race for each question.
 *
 * @module @deepseek-ai/dsh-user-questions
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'

declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }

  interface Events {
    /**
     * One racing attempt of a human-answer dispatch. Every composed answerer is
     * invoked with the same request at the same time (true racing, not a
     * sequential chain): resolve with an answer to claim the question, resolve
     * `undefined` to decline (the channel cannot or will not answer — the ask
     * stays open for the other attempts), and reject only to report an
     * authoritative failure in the seam's error taxonomy, which settles the
     * whole ask for every channel. The first settlement wins; losing attempts
     * receive `signal` aborted with a {@link UserQuestionError} reason naming
     * why (`SUPERSEDED`, or the caller's own abort error). With no attempter
     * composed, or after every attempt declined or failed as a channel, the
     * fail-closed default applies (`UserQuestionError` code `NO_ANSWERER`).
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only that agent's questions.
     * @param req - the pending question set (questions, owner agent).
     * @param signal - race signal, aborted once this attempt can no longer
     *   affect the outcome; its `reason` carries the settling error.
     * @mode parallel
     */
    'user-questions/ask'(this: Scoped<UserQuestionService>, req: AskUserQuestionRequest, signal: AbortSignal): Promise<AskUserQuestionAnswer | undefined>
  }
}

import type { AskUserQuestionAnswer, AskUserQuestionItem } from './types.ts'

export type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem,
  AskUserQuestionOption,
} from './types.ts'

/** Request for a human answer. */
export interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}

/** UI-side provider for user questions. */
export interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

/**
 * One answerer invocation contract on the `'user-questions/ask'` event:
 * resolve with an answer to claim, with `undefined` to decline, or reject
 * with a {@link UserQuestionError} to settle the whole ask authoritatively.
 */
export type UserQuestionAttempt = (
  request: AskUserQuestionRequest,
  signal: AbortSignal,
) => Promise<AskUserQuestionAnswer | undefined>

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

/** The fail-closed rejection every composition without a claiming answerer produces. */
const noAnswererError = (): UserQuestionError =>
  new UserQuestionError('no user-questions answerer is composed', 'NO_ANSWERER')

/** The caller-side withdrawal rejection, also used as other attempts' cancellation reason. */
const askAbortedError = (): UserQuestionError =>
  new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')

/** The cancellation reason handed to attempts that lost the race to another answerer. */
const supersededError = (): UserQuestionError =>
  new UserQuestionError('another answerer claimed this question first', 'SUPERSEDED')

/**
 * Race composed answerer attempts against each other and settle exactly once.
 *
 * Every attempt is invoked with the same request and one shared race signal.
 * The first fulfillment claims the ask; the remaining attempts observe the
 * signal aborted with a `SUPERSEDED` reason. A {@link UserQuestionError}
 * rejection is authoritative and settles the whole ask with that error (a
 * channel speaking the seam's taxonomy asserts a terminal state — e.g. the web
 * GUI's "user cancelled"); any other rejection is a channel failure and only
 * frees that attempt's slot. When every attempt declined or failed as a
 * channel, the ask rejects with `NO_ANSWERER`. A caller abort settles
 * `ASK_ABORTED` and cancels all attempts with the same error as their signal
 * reason. The settlement guard is synchronous, so exactly one resolution path
 * wins no matter how attempt promises interleave; late fulfillments after
 * settlement are discarded idempotently.
 *
 * @param attempts - the resolved answerer callbacks for this dispatch.
 * @param request - the pending question set passed through to each attempt.
 * @param callerSignal - the owning tool/step abort signal, raced against the attempts.
 * @returns the first claimed answer.
 * @throws {UserQuestionError} `NO_ANSWERER` when there are no attempts or none claims,
 *   `ASK_ABORTED` when the caller signal fires first, or the authoritative
 *   {@link UserQuestionError} of the first attempt that rejected with one.
 */
export function raceUserQuestionAttempts(
  attempts: readonly UserQuestionAttempt[],
  request: AskUserQuestionRequest,
  callerSignal?: AbortSignal,
): Promise<AskUserQuestionAnswer> {
  return new Promise<AskUserQuestionAnswer>((resolveAsk, rejectAsk) => {
    const raceController = new AbortController()
    let settled = false
    let openAttempts = attempts.length
    const onCallerAbort = (): void => { settle(askAbortedError()) }

    /** Settle the whole ask with `outcome`, cancel the losers, then release the caller. */
    const settle = (outcome: AskUserQuestionAnswer | UserQuestionError): void => {
      if (settled) return
      settled = true
      if (callerSignal !== undefined) callerSignal.removeEventListener('abort', onCallerAbort)
      // Cancel the losers before the winner's continuation runs, so loser
      // cleanup observes its reason synchronously ahead of settlement.
      raceController.abort(outcome instanceof UserQuestionError ? outcome : supersededError())
      if (outcome instanceof UserQuestionError) rejectAsk(outcome)
      else resolveAsk(outcome)
    }

    /** Free one slot; an ask whose attempts all bowed out fails closed. */
    const releaseSlot = (): void => {
      openAttempts -= 1
      if (openAttempts === 0 && !settled) settle(noAnswererError())
    }

    /** Classify one attempt rejection: seam-taxonomy errors settle, foreign errors decline. */
    const classifyRejection = (error: unknown): void => {
      if (error instanceof UserQuestionError) settle(error)
      else releaseSlot()
    }

    if (callerSignal !== undefined) {
      // Synchronous re-check beside the listener registration: an abort that
      // fired between the pre-dispatch validation and this executor would
      // register a listener on an already-settled signal — never invoked.
      if (callerSignal.aborted) {
        settle(askAbortedError())
        return
      }
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }

    if (attempts.length === 0) {
      settle(noAnswererError())
      return
    }

    for (const attempt of attempts) {
      let claimed: Promise<AskUserQuestionAnswer | undefined>
      try {
        claimed = attempt(request, raceController.signal)
      } catch (error) {
        // A synchronous throw carries the same meaning as a rejection.
        classifyRejection(error)
        continue
      }
      void claimed.then(
        (answer) => {
          if (answer !== undefined) settle(answer)
          else releaseSlot()
        },
        (error: unknown) => { classifyRejection(error) },
      )
    }
  })
}

/**
 * `ctx.userQuestions`: the human-answer seam. Answerers register on the
 * `'user-questions/ask'` event; `ask()` invokes them concurrently and returns
 * the first claimed answer.
 */
export class UserQuestionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  /**
   * Register one answerer that collects the human answer. Retained as a shim
   * over the {@link 'user-questions/ask'} event: it registers a listener that
   * calls the provider's `ask`. New answerers should register on the event
   * directly (`ctx.on('user-questions/ask', ...)`) so multiple channels can
   * race the same question and the first answer wins.
   *
   * @param provider UI-side implementation that collects answers.
   * @returns Disposer that unregisters this provider.
   */
  registerProvider(provider: UserQuestionProvider): () => void {
    return this.ctx.on('user-questions/ask', (request: AskUserQuestionRequest) => provider.ask(request))
  }

  /**
   * Ask the composed answerers and wait for the first human answer.
   *
   * When a caller supplies an agent, human interaction is valid only for the
   * exact live runtime root. Runtime ownership, not durable session lineage,
   * decides this boundary: an owned child has no human answerer and would
   * block forever, while a lineage-bearing session resumed as a new runtime
   * root may ask normally.
   *
   * @param request Questions, owner agent, and abort signal.
   * @returns The answer chosen or typed by the human.
   * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
   *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
   *   when that live agent is owned by another agent, or `NO_ANSWERER` when
   *   no answerer is composed (fail closed).
   */
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
    }
    if (request.questions.length === 0) {
      throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    }
    const agent = request.agent
    if (agent !== undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined || agents.get(agent.id) !== agent) {
        throw new UserQuestionError(
          'human interaction requires the exact live calling agent when an agent is supplied',
          'CALLER_NOT_LIVE')
      }
      if (!agents.roots().includes(agent)) {
        throw new UserQuestionError(
          'human interaction is unavailable while the calling agent is owned by another live agent; '
          + "include the unresolved question or decision in the child agent's final result",
          'DELEGATED_CALLER')
      }
    }
    // A presentation intent asserts two things the types cannot: that the
    // named approve label is one of this question's own options, and that a
    // plan-review carries the plan it is a review of. A UI honouring the
    // intent answers with that label, and shows that detail as the plan, so
    // either gap would put a choice the asker never offered — or an approval of
    // something invisible — in front of the user. Caught at the asker, where
    // the mistake is, rather than in each UI.
    for (const question of request.questions) {
      const intent = question.intent
      if (intent === undefined) continue
      if (!(question.options ?? []).some(option => option.label === intent.approve)) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} whose approve label `
          + `${JSON.stringify(intent.approve)} names none of its options`,
          'BAD_INTENT')
      }
      if (question.detail === undefined) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} without the detail it reviews`,
          'BAD_INTENT')
      }
    }
    // Resolve the racing field once, through the bus: Cordis owns listener
    // resolution, scope-chain filtering (agent-scoped answerers see only their
    // agent's questions), and fiber-owned disposal. The bus hands back the
    // filtered callbacks without running them; the race engine below invokes
    // every one concurrently. The Events declaration above types each listener,
    // so the single untyped boundary here is a shape the compiler cannot carry
    // across `dispatch`'s `any[]` signature.
    const attempts = this.ctx.events.dispatch(
      'parallel', [scopeTarget(this, request.agent), 'user-questions/ask', request],
    ) as unknown as UserQuestionAttempt[]
    return await raceUserQuestionAttempts(attempts, request, request.signal)
  }
}

export default UserQuestionService
