---
description: "The claude --print subprocess adapter for the harness LLM service: runs Claude models through a local Claude Code CLI with OAuth, for users and maintainers choosing a keyless Claude route."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-claude-cli

English | [中文](README.zh.md)

> Status: **V1 prototype.** Tested against Claude Code 2.1.x. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work) before adopting for production work.

## Summary

`@deepseek-ai/dsh-llm-claude-cli` is the Claude adapter for the harness LLM service: it owns the `claude-cli` provider route and translates one `claude --print --output-format json` subprocess call per request into the harness stream-chunk protocol. With it a DSH agent runs on Claude models without an `ANTHROPIC_API_KEY`, because authentication flows through the host's own Claude subscription (Pro/Max OAuth) — the harness carries no Anthropic credentials. It is the keyless sibling of `@deepseek-ai/dsh-llm-deepseek`: pick this route when the deployment already pays for Claude Code, pick DeepSeek's API adapter when it holds a DeepSeek key instead.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a composition runs Claude models through a locally-installed Claude Code CLI. It registers the single `claude-cli` route and resolves connection facts per request, so a composition entry plus an optional user settings section drive the whole adapter.

### When to choose it

Choose this adapter when the deployment's preferred model is Claude and the host already pays for Claude Code — no API key is configured anywhere, and OAuth stays the user's responsibility through Claude Code's own `/login` flow. Choose `dsh-llm-deepseek` when the deployment holds a DeepSeek API key instead. Registering any other adapter for `claude-cli` fails with `DUPLICATE_ADAPTER`.

### Minimal configuration

```yaml
- id: llm-claude-cli
  name: '@deepseek-ai/dsh-llm-claude-cli'
  config:
    binary: claude                       # PATH-resolvable
    settingsJson: '{"model":"sonnet","effortLevel":"medium"}'
    maxTokens: 32000
    maxSystemPromptChars: 32000
    models:
      - id: sonnet
      - id: haiku
      - id: opus
```

The plugin registers one provider route: `claude-cli`. Point a DSH `GenerateOptions` at it with `provider: "claude-cli"` and any of the configured model aliases.

| Field | Default | Meaning |
|---|---|---|
| `binary` | `claude` | Binary path; must resolve on `$PATH` |
| `settingsJson` | sonnet + medium effort | JSON string passed verbatim to `--settings` |
| `maxTokens` | `32000` | Default per-request output cap |
| `maxSystemPromptChars` | `32000` | Soft cap on `--system-prompt` length before warning + truncation |
| `models` | sonnet + haiku + opus | Advisory catalog shown by discovery consumers |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-claude-cli) is the exhaustive source for every accepted field and its JSDoc.

### Model catalog

| Wire alias | Underlying model (Claude Code 2.1.x) | Notes |
|---|---|---|
| `sonnet` | Claude Sonnet 4.5 | default; matched by `--settings` model pin |
| `haiku` | Claude Haiku 4.5 | cheap tier for cost-sensitive loops |
| `opus` | Claude Opus 4.x | gated by subscription tier; may be unavailable |

The bridge does not see the underlying model id directly; it surfaces Claude Code's `modelUsage` payload in the session log for diagnostics.

### Wire protocol

```
GenerateOptions
   │
   ▼  buildInvocation()
claude --print --output-format json \
       --model <alias> \
       --settings '<json>' \
       --max-turns 1 \
       --permission-mode plan \
       --allowed-tools "" \
       --system-prompt '<text>'
   │
   ▼  stdin: role-tagged transcript
Claude Code subprocess
   │
   ▼  stdout: { type:"result", result, usage, total_cost_usd, ... }
translate()
   │
   ▼
StreamChunk[]   { block-start, text-delta, block-end, usage, finish }
```

`--max-tokens` is intentionally NOT forwarded. Claude Code CLI 2.1.x rejects it as an unknown option; deployments needing a hard output cap should pin the model in `--settings` or rely on Claude Code's own `max_tokens` policy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the request/response translation behind the adapter; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The bridge collapses `GenerateOptions` to one `claude --print` call and parses the resulting JSON document back into harness `StreamChunk`s. `resolveAdapterOptions()` is the single explicit resolve step from raw config to validated connection facts, and the adapter re-reads those facts per request through the `llm-claude-cli` settings section, so editing the user settings document changes the next request without a restart.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, per-request resolution, settings wiring |
| [`src/adapter.ts`](src/adapter.ts) | The `ClaudeCliAdapter`: invocation building, subprocess execution, idle timeout |
| [`src/serialize.ts`](src/serialize.ts) | Wire serialization: transcript roles, `--system-prompt` assembly, catalog types |
| [`src/translate.ts`](src/translate.ts) | JSON result translation into harness `StreamChunk` values; fenced-JSON tool-call detection |
| — | No runtime invariant companion is published; the adapter owns no independent event sequence or mutable data relation beyond contracts enforced at the LLM seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the service contract to the sibling adapter and the shared protocol.

- [dsh-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [llm-deepseek adapter](../llm-deepseek/README.md) — the API-key sibling serving the `deepseek-official` route.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.

-----

<a id="model-experience"></a>
## Model Experience

### Claude Code CLI request

#### What the model sees

One `claude --print` invocation per request: a role-tagged stdin transcript plus one `--system-prompt` flag, with no adapter-authored prompt prose. Tool calling is disabled (`--allowed-tools ""`, `--max-turns 1`), so the DSH tool loop stays the source of truth for tool execution.

#### Token effect

Counts come from Claude Code's `usage` block and are reported in the standard harness `TokenUsage` shape: disjoint `inputTokens` / `outputTokens` plus optional `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens`. The adapter does NOT inflate input tokens with cache reads — the harness convention is disjoint counts.

#### KV Cache effect

Every call rewrites Claude Code's prompt cache: short conversations can carry cache-write costs that dominate Anthropic-side pricing (a 1-token reply on a 30k-token system prompt can report `cache_creation_input_tokens ~30000`), while long multi-turn sessions amortize the rewrite until the bridge undercuts the API.

### Claude Code CLI response

#### What the model sees

The JSON result document's `result` text becomes harness chunks; detected fenced-JSON tool calls become synthetic blocks with `id: "claude-cli-<n>"`, which is opaque to downstream code and not stable across turns.

#### Token effect

Generated tokens follow Claude Code's own generation policy; the CLI's `total_cost_usd` lands in the session log so deployments can monitor real spend.

#### KV Cache effect

Retained response blocks re-enter later invocations through the rebuilt transcript and reuse Claude Code's cache only where its own retention keeps them; every invocation still pays one cache rewrite.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this V1 prototype stops. They are current package constraints, not a general Claude comparison or a task backlog.

- **No streaming.** V1 reads the full JSON document and emits one text-delta. The wire protocol supports `stream-json`; V2 will use it.
- **Tool-call detection is opportunistic.** The serializer tells Claude Code not to call tools (`--allowed-tools ""`, `--max-turns 1`) so the DSH tool loop stays the source of truth. Claude may still emit fenced JSON blocks like `{"tool":"name","arguments":{...}}`; the translator scans for those and surfaces them as `tool-call` blocks. False-positive risk: any fenced JSON in the response could match if its `tool` field happens to name a registered tool schema. V2 should switch to `--output-format stream-json` for structured events.
- **System-prompt cap.** Claude Code silently truncates very long system prompts. The bridge caps explicitly at `maxSystemPromptChars` (default 32 000 chars) and logs a warning when it kicks in. Deployments with large `peck-docs` workspaces should grow the cap.
- **Cache write cost.** Every call rewrites the cache. Short calls are more expensive than the Anthropic API; long-running sessions amortize. The bridge surfaces `total_cost_usd` in the session log so deployments can monitor real spend.
- **No image input.** V1 advertises `inputModalities: ['text']` only. Anthropic image support requires the native Messages API, which Claude Code's `--print` does not expose.
- **No native Anthropic tool-call shape.** The bridge emits synthetic tool-call blocks with `id: "claude-cli-<n>"` because Claude Code does not produce Anthropic-format call ids in `--print` mode. DSH's tool loop will execute the call and replay the result; the synthetic id is not stable across turns and is intended to be opaque to downstream code.
- **OAuth-only authentication.** The package requires no API key and refuses to send one if present. A failed `claude --print` invocation surfaces as `LlmError('AUTH')` with stderr details — Claude Code's `/login` flow is the user's responsibility.

Deferred work:

- `stream-json` output for true SSE-streaming into the harness.
- Vision input via Anthropic-format image blocks.
- A small `--bare`-mode sidecar that exposes Anthropic-format HTTP directly from Claude Code's internal session; this would replace the subprocess adapter entirely and unlock native tool-calls, vision, and prompt-cache reuse without the per-call rewrite.
- Configurable retry policy on subprocess failures (e.g. transient ECONNRESET to OAuth endpoint).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
