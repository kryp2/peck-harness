/**
 * The `usageByRoute` projection unit: mounting the plugin beside the
 * projection registry serves whole-log per-route token usage folded from the
 * latest request config and assembled assistant messages; compositions
 * without the registry are unaffected; unmounting the plugin removes the key
 * (HMR safety). The attribution regression pinned here is that a call is
 * charged to the route current when its message assembles, and that a
 * message with no usage still counts one call but no tokens.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionUsagePlugin from '@deepseek-ai/dsh-session-usage'
import { usageByRouteProjectionDefinition } from '@deepseek-ai/dsh-session-usage/src/projection.ts'
import type { SessionUsageProjection, UsageRoute } from '@deepseek-ai/dsh-session-usage/types'

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(SessionUsagePlugin)
  return { ctx, session: ctx.sessions.create(SessionId('usage')) }
}

/** Set the current route via a `request/header` config event. */
function header(session: Session, provider: string, model: string): void {
  session.append('request/header', {
    header: { config: { provider, model } },
    reason: 'change',
  })
}

/** Set the current route via a `request/context` event. */
function context(session: Session, provider: string, model: string): void {
  session.append('request/context', { provider, model })
}

/** Append an assembled assistant message carrying a usage report. */
function message(session: Session, turn: number, step: number, usage?: unknown): SessionEvent {
  return session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    stream: [],
    ...(usage === undefined ? {} : { usage: usage as never }),
  }, { surfaceOp: 'append' })
}

/** The empty projection value. */
function empty(): SessionUsageProjection {
  return { routes: [], totalCalls: 0 }
}

function route(overrides: Partial<UsageRoute>): UsageRoute {
  return {
    provider: '',
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    calls: 0,
    ...overrides,
  }
}

describe('usageByRoute projection unit (registry drive)', () => {
  it('serves zero figures on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual(empty())
  })

  it('attributes a usage-bearing message to the current route and notifies the change feed', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    header(session, 'openrouter', 'deepseek/deepseek-v4-flash')
    const seq = message(session, 1, 1, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      reasoningTokens: 0,
    }).seq
    expect(changes.at(-1)).toEqual({
      key: 'usageByRoute',
      value: {
        routes: [route({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, calls: 1 })],
        totalCalls: 1,
      },
      seq,
    })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [route({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, calls: 1 })],
      totalCalls: 1,
    })
  })

  it('counts a call with no usage report but no tokens, and keeps routes separate', async () => {
    const { ctx, session } = await harness(true)
    header(session, 'qwen-token-plan', 'deepseek-v4-flash')
    message(session, 1, 1, undefined)
    header(session, 'opencode-go', 'kimi-k3')
    message(session, 1, 2, { inputTokens: 5, outputTokens: 3 })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [
        route({ provider: 'opencode-go', model: 'kimi-k3', inputTokens: 5, outputTokens: 3, calls: 1 }),
        route({ provider: 'qwen-token-plan', model: 'deepseek-v4-flash', calls: 1 }),
      ],
      totalCalls: 2,
    })
  })

  it('attributes a message assembled before any request config to no route', async () => {
    const { ctx, session } = await harness(true)
    message(session, 1, 1, { inputTokens: 10, outputTokens: 10 })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual(empty())
  })

  it('re-attributes after a mid-session route switch (config logged before request)', async () => {
    const { ctx, session } = await harness(true)
    header(session, 'openrouter', 'glm-5.2')
    message(session, 1, 1, { inputTokens: 10, outputTokens: 10 })
    header(session, 'commandcode', 'deepseek/deepseek-v4-flash')
    message(session, 1, 2, { inputTokens: 20, outputTokens: 20 })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [
        route({ provider: 'commandcode', model: 'deepseek/deepseek-v4-flash', inputTokens: 20, outputTokens: 20, calls: 1 }),
        route({ provider: 'openrouter', model: 'glm-5.2', inputTokens: 10, outputTokens: 10, calls: 1 }),
      ],
      totalCalls: 2,
    })
  })

  it('ignores a malformed usage report but still counts the call', async () => {
    const { ctx, session } = await harness(true)
    header(session, 'openrouter', 'glm-5.2')
    message(session, 1, 1, { inputTokens: 1, outputTokens: -5 })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [route({ provider: 'openrouter', model: 'glm-5.2', calls: 1 })],
      totalCalls: 1,
    })
  })

  it('accepts a request/context as the attribution source', async () => {
    const { ctx, session } = await harness(true)
    context(session, 'opencode-go', 'deepseek-v4-pro')
    message(session, 1, 1, { inputTokens: 7, outputTokens: 2 })
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [route({ provider: 'opencode-go', model: 'deepseek-v4-pro', inputTokens: 7, outputTokens: 2, calls: 1 })],
      totalCalls: 1,
    })
  })

  it('folds steps already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    header(session, 'openrouter', 'glm-5.2')
    message(session, 1, 1, { inputTokens: 10, outputTokens: 10 })
    await ctx.plugin(SessionUsagePlugin)
    expect(ctx.sessionProjections.snapshot(session).values.usageByRoute).toEqual({
      routes: [route({ provider: 'openrouter', model: 'glm-5.2', inputTokens: 10, outputTokens: 10, calls: 1 })],
      totalCalls: 1,
    })
  })

  it('has no usageByRoute key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('usageByRoute' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionUsagePlugin)
    header(session, 'openrouter', 'glm-5.2')
    message(session, 1, 1, { inputTokens: 10, outputTokens: 10 })
    expect('usageByRoute' in ctx.sessionProjections.snapshot(session).values).toBe(true)
    await fiber.dispose()
    expect('usageByRoute' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the definition and view the result. */
function fold(events: readonly SessionEvent[]): SessionUsageProjection {
  const state = events.reduce(
    (folded, event) => usageByRouteProjectionDefinition.apply(folded, event),
    usageByRouteProjectionDefinition.init(),
  )
  return usageByRouteProjectionDefinition.wire.view(state)
}

describe('usageByRoute fold (controlled events)', () => {
  const header = (provider: string, model: string): SessionEvent =>
    at(0, 'request/header', { header: { config: { provider, model } }, reason: 'change' })
  const msg = (usage: unknown): SessionEvent =>
    at(1, 'assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      stream: [],
      ...usage === undefined ? {} : { usage },
    })

  it('accrues nothing for unrelated events and returns the same reference', () => {
    const state = usageByRouteProjectionDefinition.init()
    const untouched = usageByRouteProjectionDefinition.apply(state, at(1, 'user/message', { content: [] }))
    expect(untouched).toBe(state)
  })

  it('returns the same reference when a request header repeats the current route', () => {
    const state = usageByRouteProjectionDefinition.init()
    const first = usageByRouteProjectionDefinition.apply(state, header('openrouter', 'glm-5.2'))
    const repeated = usageByRouteProjectionDefinition.apply(first, header('openrouter', 'glm-5.2'))
    expect(repeated).toBe(first)
  })

  it('returns the same reference when a request context repeats the current route', () => {
    const state = usageByRouteProjectionDefinition.init()
    const first = usageByRouteProjectionDefinition.apply(state, header('openrouter', 'glm-5.2'))
    const contextEvent = at(1, 'request/context', { provider: 'openrouter', model: 'glm-5.2' })
    const repeated = usageByRouteProjectionDefinition.apply(first, contextEvent)
    expect(repeated).toBe(first)
  })

  it('sums repeated calls on the same route without duplicating the route', () => {
    expect(fold([
      header('openrouter', 'glm-5.2'),
      msg({ inputTokens: 10, outputTokens: 5 }),
      msg({ inputTokens: 10, outputTokens: 15 }),
    ])).toEqual({
      routes: [route({ provider: 'openrouter', model: 'glm-5.2', inputTokens: 20, outputTokens: 20, calls: 2 })],
      totalCalls: 2,
    })
  })

  it('orders routes by descending output tokens', () => {
    expect(fold([
      header('a', 'small'),
      msg({ inputTokens: 1, outputTokens: 1 }),
      header('b', 'big'),
      msg({ inputTokens: 1, outputTokens: 100 }),
      header('a', 'small'),
      msg({ inputTokens: 1, outputTokens: 1 }),
    ])).toEqual({
      routes: [
        route({ provider: 'b', model: 'big', inputTokens: 1, outputTokens: 100, calls: 1 }),
        route({ provider: 'a', model: 'small', inputTokens: 2, outputTokens: 2, calls: 2 }),
      ],
      totalCalls: 3,
    })
  })
})
