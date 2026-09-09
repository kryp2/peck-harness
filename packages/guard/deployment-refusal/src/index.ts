/**
 * Deployment refusal guard: a pure configuration gate that fails harness
 * startup before any readiness effect when the operator's DECLARED deployment
 * facts combine non-loopback reachability, absent application authentication,
 * and the `danger-full-access` permission preset.
 *
 * The three facts are declared, never detected. A `dsh web` process binds the
 * loopback interface while an external bridge (socat over WireGuard, a
 * reverse proxy, a port forward) creates remote reachability, so socket or
 * interface inspection cannot infer exposure; this plugin only ever reads
 * explicit configuration. `trustedHosts`/Host/Origin checks are browser-trust
 * fencing, not application authentication, and never satisfy `authKind`.
 *
 * The permission fact is not duplicated here: it is read from its owning
 * service (`ctx.sandboxPolicy.defaultMode`, the deployment default beneath
 * per-session overrides), so the guard validates the same value execution
 * resolves. Misconfiguration fails loud per repo rule: a declared remote
 * profile whose permission fact cannot resolve refuses startup instead of
 * guessing.
 *
 * Composed nowhere by default — shipping profiles keep their current
 * behavior; a deployment opts in by adding a `deployment-refusal` row to its
 * composition (mount it early, before server/readiness rows).
 *
 * @module @deepseek-ai/dsh-guard-deployment-refusal
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
// Side-effect type import: declaration-merges `ctx.sandboxPolicy` (the owning
// service this guard reads the effective permission mode from), without a
// value dependency on the policy package.
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/** Stable Cordis plugin name. */
export const name = 'deployment-refusal'

/** Services required before activation; the permission owner is read optionally. */
export const inject: readonly string[] = []

/**
 * Declared reachability of this process's serving socket. This is a claim
 * about who can connect — through bridges and proxies included — not about
 * the local bind address: a loopback-bound process fronted by socat/WireGuard
 * or any external forwarder is `'remote-declared'`.
 */
export type DeploymentExposure = 'loopback-only' | 'remote-declared'

/**
 * Application-authentication mechanism composed in front of the API surface.
 * Only a mechanism that rejects unauthenticated requests counts;
 * `trustedHosts`/Host/Origin fencing is not authentication and must be
 * declared as `'none'`.
 */
export type ApplicationAuthKind = 'none' | 'token'

/** Plugin config: the operator's declared deployment facts. */
export interface Config {
  /**
   * Declared reachability of this deployment's serving socket.
   * @default 'loopback-only'
   */
  exposure?: DeploymentExposure
  /**
   * Application-authentication mechanism present for API requests. Absent
   * authentication is declared explicitly; there is no detection fallback.
   * @default 'none'
   */
  authKind?: ApplicationAuthKind
}

export const Config: z<Config> = z.object({
  exposure: z.union(['loopback-only', 'remote-declared'] as const).default('loopback-only'),
  authKind: z.union(['none', 'token'] as const).default('none'),
})

/** Fully resolved deployment facts the refusal rule consumes. */
export interface DeploymentFacts {
  /** Declared reachability of this process's serving socket. */
  exposure: DeploymentExposure
  /** Application-authentication mechanism composed for API requests. */
  authKind: ApplicationAuthKind
}

/**
 * Explicit resolve step filling the schema defaults, so the refusal rule
 * consumes complete facts and no hidden `??` default survives past this point.
 * @param config - validated plugin config as the schema produced it.
 * @returns the complete deployment facts.
 */
export function resolveDeploymentFacts(config: Config): DeploymentFacts {
  return {
    exposure: config.exposure ?? 'loopback-only',
    authKind: config.authKind ?? 'none',
  }
}

/**
 * The refusal rule. Loopback-only declarations pass unconditionally. A
 * declared remote profile fails loud unless every fact resolves, and refuses
 * exactly when authentication is absent AND the effective permission mode is
 * `danger-full-access`.
 * @param facts - the resolved declared exposure and authentication kind.
 * @param permissionMode - the effective deployment permission mode read from
 *   its owner (`ctx.sandboxPolicy.defaultMode`); `undefined` when no policy
 *   owner is composed.
 * @throws with all three facts and the exact remediation options when the
 *   dangerous combination is declared.
 * @throws when a declared remote profile cannot resolve its permission fact.
 */
export function evaluateDeploymentRefusal(facts: DeploymentFacts, permissionMode: SandboxMode | undefined): void {
  if (facts.exposure !== 'remote-declared') return
  if (permissionMode === undefined) {
    throw new Error(
      'deployment-refusal: declared exposure "remote-declared" requires an effective permission preset, '
      + 'but no ctx.sandboxPolicy service is composed, so the permission fact is missing. '
      + 'Compose @deepseek-ai/dsh-sandbox-policy, or declare exposure "loopback-only".',
    )
  }
  if (!(facts.authKind === 'none' && permissionMode === 'danger-full-access')) return
  throw new Error(
    'deployment-refusal: refusing startup before readiness: declared exposure "remote-declared" combines '
    + 'no application authentication (authKind "none") with the danger-full-access permission preset '
    + '(effective sandbox policy mode "danger-full-access"). Apply exactly one remediation: '
    + '(1) declare exposure "loopback-only" when nothing bridges this socket beyond the loopback host; '
    + '(2) compose real application authentication and set authKind to its kind (e.g. "token") — '
    + 'trustedHosts/Host/Origin checks are not authentication; '
    + '(3) move the effective permission preset below danger-full-access (sandboxPolicy config.mode).',
  )
}

/**
 * Evaluate the declared deployment facts at plugin activation — synchronously
 * inside the Loader tree start, so a refusal aborts boot before readiness
 * effects (URL line, browser handoff) can run anywhere in the tree. Registers
 * no services, events, tools, or other effects: the plugin has nothing to
 * dispose and an HMR reload re-runs the same evaluation on the fresh fiber.
 * @param ctx - plugin context; read for the optional `sandboxPolicy` owner.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const facts = resolveDeploymentFacts(config)
  // Optional read on purpose: a loopback-only declaration never requires the
  // permission owner, and declaring inject would make the row wait forever on
  // a missing provider instead of failing loud under a remote declaration.
  const permissionMode = ctx.get('sandboxPolicy')?.defaultMode
  evaluateDeploymentRefusal(facts, permissionMode)
}
