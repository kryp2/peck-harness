import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CordisInspectRegistryService } from '../src/inspect-registry.ts'
import type { HostCordisInspectProviderRegistration } from '../src/inspect-registry.ts'

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false }
const OUTPUT = { description: 'JSON data owned by this inspect provider.' }

/** Minimal valid Host provider registration for one manifest id. */
function registration(id: string, holder = 'only'): HostCordisInspectProviderRegistration {
  return {
    manifest: {
      id,
      description: `${id} provider`,
      methods: [{
        name: 'list',
        description: 'list',
        inputSchema: EMPTY_INPUT,
        outputSchema: OUTPUT,
      }],
    },
    query(methodName) {
      if (methodName !== 'list') throw new Error(`unknown method "${methodName}"`)
      return Promise.resolve({ holder })
    },
  }
}

const agent = { id: 'agent-under-test' } as unknown as Agent
const queryHost = (registry: CordisInspectRegistryService): Promise<unknown> =>
  registry.query('host', 'Service', 'list', undefined, agent, new AbortController().signal)

describe('CordisInspectRegistryService.register', () => {
  it('registers a provider once and serves it', () => {
    const registry = new CordisInspectRegistryService(new Context())
    registry.register(registration('Service'))
    expect(registry.list().some(view => view.id === 'Service' && view.platform === 'host')).toBe(true)
  })

  it('is idempotent across preset mounts of the same provider id', () => {
    const registry = new CordisInspectRegistryService(new Context())
    const first = registry.register(registration('Service'))
    // A second preset mounting the same id must not throw (regression: a second
    // preset mount used to fail session creation with "already registered").
    const second = registry.register(registration('Service'))
    expect(registry.list().filter(view => view.id === 'Service')).toHaveLength(1)
    expect(first).toBeTypeOf('function')
    expect(second).toBeTypeOf('function')
  })

  it('evicts the shared entry only after the last holder disposes', () => {
    const registry = new CordisInspectRegistryService(new Context())
    const first = registry.register(registration('Service'))
    const second = registry.register(registration('Service'))
    first()
    // The remaining holder still sees its provider.
    expect(registry.list().some(view => view.id === 'Service')).toBe(true)
    second()
    expect(registry.list().some(view => view.id === 'Service')).toBe(false)
  })

  it('serves a provider whose first holder already disposed, through the surviving registration', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    const disposers = [registration('Service', 'first'), registration('Service', 'second')].map(r => registry.register(r))
    disposers[0]!()
    // The remaining holder still sees its provider.
    expect(registry.list().some(view => view.id === 'Service')).toBe(true)
    // And queries execute the SURVIVING handler, not the disposed mount's closure.
    await expect(queryHost(registry)).resolves.toEqual({ holder: 'second' })
    disposers[1]!()
    expect(registry.list().some(view => view.id === 'Service')).toBe(false)
  })

  it('executes the newest live registration and falls back to earlier holders on its disposal', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    const first = registry.register(registration('Service', 'first'))
    const second = registry.register(registration('Service', 'second'))

    await expect(queryHost(registry)).resolves.toEqual({ holder: 'second' })
    second()
    await expect(queryHost(registry)).resolves.toEqual({ holder: 'first' })
    first()
    await expect(queryHost(registry)).rejects.toThrow('is not registered')
  })

  it('rejects a host query for a provider that was never registered', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    await expect(queryHost(registry)).rejects.toThrow('Host Cordis inspect provider "Service" is not registered')
  })

  it('treats repeated disposal as a no-op in both eviction orders', () => {
    const registry = new CordisInspectRegistryService(new Context())
    const first = registry.register(registration('Service'))
    const second = registry.register(registration('Service'))
    expect(() => { first(); first() }).not.toThrow()
    expect(() => { second(); second() }).not.toThrow()
    expect(registry.list().some(view => view.id === 'Service')).toBe(false)
  })
})
