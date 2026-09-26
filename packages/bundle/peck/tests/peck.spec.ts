/**
 * The bundle's substance is its patch files: the `dsh.bundle.patch` manifest
 * field must name real, parseable patch lists — the product patch expressing
 * the Peck composition exactly (official brand off, product rows, no active
 * Peck package rows) and the Peck agent preset declaration.
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

const PATCHES = ['./cordis.patch.yml', './presets/peck.patch.yml'] as const

function parsePatchFile(path: string): Patch[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${path} must parse to a patch list`)
  return parsed as Patch[]
}

/** Parse one of this bundle's manifest-listed patches: 0 is the product patch, 1 the preset. */
function loadPatch(index: 0 | 1 = 0): Patch[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string[] } }
  }
  expect(manifest.dsh?.bundle?.patch).toEqual([...PATCHES])
  return parsePatchFile(resolve(root, PATCHES[index]))
}

interface PresetPlugin { id: string; disabled?: unknown; config?: Record<string, unknown> }

/** The single declaration row a preset patch file inserts. */
function declarationOf(patch: Patch[]): PatchRow & { config: { id: string; plugins: PresetPlugin[] } } {
  const [row, ...rest] = patch.flatMap(entry => entry.insert ?? [])
  expect(rest).toEqual([])
  expect(row?.name).toBe('@deepseek-ai/dsh-agent-preset')
  return row as PatchRow & { config: { id: string; plugins: PresetPlugin[] } }
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
    expect(overridden.find(row => row.id === 'agent-preset-registry')?.config).toEqual({ default: 'peck' })
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
    expect((byId.get('agent-preset-registry') as { config?: { default?: string } } | undefined)?.config?.default).toBe('peck')
    expect((byId.get('preset-peck') as { config?: { id?: string } } | undefined)?.config?.id).toBe('peck')
    expect((byId.get('web-runtime') as { config?: { productName?: string } } | undefined)?.config?.productName)
      .toBe('Peck Harness')
  })

  it('declares the Peck preset as the shipped standard plus only the Peck deltas', () => {
    const peck = declarationOf(loadPatch(1))
    const standard = declarationOf(parsePatchFile(fileURLToPath(
      new URL('../../web-app/presets/standard.patch.yml', import.meta.url),
    )))
    expect(peck.id).toBe('preset-peck')
    expect(peck.config.id).toBe('peck')
    // Same plugin list as standard, in order, plus the disabled opt-in rows:
    // an upstream sync that changes standard fails here until peck follows.
    const optIn = peck.config.plugins.filter(plugin => plugin.id === 'telegram-answerer')
    expect(optIn).toEqual([{ id: 'telegram-answerer', name: '@deepseek-ai/dsh-telegram-answerer', disabled: true }])
    const shared = peck.config.plugins.filter(plugin => plugin.id !== 'telegram-answerer')
    const persona = (list: PresetPlugin[]) => list.find(plugin => plugin.id === 'persona')
    expect(shared.map(plugin => plugin.id)).toEqual(standard.config.plugins.map(plugin => plugin.id))
    expect(shared.filter(plugin => plugin.id !== 'persona')).toEqual(
      standard.config.plugins.filter(plugin => plugin.id !== 'persona'),
    )
    expect(persona(shared)?.config?.prefix).toContain('Peck Harness')
    expect(persona(shared)?.config?.suffix).toBe(persona(standard.config.plugins)?.config?.suffix)
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
