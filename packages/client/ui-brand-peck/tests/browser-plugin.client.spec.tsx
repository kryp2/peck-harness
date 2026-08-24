// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject } from '../src/client/index.ts'
import { PECK_PALETTE, PECK_PALETTE_SOURCE } from '../src/client/palette.ts'
import { PeckBrandMark, PeckBrandName } from '../src/client/brand.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** Recorded overrideTokens calls against a stub theme registry. */
interface PaletteSpy {
  calls: Array<{ source: string; tokens: ThemeTokenOverrides }>
  disposers: Array<() => void>
}

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  const palette: PaletteSpy = { calls: [], disposers: [] }
  ctx.provide('theme', {
    overrideTokens: (source: string, tokens: ThemeTokenOverrides) => {
      palette.calls.push({ source, tokens })
      const disposer = () => {}
      palette.disposers.push(disposer)
      return disposer
    },
  } as unknown as ThemeRuntime)
  return { ctx, slots, declareHoles, disposeHoles, palette }
}

describe('peck browser-brand plugin', () => {
  it('declares the slot and theme services it uses', () => {
    expect(inject).toEqual(['slots', 'theme'])
  })

  it('fills every brand slot unconditionally, outside any build profile', async () => {
    // The composition decides branding: even a non-official build profile
    // value must not suppress the occupants the way the generic official
    // brand package's build-time gate does.
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('stacks one palette override layer under the package source id and drops it on teardown', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.palette.calls).toHaveLength(1)
    expect(subject.palette.calls[0]?.source).toBe(PECK_PALETTE_SOURCE)
    expect(subject.palette.calls[0]?.tokens).toEqual(PECK_PALETTE)

    await fiber.dispose()
    // The effect unwinds through the returned disposer, so the layer leaves
    // with the plugin exactly as the slot occupants do.
    expect(subject.palette.disposers).toHaveLength(1)
  })

  it('renders peck-bird artwork specifically, not just any brand svg', () => {
    // The bird is identifiable by its structure: head circle plus eye dot over
    // ten stroke paths — a previous mark satisfies only generic svg attributes.
    const mark = render(<PeckBrandMark size={24} />)
    expect(mark.container.querySelectorAll('circle')).toHaveLength(2)
    expect(mark.container.querySelectorAll('path')).toHaveLength(9)
    expect(mark.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    mark.unmount()

    // The name carries the literal wordmark and excludes the bird.
    const name = render(<PeckBrandName />)
    expect(name.container.querySelector('text')?.textContent).toBe('Peck Harness')
    expect(name.container.querySelectorAll('circle')).toHaveLength(0)
    name.unmount()
  })

  it('renders the mark at both requested sizes with the requested layout class', () => {
    const mark = render(<PeckBrandMark size={34} className="hero-mark" />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('hero-mark')
    mark.rerender(<PeckBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
    mark.unmount()

    const name = render(<PeckBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('24 0 136 24')
    name.unmount()
  })
})
