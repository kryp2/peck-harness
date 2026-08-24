/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-telegram-answerer`.
 * @module @deepseek-ai/dsh-telegram-answerer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-telegram-answerer'

/** Cordis companion plugin name. */
export const name = 'telegram-answerer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the answerer observes the user-questions racing event and posts
 * outward to Telegram; it publishes no independent request/answer audit stream of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
