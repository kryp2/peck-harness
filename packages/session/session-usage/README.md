---
description: "Per-route token accounting for the session: folds whole-log usage from request config and assembled assistant messages into the usageByRoute read model, for clients rendering usage that paging and compaction cannot change."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-usage

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-session-usage` is a function plugin registering the `usageByRoute` projection unit: whole-log per-route token usage folded from the latest request configuration and assembled assistant messages, served through the session-projection seam (registry snapshot, change feed, and every projection carrier). Clients render per-subscription usage that paging and compaction cannot change, because the fold reads the durable log rather than any windowed view of it.

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

Mount this plugin when clients need a per-route usage read model that survives paging and compaction. It registers the `usageByRoute` projection unit on the session-projection registry; the fold itself is fixed by the projection definition.

### When to choose it

Choose it when a UI or billing surface must show per-route token usage — which provider/model pair spent what across the whole session — regardless of which log window is currently paged in or what compaction has summarized away. Assemblies with no such surface leave it out: the unit only computes a client-facing read model and changes nothing model-facing.

### Minimal configuration

```yaml
- id: session-usage
  name: '@deepseek-ai/dsh-session-usage'
```

| Field | Default | Meaning |
|---|---|---|
| (no config fields) | — | The package takes no plugin Config; the fold is fixed by the projection definition |

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

### What you get

A composed registry always serves the key, so clients read the value, never key presence. `routes` lists each route the log used once, descending by output tokens; `totalCalls` sums call counts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold semantics behind the read model; the observable behavior is fully covered in [Use this package](#use-this-package).

### Fold semantics

- Attribution keys on the latest `request/header` (config `provider`/`model`) or `request/context` (its own `provider`/`model`) fields. The agent loop logs both before the request they describe, so each step's `assistant/message` is attributed to the route current when it assembles.
- `calls` increments on every assembled assistant message whose route is known, even without a usage report (a max-tokens usage-host message is still one completed call).
- Token fields (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`) accrue only when the message reports finite non-negative counts; a malformed report is guarded like the window fold guards node usage and contributes nothing.
- Counts are disjoint, matching `TokenUsage`: `inputTokens` is uncached input, cached input is the cache fields, and `reasoningTokens` is an output subdivision.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`apply`, registration effect |
| [`src/projection.ts`](src/projection.ts) | The `usageByRoute` projection definition and fold |
| [`src/types.ts`](src/types.ts) + [`src/client.ts`](src/client.ts) | Single-source projection-key types; host (`./types`) and client (`./client`) namespace projections |
| — | No runtime invariant companion is published; the whole-log fold contract is enforced by the projection tests. |
| — | Client-namespace ownership is a repo-wide discipline; the only fork-authored contract here is the whole-log fold, enforced by the projection tests. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when a usage figure surprises or the key is missing. They move from the projection infrastructure to the spend-side sibling.

- [session-projection capability](../session-projection/README.md) — the projection registry this unit registers on.
- [Token meter subsystem](../../../docs/subsystems/token-meter.md) — how token figures flow into the usage read model.
- [session-metered-receipt](../session-metered-receipt/README.md) — the sibling unit tracking verified paid-inference receipts and satoshi charges.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this usage fold stops. They are current package constraints, not a task backlog.

- **Attribution is a single pointer, not per-step custody** — the fold attributes each message to the latest request config, so a message assembled after a mid-session config switch is attributed to the new route; this matches the loop's ordering (config is logged before the request it describes).
- **Usage is provider-reported and optional** — a route whose provider reports no usage still accumulates `calls` but zero tokens; token figures are only as complete as the adapters' reports.
- **No cost, balance, or CLI-agent aggregation** — this unit counts tokens and calls only; `$` pricing, external balances (`/credits`), and `usage.jsonl` (codex/claude/opencode CLI agents) live in later dashboard layers, not here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
