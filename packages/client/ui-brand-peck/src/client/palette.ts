/**
 * The Peck palette as one theme override layer.
 *
 * Every entry reproduces the palette the product shipped while its values
 * lived in the shared `design-platform.css`: the `--dsw-static-deepseek-*`
 * ramp recolored to the peck amber scale, plus the alias and specific tokens
 * whose fork values pointed away from the deepseek ramp. Tokens the fork left
 * untouched in one color scheme repeat that scheme's stylesheet value so an
 * override never changes rendering the base sheet already defines.
 * @module @deepseek-ai/dsh-client-ui-brand-peck/palette
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Override-layer source id; also names this package's layer in inspection. */
export const PECK_PALETTE_SOURCE = '@deepseek-ai/dsh-client-ui-brand-peck'

/** The complete Peck token layer, applied over whichever theme is active. */
export const PECK_PALETTE: ThemeTokenOverrides = {
  // ── static ramp: identical in both color schemes ──────────────────────────
  '--dsw-static-deepseek-50': { light: 'rgb(255, 247, 237)', dark: 'rgb(255, 247, 237)' },
  '--dsw-static-deepseek-100': { light: 'rgb(255, 237, 213)', dark: 'rgb(255, 237, 213)' },
  '--dsw-static-deepseek-200': { light: 'rgb(254, 215, 170)', dark: 'rgb(254, 215, 170)' },
  '--dsw-static-deepseek-300': { light: 'rgb(253, 186, 116)', dark: 'rgb(253, 186, 116)' },
  '--dsw-static-deepseek-400': { light: 'rgb(251, 146, 60)', dark: 'rgb(251, 146, 60)' },
  '--dsw-static-deepseek-450': { light: 'rgb(249, 115, 22)', dark: 'rgb(249, 115, 22)' },
  '--dsw-static-deepseek-500': { light: 'rgb(234, 88, 12)', dark: 'rgb(234, 88, 12)' },
  '--dsw-static-deepseek-600': { light: 'rgb(194, 65, 12)', dark: 'rgb(194, 65, 12)' },
  '--dsw-static-deepseek-700-delete': { light: 'rgb(154, 52, 18)', dark: 'rgb(154, 52, 18)' },
  '--dsw-static-deepseek-800': { light: 'rgb(124, 45, 18)', dark: 'rgb(124, 45, 18)' },
  '--dsw-static-deepseek-900': { light: 'rgb(67, 20, 7)', dark: 'rgb(67, 20, 7)' },

  // ── alias and specific layers: per-scheme values ───────────────────────────
  // Light takes the Peck accent literal; dark keeps the stylesheet's var()
  // form so it resolves through the recolored static above.
  '--dsw-alias-brand-primary-new-colorprimary-new-color': {
    light: 'rgb(249, 115, 22)',
    dark: 'var(--dsw-static-deepseek-450)',
  },
  '--dsw-alias-state-business-primary': {
    light: 'var(--dsw-static-amber-500)',
    dark: 'var(--dsw-static-amber-500)',
  },
  '--dsw-alias-state-business-tertiary': {
    light: 'var(--dsw-static-amber-100)',
    dark: 'var(--dsw-static-amber-900)',
  },
  '--dsw-specific-bubble-highlight': {
    light: 'var(--dsw-static-amber-400)',
    // Dark keeps the base sheet's value: the fork never re-pointed it.
    dark: 'var(--dsw-static-neutral-bluish-750)',
  },
  '--dsw-specific-bubble': {
    light: 'var(--dsw-static-amber-100)',
    dark: 'var(--dsw-static-neutral-bluish-850)',
  },
  '--dsw-specific-sidebar-nav-item-active-accent': {
    light: 'var(--dsw-static-amber-100)',
    dark: 'rgba(245, 158, 11, 0.18)',
  },
  '--dsw-specific-sidebar-nav-item-active': {
    light: 'var(--dsw-static-amber-100)',
    dark: 'rgba(245, 158, 11, 0.12)',
  },
  '--dsw-specific-sidebar-nav-item-hover': {
    light: 'rgba(245, 158, 11, 0.08)',
    dark: 'rgba(245, 158, 11, 0.08)',
  },
}
