/**
 * Peck Harness browser-brand plugin, browser half.
 *
 * Fills the shipped generic brand slots (`sidebar.brand.mark`,
 * `sidebar.brand.name`, `conversation.hero.brand.mark`) unconditionally —
 * composition, not a build profile, decides whether Peck branding shows:
 * whoever mounts this package's row wants the Peck surface. Also registers
 * the Peck palette as one theme override layer over the active theme, so the
 * shared token stylesheet keeps its upstream values.
 *
 * The three occupants install as one declaration-aware registration set
 * through nested `slots.inject()` calls, so the package works whether its row
 * activates before or after the sidebar and conversation declarers, withdraws
 * everything when either declaration collapses, and leaves no partial brand
 * mix during HMR. The node half is an empty Loader seat.
 * @module @deepseek-ai/dsh-client-ui-brand-peck/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { PeckBrandMark, PeckBrandName } from './brand.tsx'
import { PECK_PALETTE, PECK_PALETTE_SOURCE } from './palette.ts'

/** Required services: the UI slot registry and the theme registry. */
export const inject = ['slots', 'theme']

/**
 * Fill every shipped brand slot and stack the Peck palette layer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PeckBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, PeckBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PeckBrandMark)
      })))
  // One override layer keyed by this package: disposing the fiber removes the
  // palette exactly as it removes the slot occupants.
  ctx.effect(
    () => ctx.theme.overrideTokens(PECK_PALETTE_SOURCE, PECK_PALETTE),
    'ui-brand-peck: palette override layer',
  )
}
