/**
 * Focused invariant-companion coverage for
 * `@deepseek-ai/dsh-guard-deployment-refusal`: the companion reserves the
 * package name in the invariant registry, refuses a duplicate registration,
 * and releases the reservation on disposal. This suite owns its service
 * topology explicitly (manual invariant tree per test-invariants.ts).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as invariantCompanion from '../src/invariant.ts'

describe('deployment-refusal invariant companion', () => {
  it('runs its installer under an enabled registry and holds the package reservation', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(invariantCompanion)
    await fiber

    // register() records the package name synchronously inside apply, so a
    // direct second registration collides with the mounted companion's hold.
    expect(() => invariantCompanion.apply(ctx)).toThrow(/already registered/u)
  })

  it('releases the reservation on disposal so re-registration succeeds', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const first = ctx.plugin(invariantCompanion)
    await first
    expect(() => invariantCompanion.apply(ctx)).toThrow(/already registered/u)

    // Awaiting the fiber's disposal settles the registry's cleanup, which
    // releases the package reservation before this assertion runs.
    await first.dispose()
    const replacement = await invariantCompanion.apply(ctx)
    replacement()
  })
})
