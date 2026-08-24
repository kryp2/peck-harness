import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import { Inbox } from '@deepseek-ai/dsh-agent'

/**
 * Log an inbox splice whose inserted entries are raw legacy shapes — the form
 * old logs hold before the full message representation existed. The durable
 * event keeps whatever was handed to it, so this reproduces a persisted log
 * that predates the repair.
 */
function appendRaw(
  session: Session,
  splice: { target: 'next-turn' | 'next-step'; start?: number; removedCount?: number; inserted: unknown[] },
) {
  const event = session.append('agent/inbox/spliced', {
    target: splice.target,
    start: splice.start ?? 0,
    ...splice.removedCount === undefined ? {} : { removedCount: splice.removedCount },
    inserted: splice.inserted,
  } as unknown as SessionEventMap['agent/inbox/spliced'])
  return event
}

/** The text of a repaired or shaped message's first content part. */
function textOf(message: UserMessage): string {
  const part = message.content[0]
  return part !== undefined && part.type === 'text' ? part.text : ''
}

describe('Inbox replay of legacy inbox entries', () => {
  it('repairs a raw legacy string entry with stable identity, content, and source', () => {
    const session = Session.create(SessionId('legacy-string'))
    const notifications = { inserted: vi.fn(), discarded: vi.fn(), claimed: vi.fn() }
    const event = appendRaw(session, { target: 'next-turn', inserted: ['the queued prompt'] })

    const inbox = new Inbox(session, notifications)

    // Replay rebuilds the projection silently; consumers read state afterwards.
    expect(inbox.nextTurn).toHaveLength(1)
    expect(inbox.nextTurn[0]).toEqual({
      id: `legacy-inbox-${event.seq}-0`,
      role: 'user',
      content: [{ type: 'text', text: 'the queued prompt' }],
      source: { kind: 'plugin', plugin: 'legacy-inbox-entry' },
    })
    expect(notifications.inserted).not.toHaveBeenCalled()
    expect(notifications.discarded).not.toHaveBeenCalled()
  })

  it('repairs a non-string legacy entry through its JSON form and keeps later entries intact', () => {
    const session = Session.create(SessionId('legacy-mixed'))
    const notifications = { inserted: vi.fn(), discarded: vi.fn(), claimed: vi.fn() }
    const shaped = createUserMessage({ content: [{ type: 'text', text: 'normal' }], source: { kind: 'user' } })
    const legacyObject = { text: 'half-formed' }
    appendRaw(session, { target: 'next-turn', inserted: [legacyObject, shaped] })

    const inbox = new Inbox(session, notifications)

    expect(inbox.nextTurn[0]).toMatchObject({
      id: `legacy-inbox-${session.events.at(-1)?.seq}-0`,
      content: [{ type: 'text', text: JSON.stringify(legacyObject) }],
      source: { kind: 'plugin', plugin: 'legacy-inbox-entry' },
    })
    // An entry that already carries the message shape passes through the repair
    // unchanged (the durable log clones event data, so equality is structural).
    expect(inbox.nextTurn[1]).toEqual(shaped)
  })

  it('applies a later positional splice over repaired entries and claims them in order', () => {
    const session = Session.create(SessionId('legacy-splice'))
    const notifications = { inserted: vi.fn(), discarded: vi.fn(), claimed: vi.fn() }
    const first = appendRaw(session, { target: 'next-turn', inserted: ['raw prompt'] })
    // A later splice prepends one shaped message ahead of the repaired slot,
    // addressing positions exactly as a live prepend would.
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [createUserMessage({ content: [{ type: 'text', text: 'newer' }], source: { kind: 'user' } })],
    })

    const inbox = new Inbox(session, notifications)
    // One step claims the step batch plus a single queued turn message.
    const firstClaim = inbox.claim('next-turn', 7)

    expect(firstClaim.map(message => textOf(message))).toEqual(['newer'])
    expect(inbox.nextTurn.map(message => textOf(message))).toEqual(['raw prompt'])

    const secondClaim = inbox.claim('next-turn', 8)
    expect(secondClaim).toHaveLength(1)
    expect(secondClaim[0]).toEqual({
      id: `legacy-inbox-${first.seq}-0`,
      role: 'user',
      content: [{ type: 'text', text: 'raw prompt' }],
      source: { kind: 'plugin', plugin: 'legacy-inbox-entry' },
    })
    expect(notifications.claimed).toHaveBeenCalledTimes(2)
    expect(inbox.hasPending).toBe(false)
  })

  it('locates a repaired identity for removal after replay', () => {
    const session = Session.create(SessionId('legacy-remove'))
    const notifications = { inserted: vi.fn(), discarded: vi.fn(), claimed: vi.fn() }
    const event = appendRaw(session, { target: 'next-step', inserted: ['queued work'] })

    const inbox = new Inbox(session, notifications)
    const repairedId = `legacy-inbox-${event.seq}-0` as UserMessage['id']
    expect(inbox.remove(repairedId)).toBe(true)
    expect(inbox.hasPending).toBe(false)
    expect(notifications.discarded).toHaveBeenCalledTimes(1)
  })
})
