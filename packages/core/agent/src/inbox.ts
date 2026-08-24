/**
 * Incremental projection of durable agent inbox events.
 *
 * @module @deepseek-ai/dsh-agent/inbox
 */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import type { InboxTarget } from './types.ts'

/**
 * One queued input as splices written before the full message representation
 * stored it: the bare prompt text, or an object without message fields.
 */
type LegacyInboxEntry = string | null | { [key: string]: unknown }

/**
 * One `inserted` element exactly as the durable log holds it. Current writers
 * commit {@link UserMessage} values, while logs written before that
 * representation existed store {@link LegacyInboxEntry} placeholders; the
 * durable event keeps whatever its writer committed.
 */
type PersistedInboxEntry = UserMessage | LegacyInboxEntry

/**
 * Whether one persisted entry already carries the full message representation.
 * Writers commit `id`, `content`, and `source` together, so the presence of
 * `source` distinguishes shaped messages from legacy placeholders; every
 * consumer reads all three fields unconditionally.
 */
function isShapedUserMessage(entry: PersistedInboxEntry): entry is UserMessage {
  return typeof entry === 'object' && entry !== null && 'source' in entry
}

/**
 * Repair one persisted inbox entry that predates the full message
 * representation: those splices stored the queued prompt as raw text, so
 * replaying them puts a bare string where every consumer reads `id`, `content`,
 * and `source`. The slot is preserved rather than dropped because later splices
 * in the same log address positions, and the text survives as the message body.
 * @param entry - one `inserted` element as the durable log holds it.
 * @param seq - session seq of the splice event, for a stable repaired identity.
 * @param index - position within that splice, for a stable repaired identity.
 * @returns the entry unchanged when it is already a message, else its repair.
 */
function repairPersistedEntry(entry: PersistedInboxEntry, seq: number, index: number): UserMessage {
  if (isShapedUserMessage(entry)) return entry
  const text: string = typeof entry === 'string' ? entry : JSON.stringify(entry)
  return {
    id: `legacy-inbox-${String(seq)}-${String(index)}` as MessageId,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'legacy-inbox-entry' },
  }
}

/** Mutable state privately owned by an {@link Inbox}. */
type InboxState = Record<InboxTarget, UserMessage[]>

/** Live notifications committed by inbox mutations. */
export interface InboxNotifications {
  /** Publish one inserted message. */
  inserted(message: UserMessage): void
  /** Publish one discarded message. */
  discarded(message: UserMessage): void
  /** Publish one claimed message inside its owning turn. */
  claimed(message: UserMessage, turn: number): void
}

/** A replay-once projection that incrementally consumes later inbox splices. */
export class Inbox {
  private readonly state: InboxState = { 'next-turn': [], 'next-step': [] }

  constructor(
    private readonly session: Session,
    private readonly notifications: InboxNotifications,
  ) {
    for (const event of session.events.slice(session.header.seedLength ?? 0)) {
      if (event.type !== 'agent/inbox/spliced') continue
      try {
        this.apply({
          ...event.data,
          inserted: event.data.inserted.map((entry, index) => repairPersistedEntry(entry, event.seq, index)),
        })
      } catch (error: unknown) {
        throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error })
      }
    }
  }

  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[] {
    return this.state['next-turn']
  }

  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[] {
    return this.state['next-step']
  }

  /** Whether either pending-message list contains work. */
  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0
  }

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void {
    this.splice('next-step', 0, this.nextStep.length, [])
    this.splice('next-turn', 0, this.nextTurn.length, [])
  }

  /**
   * Remove and return the complete batch proposed for one step, publishing
   * each claimed message. The durable splices are pure deletions.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested.
   * @internal - The agent loop's step-boundary operation, not a plugin extension point.
   */
  claim(target: InboxTarget, turn: number): UserMessage[] {
    const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
    if (target === 'next-turn') {
      claimed.push(...this.mutate('next-turn', 0, 1, [], false))
    }
    for (const message of claimed) this.notifications.claimed(message, turn)
    return claimed
  }

  /**
   * Append one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to append.
   * @throws if the message identity is already pending.
   */
  append(target: InboxTarget, message: UserMessage): void {
    this.splice(target, this.state[target].length, 0, [message])
  }

  /**
   * Prepend one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   * @throws if the message identity is already pending.
   */
  prepend(target: InboxTarget, message: UserMessage): void {
    this.splice(target, 0, 0, [message])
  }

  /**
   * Replace one pending message in place, possibly changing its identity. A
   * successful replacement publishes the old message as discarded and the new
   * message as inserted.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   * @throws if the replacement duplicates another pending message identity.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [newMessage])
    return true
  }

  /**
   * Remove one pending message and durably record its cancellation.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [])
    return true
  }

  /**
   * Apply standard splice semantics and durably record the normalized result.
   * The durable event commits before the live projection mutates, so synchronous
   * `session/event` observers see the pre-splice lists and can reconstruct the
   * removed messages from the normalized coordinates.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  splice(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
  ): UserMessage[] {
    return this.mutate(target, start, deleteCount, inserted, true)
  }

  /** Locate one pending identity across both owned lists. */
  private locate(messageId: MessageId): { target: InboxTarget; index: number } | undefined {
    for (const target of ['next-turn', 'next-step'] as const) {
      const index = this.state[target].findIndex(message => message.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }

  /** Commit one normalized mutation and publish its live notifications. */
  private mutate(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    discardRemoved: boolean,
  ): UserMessage[] {
    const inbox = this.state[target]
    const truncatedStart = Math.trunc(start)
    const offset = Number.isNaN(truncatedStart) ? 0 : truncatedStart
    const actualStart = offset < 0
      ? Math.max(inbox.length + offset, 0)
      : Math.min(offset, inbox.length)
    const truncatedDeleteCount = Math.trunc(deleteCount)
    const actualDeleteCount = Math.min(
      Math.max(Number.isNaN(truncatedDeleteCount) ? 0 : truncatedDeleteCount, 0),
      inbox.length - actualStart,
    )
    if (actualDeleteCount === 0 && inserted.length === 0) return []
    const outcome = discardRemoved && actualDeleteCount > 0 ? 'canceled' as const : undefined
    const splice = {
      target,
      start: actualStart,
      ...(actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount }),
      inserted,
      ...(outcome === undefined ? {} : { outcome }),
    }
    this.validate(splice)
    const event = this.session.append('agent/inbox/spliced', splice)
    const removed = inbox.splice(actualStart, actualDeleteCount, ...event.data.inserted)
    if (discardRemoved) {
      for (const message of removed) this.notifications.discarded(message)
    }
    for (const message of event.data.inserted) this.notifications.inserted(message)
    return removed
  }

  /** Apply one normalized durable splice to the projection. */
  private apply(splice: SessionEventMap['agent/inbox/spliced']): UserMessage[] {
    this.validate(splice)
    const inbox = this.state[splice.target]
    return inbox.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  }

  /** Validate one normalized splice against the current projection. */
  private validate(splice: SessionEventMap['agent/inbox/spliced']): void {
    const inbox = this.state[splice.target]
    const removedCount = splice.removedCount ?? 0
    if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length
      || !Number.isSafeInteger(removedCount) || removedCount < 0
      || splice.start + removedCount > inbox.length) {
      throw new Error('invalid inbox splice')
    }
    const candidate = inbox.toSpliced(splice.start, removedCount, ...splice.inserted)
    const ids = new Set<string>()
    for (const message of splice.target === 'next-turn'
      ? [...candidate, ...this.nextStep]
      : [...this.nextTurn, ...candidate]) {
      if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
      ids.add(message.id)
    }
  }
}
