/**
 * Register a {@link ClaudeCliAdapter} for the `claude-cli` provider route on
 * `ctx.llm`. The plugin layers its `cordis.yml` entry config under the
 * `llm-claude-cli` user-settings section and requires no API key — Claude
 * Code uses the host's own OAuth subscription, so authentication is the
 * user's, not the harness's.
 *
 * @module @deepseek-ai/dsh-llm-claude-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

import {
  ClaudeCliAdapter,
  __adapterDefaults as defaults,
} from './adapter.ts'
import type { ClaudeCliAdapterOptions } from './adapter.ts'
import type { ClaudeCliCatalogModel, ClaudeCliConnectionOptions } from './serialize.ts'

export {
  ClaudeCliAdapter,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './adapter.ts'
export type { ClaudeCliAdapterOptions } from './adapter.ts'
export type { ClaudeCliCatalogModel, ClaudeCliConnectionOptions } from './serialize.ts'

export const name = 'llm-claude-cli'
export const inject = ['llm']

const NS = 'llm-claude-cli'
/** The single provider route this plugin owns. */
const PROVIDER = 'claude-cli'

const catalogModelSchema: z<ClaudeCliCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-claude-cli` settings-section shape. Every field is optional in
 * yml: omitted binary falls back to `claude` on `$PATH`, omitted settings
 * JSON uses the harness default (sonnet + medium), and omitted models
 * advertises the standard sonnet/haiku/opus triplet.
 */
export interface Config {
  /** Binary path; defaults to `claude`. */
  binary?: string
  /** JSON string passed verbatim to `--settings`. */
  settingsJson?: string
  /** Default per-request output cap (default 32 000). */
  maxTokens?: number
  /** Soft cap on `--system-prompt` length before warning + truncation. */
  maxSystemPromptChars?: number
  /** Advisory models exposed to discovery consumers. */
  models?: ClaudeCliCatalogModel[]
}

/** Resolved config with all defaults applied. */
interface ResolvedConfig {
  binary: string
  settingsJson: string
  maxTokens: number
  maxSystemPromptChars: number
  models: readonly ClaudeCliCatalogModel[]
}

export const Config: z<Config> = z.object({
  binary: z.string().default('claude'),
  settingsJson: z.string().default(defaults.DEFAULT_SETTINGS_JSON),
  maxTokens: z.number().min(1).max(Number.MAX_SAFE_INTEGER).default(defaults.DEFAULT_MAX_TOKENS),
  maxSystemPromptChars: z.number().min(1).max(1_000_000).default(defaults.DEFAULT_MAX_SYSTEM_PROMPT_CHARS),
  models: z.array(catalogModelSchema).default([...defaults.DEFAULT_MODELS]),
})

/**
 * One resolution's complete connection facts. Same shape as the adapter
 * expects; the plugin's resolve step is the one boundary at which defaults
 * are applied.
 */
export type ResolvedClaudeCliOptions = ClaudeCliConnectionOptions

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Schemastery applies `.default()` only through the validation
 * pipeline, so programmatic callers (and re-entrant settings snapshots)
 * reach this with a Config whose fields may still be `undefined`. We
 * resolve every default here — once at mount, then once per settings
 * snapshot through {@link apply}'s `onChange`.
 *
 * @param config - Raw plugin config; every field may be `undefined`.
 * @returns Connection options with every default applied.
 */
export function resolveAdapterOptions(config: Config): ResolvedClaudeCliOptions {
  const resolved: ResolvedConfig = {
    binary: config.binary ?? 'claude',
    settingsJson: config.settingsJson ?? defaults.DEFAULT_SETTINGS_JSON,
    maxTokens: config.maxTokens ?? defaults.DEFAULT_MAX_TOKENS,
    maxSystemPromptChars: config.maxSystemPromptChars ?? defaults.DEFAULT_MAX_SYSTEM_PROMPT_CHARS,
    models: config.models ?? defaults.DEFAULT_MODELS,
  }
  if (!Number.isInteger(resolved.maxTokens) || resolved.maxTokens <= 0) {
    throw new Error('llm-claude-cli: maxTokens must be a positive integer')
  }
  if (!Number.isInteger(resolved.maxSystemPromptChars) || resolved.maxSystemPromptChars <= 0) {
    throw new Error('llm-claude-cli: maxSystemPromptChars must be a positive integer')
  }
  const seen = new Set<string>()
  for (const m of resolved.models) {
    if (seen.has(m.id)) throw new Error(`llm-claude-cli: duplicate catalog model "${m.id}"`)
    seen.add(m.id)
  }
  return resolved
}

/** Cordis function plugin: `name` / `inject` / `Config` / `apply`, no default export. */
export function apply(ctx: Context, config: Config): void {
  // Validate at composition load (fail loud).
  const initial = resolveAdapterOptions(config)

  // Per-call resolution; settings-snapshot swaps flow through here. The
  // adapter sees a `() => ResolvedClaudeCliOptions` thunk; we resolve the
  // raw `() => Config` snapshot from settings into the adapter's resolved
  // shape on each call so a stale cache and a fresh source never mix.
  let currentSource: () => Config = () => config
  const options = (): ResolvedClaudeCliOptions => resolveAdapterOptions(currentSource())

  // The adapter is process-stable; only its connection thunk is per-call.
  const adapterOptions: ClaudeCliAdapterOptions = { options }
  const adapter = new ClaudeCliAdapter(adapterOptions)

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Claude (CLI)', settingsNs: NS, settingsPath: [] },
  ])
  // The adapter handles one provider route. A future multi-route split (e.g.
  // `claude-cli-bedrock`) would re-register here on route changes.
  ctx.llm.registerAdapter([PROVIDER], adapter)

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source: () => Config) => {
        currentSource = source
      },
      onChange: () => {
        // Re-validation on settings change happens through `options()` above;
        // the adapter instance does not need re-registration.
      },
    })
  })

  // Surface the resolved config once at mount so deployments can see the
  // effective binary path and settings JSON.
  ctx.logger.info(
    `llm-claude-cli: binary=${initial.binary} models=[${initial.models.map(m => m.id).join(',')}]`,
  )
}

