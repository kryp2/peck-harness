/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list, and that list must express the
 * Peck composition exactly — official brand off, product rows, and no active
 * Peck package rows.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'

interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  inject?: string[]
  config?: Record<string, unknown>
}
type Patch = { insert?: PatchRow[] } & PatchRow

function loadPatch(): Patch[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(
    readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('peck patch must parse to a patch list')
  return parsed as Patch[]
}

/** Flatten one patch document into its targeted and inserted rows. */
function rowsOf(patch: Patch[]): { overridden: PatchRow[]; inserted: PatchRow[] } {
  const overridden = patch.filter(row => typeof row.id === 'string' && !Array.isArray(row.insert))
  const inserted = patch.flatMap(row => row.insert ?? [])
  return { overridden, inserted }
}

describe('dsh-peck bundle', () => {
  it('leaves the official brand row off with no brand package of its own', () => {
    const { overridden, inserted } = rowsOf(loadPatch())
    const official = overridden.find(row => row.id === 'ui-brand-official')
    expect(official?.disabled).toBe(true)
    expect(inserted.find(row => row.id === 'ui-brand-peck')).toBeUndefined()
  })

  it('points the deployment default preset at the Peck composition', () => {
    const { overridden } = rowsOf(loadPatch())
    expect(overridden.find(row => row.id === 'agent-presets')?.config).toEqual({ default: 'peck' })
  })

  it('restates the web-runtime values and adds the Peck product name', () => {
    const { overridden } = rowsOf(loadPatch())
    const webRuntime = overridden.find(row => row.id === 'web-runtime')
    // The patch replaces the whole config, so the web-app flag-derived keys
    // must be restated alongside productName.
    expect(webRuntime?.inject).toEqual(['webStartup'])
    expect(webRuntime?.config).toMatchObject({
      openBrowser: { __jsExpr: 'ctx.webStartup.openBrowser' },
      printUrl: true,
      productName: 'Peck Harness',
      surfaceContext: true,
      trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' },
    })
  })

  it('composes the Peck product surface through the real loader: brand off, preset default, product name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-peck-proof-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-peck-proof',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-peck'] } },
    }))
    writeFileSync(join(dir, 'cordis.yml'), '[]')
    const profile = loadProfileDirectory(
      'dsh',
      dir,
      fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url)),
    )
    const byId = new Map(composeEntries(profile.layers.map(layer => layer.patches)).map(entry => [entry.id, entry]))
    expect((byId.get('ui-brand-official') as { disabled?: boolean } | undefined)?.disabled).toBe(true)
    expect(byId.has('ui-brand-peck')).toBe(false)
    expect((byId.get('agent-presets') as { config?: { default?: string } } | undefined)?.config?.default).toBe('peck')
    expect((byId.get('web-runtime') as { config?: { productName?: string } } | undefined)?.config?.productName)
      .toBe('Peck Harness')
  })

  it('composes no opt-in Peck host package; those rows belong to the agent preset', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    // The declaration makes bare preset rows resolvable through the profile
    // module fallback; it is not a composition.
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-telegram-answerer')
    const { overridden, inserted } = rowsOf(loadPatch())
    for (const row of [...overridden, ...inserted]) {
      expect(row.name).not.toBe('@deepseek-ai/dsh-telegram-answerer')
    }
  })
})
