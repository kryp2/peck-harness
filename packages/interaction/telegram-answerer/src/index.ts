/**
 * @deepseek-ai/dsh-telegram-answerer — an opt-in answerer racing on the `ctx.userQuestions`
 * `'user-questions/ask'` event that asks the human over Telegram. It coexists with the
 * web-GUI answerer: a question dispatched by `ask_user_question` is delivered to every
 * composed channel at the same time and posted to Telegram with tap-selectable inline
 * buttons (when options are present) and free-text replies; the first channel to answer
 * settles the ask, and this attempt is cancelled with its race signal when another wins.
 *
 * Transport is the Telegram Bot API over `ctx.shell` (curl); the tokened URL travels in
 * the command environment, never in argv. Credentials are read per operation from the
 * {@link CredentialProvider} under the refs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`;
 * replies are accepted only from the authorized chat.
 *
 * Replies are correlated to the question they answer: before each ask the plugin drains
 * every update older than the ask by probing the bot's latest `update_id`, and inline
 * button presses are accepted only when they reference the message this ask sent. Asks
 * are serialized, so two concurrent questions never interleave sends and polls.
 *
 * A lost race (or a caller abort) aborts the attempt's race signal: an in-flight
 * long-poll stops at the next loop turn — the running curl is killed through its own
 * signal — and, when the question was already posted and another channel answered,
 * each sent message is edited best-effort to append "(answered elsewhere)". The edit
 * never throws into the winner path; on any other loss (caller abort, host teardown)
 * the sent message is left as-is rather than claiming an answer that did not happen.
 * Channel-internal failures (unconfigured credentials, transport errors, timeout)
 * resolve `undefined`, declining the race so other channels can still answer; only a
 * composition where no channel claims produces the fail-closed `NO_ANSWERER`.
 *
 * @module @deepseek-ai/dsh-telegram-answerer
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import '@deepseek-ai/dsh-user-questions'
import type { ShellExecutor, ShellExecRequest, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Credential refs the answerer reads; a POSIX-style name stored in the credentials store. */
const BOT_TOKEN_REF = credentialRef('TELEGRAM_BOT_TOKEN')
const CHAT_ID_REF = credentialRef('TELEGRAM_CHAT_ID')
const API = 'https://api.telegram.org'

/**
 * Environment entry carrying the tokened Bot API URL for one curl run. Keeping it out
 * of argv means the token is readable only from the process's own environment, not from
 * `/proc/<pid>/cmdline`.
 */
const URL_ENV_VAR = 'TELEGRAM_BOT_URL'

/** One text or callback-button reply from the authorized chat. */
export interface Reply {
  kind: 'text' | 'callback'
  value: string
}

/** Resolved credentials, or undefined while unconfigured. */
export interface TelegramConfig {
  token: string
  chatId: string
}

/** Mutable per-plugin bot state shared by every serialized ask. */
interface BotSession {
  /**
   * Next `getUpdates` offset — one past the highest consumed `update_id`. Undefined
   * until a drain establishes that no older update can still be delivered.
   */
  cursor?: number
}

/** The identity and text of one sent question message, for reply correlation and loser edits. */
interface SentQuestion {
  /** `message_id` of the message this ask posted, as Telegram returned it. */
  messageId: string
  /** Exact text the message was sent with; `editMessageText` replaces the whole text. */
  text: string
}

/** One raw `getUpdates` entry subset this answerer consumes. */
interface TelegramUpdate {
  update_id?: number
  callback_query?: {
    from?: { id?: string | number }
    data?: string
    message?: { message_id?: string | number }
  }
  message?: { chat?: { id?: string | number }; from?: { id?: string | number }; text?: string }
}

/** Decoded Telegram Bot API envelope subset this answerer consumes. */
interface TelegramEnvelope {
  ok?: boolean
  description?: string
  result?: unknown
}

/** Resolved answer shape, reused from the answer type for the pure helpers. */
type AnswerItem = AskUserQuestionAnswer['answers'][number]

/** Telegram `reply_markup.inline_keyboard`: one row per option, `callback_data: opt:N[:nonce]`. */
export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /** Answer timeout in milliseconds; the ask is withdrawn (falls through) when exceeded. */
  timeoutMs?: number
}

export const name = 'telegram-answerer'

/** Optional services only: the answerer degrades to a no-op when Telegram is not configured. */
export const inject: string[] = []

/**
 * Build the inline keyboard for one question, or undefined without options. When a
 * nonce is supplied each `callback_data` carries it as an `opt:N:nonce` suffix so a
 * press is bound to the exact sent message generation even before correlation runs.
 * @param question - the question whose options become buttons.
 * @param nonce - optional per-question suffix embedded in every callback value.
 * @returns the keyboard, or undefined when the question offers no options.
 */
export function keyboardFor(question: AskUserQuestionItem, nonce?: string): InlineKeyboard | undefined {
  if (!Array.isArray(question.options) || question.options.length === 0) return undefined
  return {
    inline_keyboard: question.options.map((option, index) => [{
      text: option.label.slice(0, 64),
      callback_data: nonce === undefined ? `opt:${index}` : `opt:${index}:${nonce}`,
    }]),
  }
}

/**
 * Render one question as the plain-text body posted to Telegram (options are buttons).
 * @param question - the question to render.
 * @param index - zero-based position in the batch, for the [n/m] prefix.
 * @param total - the batch size.
 * @returns the message text.
 */
export function formatQuestion(question: AskUserQuestionItem, index: number, total: number): string {
  let text = total > 1 ? `[${index + 1}/${total}] ` : ''
  if (question.header !== undefined) text += `${question.header}\n`
  text += question.question
  if (question.detail !== undefined) text += `\n\n${question.detail}`
  return text
}

/**
 * Map a callback value (`opt:N`, optionally `opt:N:nonce`) or a free-text reply back to
 * a structured answer item.
 * @param reply - the received reply.
 * @param question - the question the reply answers.
 * @returns the answer item (custom carries free text; selected carries the button label).
 */
export function answerItemFor(reply: Reply, question: AskUserQuestionItem): AnswerItem {
  if (reply.kind === 'callback') {
    const match = /^opt:(\d+)(?::[0-9a-f]+)?$/.exec(reply.value)
    const captured = match?.[1]
    if (captured !== undefined) {
      const index = parseInt(captured, 10)
      const option = question.options?.[index]
      if (option !== undefined) return { id: question.id, selected: [option.label] }
    }
  }
  const trimmed = reply.value.trim()
  if (trimmed.length > 0) return { id: question.id, selected: [], custom: trimmed }
  return { id: question.id, selected: [] }
}

const outText = (result: ShellRunResult): string => result.stdout.text

/**
 * Read the answerer's credentials once per operation.
 * @param credentials - the ambient credential provider.
 * @returns the token + authorized chat id, or undefined while unconfigured.
 */
async function resolveConfig(credentials: CredentialProvider): Promise<TelegramConfig | undefined> {
  const token = await credentials.resolve(BOT_TOKEN_REF)
  const chatId = await credentials.resolve(CHAT_ID_REF)
  if (token === undefined || chatId === undefined) return undefined
  return { token: token.value, chatId: chatId.value }
}

/** Marker appended to a sent question when another channel answered it first. */
const ANSWERED_ELSEWHERE = '(answered elsewhere)'

/**
 * Run one Telegram Bot API call through curl and decode its envelope. The tokened URL
 * reaches curl through {@link URL_ENV_VAR}, never through the command line; a non-ok
 * envelope, unparseable output, or failed transport throws so callers fail closed.
 * When `signal` is supplied it rides the shell request, so a cancelled attempt kills
 * the running curl instead of waiting out its `-m` ceiling.
 * @param shell - the shell executor.
 * @param config - the resolved telegram credentials.
 * @param pathAndQuery - method path plus query string, e.g. `getUpdates?offset=-1`.
 * @param body - JSON request body to post, or undefined for a plain GET.
 * @param signal - cancellation signal forwarded to the shell run, or undefined.
 * @returns the decoded `ok: true` envelope.
 */
async function telegramFetch(
  shell: ShellExecutor,
  config: TelegramConfig,
  pathAndQuery: string,
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal,
): Promise<TelegramEnvelope> {
  const url = `${API}/bot${config.token}/${pathAndQuery}`
  const command = body === undefined
    ? `curl -s -m 45 "$${URL_ENV_VAR}"`
    : `curl -s -m 20 -X POST -H 'Content-Type: application/json' --data-binary @- "$${URL_ENV_VAR}"`
  const request: ShellExecRequest = {
    command,
    env: { [URL_ENV_VAR]: url },
    ...(signal === undefined ? {} : { signal }),
    ...(body === undefined ? {} : { stdin: JSON.stringify(body) }),
  }
  const result = await shell.run(shell.resolve(request))
  const text = outText(result)
  let decoded: TelegramEnvelope
  try {
    decoded = JSON.parse(text) as TelegramEnvelope
  } catch {
    const exit = result.exitCode !== null && result.exitCode !== 0 ? ` (exit ${result.exitCode})` : ''
    throw new Error(`Telegram ${pathAndQuery.split('?')[0]} returned non-JSON output${exit}`)
  }
  if (decoded.ok !== true) {
    throw new Error(`Telegram ${pathAndQuery.split('?')[0]} failed: ${decoded.description ?? text.slice(0, 200)}`)
  }
  return decoded
}

/**
 * Narrow one unknown `getUpdates` entry to the update subset, or undefined.
 * @param update - one decoded result element.
 * @returns the update view, or undefined when the entry is not an object.
 */
function asUpdate(update: unknown): TelegramUpdate | undefined {
  return typeof update === 'object' && update !== null ? update : undefined
}

/**
 * Drain history so no update older than the current ask can ever be delivered: probe
 * the bot's latest update with the negative offset (which returns only that update and
 * confirms nothing), then park the cursor just past it. A session whose cursor is
 * already established skips the probe. When the bot has no pending updates the cursor
 * stays unset and polling simply long-polls for updates newer than right now.
 * @param shell - the shell executor.
 * @param config - the resolved telegram credentials.
 * @param bot - the serialized bot session whose cursor is established.
 */
async function establishCursor(shell: ShellExecutor, config: TelegramConfig, bot: BotSession): Promise<void> {
  if (bot.cursor !== undefined) return
  const decoded = await telegramFetch(shell, config, 'getUpdates?timeout=0&offset=-1', undefined)
  const updates = Array.isArray(decoded.result) ? decoded.result : []
  const last = asUpdate(updates[updates.length - 1])
  if (typeof last?.update_id === 'number') bot.cursor = last.update_id + 1
}

/**
 * Post one question to Telegram, with inline buttons when options are present, and
 * return the sent message's identity for reply correlation and loser edits. The text
 * carries the nonce so a human-visible reference exists for the binding the callback
 * data enforces.
 * @param shell - the shell executor.
 * @param config - the resolved telegram credentials.
 * @param question - the question to post.
 * @param index - zero-based batch position.
 * @param total - batch size.
 * @param nonce - unpredictable per-question value embedded in text and callbacks.
 * @returns the sent message's `message_id` and exact text, as strings.
 */
async function sendQuestion(
  shell: ShellExecutor,
  config: TelegramConfig,
  question: AskUserQuestionItem,
  index: number,
  total: number,
  nonce: string,
): Promise<SentQuestion> {
  const text = `🤖 ${formatQuestion(question, index, total)}\n\n(q:${nonce})`
  const body: Record<string, unknown> = { chat_id: config.chatId, text }
  const keyboard = keyboardFor(question, nonce)
  if (keyboard !== undefined) body.reply_markup = keyboard
  const decoded = await telegramFetch(shell, config, 'sendMessage', body)
  const sent = typeof decoded.result === 'object' && decoded.result !== null
    ? decoded.result as { message_id?: string | number }
    : undefined
  if (sent?.message_id === undefined) throw new Error('Telegram sendMessage returned no message id')
  return { messageId: String(sent.message_id), text }
}

/**
 * Long-poll `getUpdates` until a reply from the authorized chat arrives, the ceiling
 * elapses, or the attempt is cancelled. The bot session's cursor persists across polls
 * and asks, so once the drain has run no pre-question update is ever delivered again.
 * Callback presses must reference the sent message's id — a stale press on an earlier
 * question's keyboard is ignored. Free-text replies are accepted from the authorized
 * chat: after the drain only updates newer than the question can arrive. Cancellation
 * is observed promptly: an aborted `signal` ends the wait at the next loop turn, and
 * the signal rides each curl so an in-flight long-poll is killed instead of waiting
 * out its transport timeout; the caller then treats the attempt as declined.
 * @param shell - the shell executor.
 * @param config - the resolved telegram credentials.
 * @param bot - the serialized bot session owning the update cursor.
 * @param expected - the sent message this poll's replies must correlate to.
 * @param timeoutMs - a hard ceiling for the whole wait; exceeded means no answer.
 * @param signal - race signal for this attempt; aborted means the outcome no longer matters.
 * @returns the reply, or undefined when the deadline or cancellation ended the wait.
 */
async function pollReply(
  shell: ShellExecutor,
  config: TelegramConfig,
  bot: BotSession,
  expected: SentQuestion,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Reply | undefined> {
  const deadline = Date.now() + timeoutMs
  // Indirection on purpose: reading through the loop condition narrows
  // `signal.aborted` for the rest of the body, while an abort can land at any
  // await point inside it.
  const cancelled = (): boolean => signal.aborted
  while (!cancelled()) {
    if (Date.now() > deadline) return undefined
    let decoded: TelegramEnvelope
    try {
      const query = bot.cursor === undefined ? 'getUpdates?timeout=25' : `getUpdates?timeout=25&offset=${bot.cursor}`
      decoded = await telegramFetch(shell, config, query, undefined, signal)
    } catch {
      // Transient transport or Telegram-side failure — or the cancellation that
      // killed the running curl. Either way stop waiting on an aborted attempt;
      // otherwise back off and keep waiting until the ceiling.
      if (cancelled()) return undefined
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    const fromAuthorizedChat = (id: string | number | undefined): boolean => String(id ?? '') === config.chatId
    const correlates = (message: { message_id?: string | number } | undefined): boolean =>
      message !== undefined && String(message.message_id) === expected.messageId
    for (const raw of Array.isArray(decoded.result) ? decoded.result : []) {
      const update = asUpdate(raw)
      if (update === undefined) continue
      if (typeof update.update_id === 'number') bot.cursor = Math.max(bot.cursor ?? update.update_id, update.update_id) + 1
      const callback = update.callback_query
      if (callback !== undefined) {
        if (!fromAuthorizedChat(callback.from?.id)) continue
        if (!correlates(callback.message)) continue
        if (callback.data !== undefined) return { kind: 'callback', value: callback.data }
        continue
      }
      const message = update.message
      if (message === undefined) continue
      if (!fromAuthorizedChat(message.chat?.id ?? message.from?.id)) continue
      if (message.text !== undefined && message.text.length > 0) return { kind: 'text', value: message.text }
    }
  }
  return undefined
}

/**
 * Edit every message this attempt sent, appending the answered-elsewhere marker.
 * Best-effort by design: each edit runs detached and a failed or rejected edit is
 * swallowed (named here) so loser cleanup can never throw into the winner path —
 * a stale unedited question is the accepted fallback.
 * @param shell - the shell executor.
 * @param config - the resolved telegram credentials.
 * @param sent - the messages the lost attempt posted, in send order.
 */
function markAnsweredElsewhere(shell: ShellExecutor, config: TelegramConfig, sent: readonly SentQuestion[]): void {
  for (const message of sent) {
    const edit = telegramFetch(shell, config, 'editMessageText', {
      chat_id: config.chatId,
      message_id: message.messageId,
      text: `${message.text}\n\n${ANSWERED_ELSEWHERE}`,
    })
    // Swallowed on purpose: the question was already answered elsewhere; an
    // unreachable edit only leaves the older text visible in the chat.
    edit.catch(() => {})
  }
}

/**
 * Register a Telegram answerer on the `user-questions/ask` racing event. When Telegram
 * is unconfigured or unreachable the attempt resolves `undefined`, declining so another
 * answerer can answer; with no claiming channel at all the service fails closed. Asks
 * are serialized behind one queue: a later question waits for the earlier ask to settle,
 * so two concurrent asks never interleave sends and polls against one chat. An attempt
 * whose race signal is already aborted when its queue turn arrives skips without
 * touching Telegram; a signal aborting mid-poll stops the poll promptly.
 * @param ctx - Cordis context; reads `shell` and `credentials` optionally.
 * @param config - plugin config (timeout ceiling).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const shell = ctx.get('shell')
  const credentials = ctx.get('credentials')
  if (shell === undefined || credentials === undefined) return
  const ceilingMs = config.timeoutMs ?? 30 * 60 * 1000
  const bot: BotSession = {}
  let tail: Promise<unknown> = Promise.resolve()

  ctx.on('user-questions/ask', (request: AskUserQuestionRequest, race: AbortSignal) => {
    // Single cancellation probe on purpose: reading the property directly lets
    // control-flow narrowing freeze it after the first check, while an abort
    // can land at any await point of the serialized attempt.
    const cancelled = (): boolean => race.aborted
    const attempt = tail.catch(() => {}).then(async (): Promise<AskUserQuestionAnswer | undefined> => {
      // Cancelled while queued behind an earlier ask: leave without touching Telegram.
      if (cancelled()) return undefined
      const telegram = await resolveConfig(credentials)
      if (telegram === undefined) return undefined
      await establishCursor(shell, telegram, bot)
      const answers: AnswerItem[] = []
      const sentQuestions: SentQuestion[] = []
      // Set only when every question of the batch was answered. The winner must
      // never edit its own messages even though settling the race aborts its
      // signal too — the flag makes that independent of microtask ordering, and
      // the indirection keeps control-flow narrowing from hiding it.
      let claimed = false
      const hasClaimed = (): boolean => claimed
      let index = 0
      try {
        for (const question of request.questions) {
          const nonce = randomUUID().replace(/-/g, '').slice(0, 8)
          const sent = await sendQuestion(shell, telegram, question, index, request.questions.length, nonce)
          sentQuestions.push(sent)
          const reply = await pollReply(shell, telegram, bot, sent, ceilingMs, race)
          if (reply === undefined) return undefined
          answers.push(answerItemFor(reply, question))
          index += 1
        }
        claimed = true
        return { answers }
      } finally {
        // Loser cleanup for a posted-but-unchosen batch: only a SUPERSEDED loss
        // may claim "answered elsewhere"; a caller abort or teardown leaves the
        // messages untouched because no other channel did answer them.
        const reason: unknown = race.reason
        if (!hasClaimed() && cancelled() && reason instanceof UserQuestionError && reason.code === 'SUPERSEDED') {
          markAnsweredElsewhere(shell, telegram, sentQuestions)
        }
      }
    })
    tail = attempt
    // Claim the question on success; decline (`undefined`) on any failure so the
    // remaining channels keep racing.
    return attempt
  })
}
