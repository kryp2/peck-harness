# @deepseek-ai/dsh-guard-deployment-refusal

English | [中文](README.zh.md)

A startup gate over declared deployment facts, not a runtime guard: it fails harness startup before any readiness effect whenever the operator's declaration combines non-loopback reachability, absent application authentication, and the `danger-full-access` permission preset. The facts are read from configuration only — never detected. A `dsh web` process binds the loopback interface while an external socat bridge, reverse proxy, or port forward creates the actual reachability, so socket and interface inspection cannot infer exposure; this plugin refuses on exactly what is declared. `trustedHosts`/Host/Origin checks are browser-trust fencing, not application authentication, and never satisfy `authKind`.

## Plugin (namespace: `deployment-refusal`)

A function plugin (`name` / `inject` / `Config` / `apply`) that registers no services, events, or tools: its entire contract is the synchronous evaluation at activation, so there is nothing to dispose and an HMR reload re-runs the same evaluation.

```yaml
- id: deployment-refusal
  name: '@deepseek-ai/dsh-guard-deployment-refusal'
  config:
    exposure: remote-declared   # default 'loopback-only'; who can reach this socket through bridges included
    authKind: none              # default 'none'; 'token' = real application authentication composed
```

`exposure: 'remote-declared'` is the honest declaration for a loopback-bound process fronted by socat/WireGuard, a proxy, or any external forwarder. `authKind: 'none'` is also the correct value for deployments whose only request fence is `trustedHosts`.

The effective permission preset is not configured here: the plugin reads `ctx.sandboxPolicy.defaultMode` from its owning service — the same deployment default beneath per-session overrides that execution resolves. Mount the row early (before server/readiness rows) so a refusal aborts boot before anything announces readiness.

## Refusal rule

| `exposure` | `authKind` | Effective preset | Outcome |
|---|---|---|---|
| `loopback-only` | either | either | starts |
| `remote-declared` | `token` | either | starts |
| `remote-declared` | `none` | below `danger-full-access` | starts |
| `remote-declared` | `none` | `danger-full-access` | **refuses before readiness** |

Misconfiguration fails loud: a `remote-declared` profile with no composed `ctx.sandboxPolicy` service refuses with a missing-fact error instead of guessing. A refusal error names all three facts and exactly one remediation changes the outcome:

- declare `exposure: 'loopback-only'` when nothing bridges this socket beyond the loopback host;
- compose real application authentication and set `authKind` to its kind (e.g. `'token'`) — `trustedHosts`/Host/Origin checks are not authentication;
- move the effective permission preset below `danger-full-access` (`sandboxPolicy` config `mode`, e.g. `read-only` or `workspace-write`).

The plugin ships composed nowhere: no shipped profile's config changes by installing this package. A deployment opts in by adding the row to its own composition.

## Model Experience

### Startup evaluation

#### What the model sees

Nothing. The `deployment-refusal` plugin registers no prompt section, tool schema, session event, or model-visible context of any kind; on a refusal the process fails before readiness, so no session exists for a model to join.

#### Token effect

Zero tokens in every case: the evaluation runs at plugin activation over configuration values and never touches requests or history.

#### KV Cache effect

None. The plugin contributes nothing to any request prefix or cache key.

## Known Limitations and Deferred Work

- **Deployment-default scope** — the guard validates `ctx.sandboxPolicy.defaultMode` at startup; per-session `sandbox/mode` overrides switched later at runtime are not re-evaluated.
- **Declared facts only, by design** — a deployment that actually reaches remotely but declares `exposure: 'loopback-only'` gets no protection; detection would contradict the declared-fact contract this package exists to enforce.
- **`authKind` is a declaration, not enforcement** — setting `'token'` does not install any authenticating proxy; it only records that one is composed, so a false declaration silences the guard.
- **Only the sandbox half of presets is consulted** — the approval-policy knob (`ask`/`never`) is not part of the refusal predicate; `danger-full-access` alone triggers it.
