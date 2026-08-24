/**
 * Deployment refusal guard coverage: the pure truth table over all eight
 * combinations of declared reachability, application authentication, and
 * effective permission preset, fail-loud message content, missing-fact
 * refusals, the apply-time read of the owning `ctx.sandboxPolicy` service,
 * one real Loader composition proving a refusal aborts boot, and the
 * invariant companion's registration lifecycle.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import {
  apply,
  Config,
  evaluateDeploymentRefusal,
  resolveDeploymentFacts,
  type ApplicationAuthKind,
  type DeploymentExposure,
} from '../src/index.ts'

const DISPOSERS: (() => Promise<void>)[] = []

/** Node imports the fixture row outside Vite's resolver, so delegate to this test's source-plane exports. */
const guardGlobals = globalThis as unknown as {
  __deploymentRefusalGuard?: { Config: typeof Config; apply: typeof apply }
}

afterEach(async () => {
  for (const dispose of DISPOSERS.splice(0)) await dispose()
})

/** Mount a real sandbox-policy owner carrying `mode` and register its disposal. */
async function mountPolicy(mode: SandboxMode): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SandboxPolicyService, { mode })
  DISPOSERS.push(() => ctx.fiber.dispose())
  return ctx
}

describe('evaluateDeploymentRefusal truth table', () => {
  const cases: readonly {
    exposure: DeploymentExposure
    authKind: ApplicationAuthKind
    fullAccess: boolean
    outcome: 'starts' | 'refuses'
  }[] = [
    { exposure: 'loopback-only', authKind: 'none', fullAccess: true, outcome: 'starts' },
    { exposure: 'loopback-only', authKind: 'none', fullAccess: false, outcome: 'starts' },
    { exposure: 'loopback-only', authKind: 'token', fullAccess: true, outcome: 'starts' },
    { exposure: 'loopback-only', authKind: 'token', fullAccess: false, outcome: 'starts' },
    { exposure: 'remote-declared', authKind: 'none', fullAccess: true, outcome: 'refuses' },
    { exposure: 'remote-declared', authKind: 'none', fullAccess: false, outcome: 'starts' },
    { exposure: 'remote-declared', authKind: 'token', fullAccess: true, outcome: 'starts' },
    { exposure: 'remote-declared', authKind: 'token', fullAccess: false, outcome: 'starts' },
  ]

  it.each(cases)('$exposure + auth $authKind + fullAccess $fullAccess -> $outcome', ({ exposure, authKind, fullAccess, outcome }) => {
    const mode: SandboxMode = fullAccess ? 'danger-full-access' : 'workspace-write'
    const evaluate = (): void => {
      evaluateDeploymentRefusal(resolveDeploymentFacts({ exposure, authKind }), mode)
    }
    if (outcome === 'starts') expect(evaluate).not.toThrow()
    else expect(evaluate).toThrow(/refusing startup before readiness/)
  })
})

describe('fail-loud message content', () => {
  it('names all three facts and every remediation option on refusal', () => {
    expect((): void => {
      evaluateDeploymentRefusal(
        resolveDeploymentFacts({ exposure: 'remote-declared', authKind: 'none' }),
        'danger-full-access',
      )
    }).toThrow(/^deployment-refusal: refusing startup before readiness:/u)

    let message = ''
    try {
      evaluateDeploymentRefusal(
        resolveDeploymentFacts({ exposure: 'remote-declared', authKind: 'none' }),
        'danger-full-access',
      )
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('declared exposure "remote-declared"')
    expect(message).toContain('no application authentication (authKind "none")')
    expect(message).toContain('danger-full-access permission preset')
    expect(message).toContain('(1) declare exposure "loopback-only"')
    expect(message).toContain('(2) compose real application authentication')
    expect(message).toContain('trustedHosts/Host/Origin checks are not authentication')
    expect(message).toContain('(3) move the effective permission preset below danger-full-access')
  })

  it('fails loud naming the missing permission owner under a remote declaration', () => {
    expect((): void => {
      evaluateDeploymentRefusal(resolveDeploymentFacts({ exposure: 'remote-declared', authKind: 'token' }), undefined)
    }).toThrow(/declared exposure "remote-declared" requires an effective permission preset.*ctx\.sandboxPolicy/s)
  })

  it('never consults the permission fact for a loopback-only declaration', () => {
    expect((): void => {
      evaluateDeploymentRefusal(resolveDeploymentFacts({}), undefined)
    }).not.toThrow()
  })
})

describe('config resolution', () => {
  it('fills both declared defaults through the explicit resolve step', () => {
    expect(resolveDeploymentFacts({})).toEqual({ exposure: 'loopback-only', authKind: 'none' })
    expect(
      resolveDeploymentFacts({ exposure: 'remote-declared', authKind: 'token' }),
    ).toEqual({ exposure: 'remote-declared', authKind: 'token' })
  })
})

describe('apply over the owning sandbox-policy service', () => {
  it('passes a loopback declaration even under danger-full-access with no authentication', async () => {
    const ctx = await mountPolicy('danger-full-access')
    expect((): void => { apply(ctx, {}) }).not.toThrow()
  })

  it('allows a remote declaration with real authentication under danger-full-access', async () => {
    const ctx = await mountPolicy('danger-full-access')
    expect((): void => { apply(ctx, { exposure: 'remote-declared', authKind: 'token' }) }).not.toThrow()
  })

  it('refuses the dangerous combination through the same owner-read value execution uses', async () => {
    const ctx = await mountPolicy('danger-full-access')
    expect((): void => { apply(ctx, { exposure: 'remote-declared', authKind: 'none' }) })
      .toThrow(/refusing startup before readiness/)
  })

  it('fails loud when a remote declaration has no composed permission owner', () => {
    const ctx = new Context()
    DISPOSERS.push(() => ctx.fiber.dispose())
    expect((): void => { apply(ctx, { exposure: 'remote-declared' }) })
      .toThrow(/requires an effective permission preset.*ctx\.sandboxPolicy/s)
  })

  it('rejects an undeclared exposure value at schema validation', () => {
    const invalid = { exposure: 'detected-open-port' } as unknown as Config
    expect(() => Config(invalid)).toThrow()
  })
})

describe('real Loader composition', () => {
  /**
   * Boot a test-only cordis.yml through the real Loader over a real
   * danger-full-access policy owner. The guard row delegates to this test
   * module's source-plane exports (the Node fixture import sits outside
   * Vite's resolver). A throwing row rejects tree creation, which is by
   * construction earlier than any later readiness row can activate.
   */
  async function bootGuardRow(config: Config): Promise<{ failure: unknown; policyMode: SandboxMode | undefined }> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deployment-refusal-'))
    writeFileSync(join(dir, 'guard.mjs'), `
export const name = 'deployment-refusal'
export const inject = []
export const Config = globalThis.__deploymentRefusalGuard.Config
export const apply = (ctx, config) => globalThis.__deploymentRefusalGuard.apply(ctx, config)
`)
    writeFileSync(join(dir, 'cordis.yml'), [
      '- id: deployment-refusal',
      `  name: ${pathToFileURL(join(dir, 'guard.mjs')).href}`,
      '  config:',
      `    exposure: ${config.exposure ?? 'loopback-only'}`,
      `    authKind: ${config.authKind ?? 'none'}`,
    ].join('\n'))

    const ctx = new Context()
    await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access' })
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    guardGlobals.__deploymentRefusalGuard = { Config, apply }
    const failure = await ctx.loader
      .create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
      .then(() => ctx.loader.await())
      .then((): undefined => undefined, (error: unknown) => error)
    DISPOSERS.push(() => ctx.fiber.dispose())
    return { failure, policyMode: ctx.get('sandboxPolicy')?.defaultMode }
  }

  it('aborts the boot before readiness when the dangerous combination is declared', async () => {
    const { failure } = await bootGuardRow({ exposure: 'remote-declared', authKind: 'none' })
    expect(String(failure)).toContain('refusing startup before readiness')
    expect(String(failure)).toContain('trustedHosts/Host/Origin checks are not authentication')
  })

  it('boots the same tree untouched under a loopback-only declaration', async () => {
    const { failure, policyMode } = await bootGuardRow({})
    expect(failure).toBeUndefined()
    expect(policyMode).toBe('danger-full-access')
  })
})
