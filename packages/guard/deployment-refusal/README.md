---
description: "Startup gate over declared deployment facts: refuses boot before readiness for the remote + unauthenticated + danger-full-access combination, for operators and maintainers securing a bridged deployment."
kind: "package-reference"
---

# @deepseek-ai/dsh-guard-deployment-refusal

English | [中文](README.zh.md)

## Summary

A loopback-bound process says nothing about who can actually reach it: an external socat bridge, reverse proxy, or port forward creates remote reachability the socket cannot see. `dsh-guard-deployment-refusal` fails harness startup before any readiness effect whenever the operator's declaration combines non-loopback reachability, absent application authentication, and the `danger-full-access` permission preset. The facts are read from configuration only — never detected. The common case is one row mounted early; the refusal names all three facts and exactly one remediation changes the outcome.

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

The common path is one row mounted early in the composition — before server/readiness rows — so a refusal aborts boot before anything announces readiness. A deployment with no remote bridging declares nothing: the defaults describe a loopback-only socket and the guard passes without reading the permission owner.

### When to choose it

Choose it when the deployment's socket is reachable beyond the loopback host through any bridge — socat/WireGuard, a reverse proxy, or any external forwarder — and you want startup itself to refuse the dangerous combination rather than relying on runtime checks. Avoid it for purely local development with no bridging: the defaults already pass, and the row adds no protection.

### Minimal configuration

```yaml
- id: deployment-refusal
  name: '@deepseek-ai/dsh-guard-deployment-refusal'
  config:
    exposure: remote-declared   # default 'loopback-only'; who can reach this socket through bridges included
    authKind: none              # default 'none'; 'token' = real application authentication composed
```

`exposure: 'remote-declared'` is the honest declaration for a loopback-bound process fronted by socat/WireGuard, a proxy, or any external forwarder. `authKind: 'none'` is also the correct value for deployments whose only request fence is `trustedHosts` — browser-trust fencing is not application authentication and never satisfies `authKind`.

| Field | Default | Meaning |
|---|---|---|
| `exposure` | `'loopback-only'` | Declared reachability of this socket, bridges included |
| `authKind` | `'none'` | Application-authentication mechanism composed in front of the API surface |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-guard-deployment-refusal) is the exhaustive source for every accepted field and its JSDoc.

### What you get

The effective permission preset is not configured here: the plugin reads `ctx.sandboxPolicy.defaultMode` from its owning service — the same deployment default beneath per-session overrides that execution resolves. A `remote-declared` profile with no composed `ctx.sandboxPolicy` service refuses with a missing-fact error instead of guessing. The plugin ships composed nowhere: no shipped profile's config changes by installing this package; a deployment opts in by adding the row to its own composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the refusal predicate and where each fact comes from; the observable behavior is fully covered in [Use this package](#use-this-package).

### Refusal rule

| `exposure` | `authKind` | Effective preset | Outcome |
|---|---|---|---|
| `loopback-only` | either | either | starts |
| `remote-declared` | `token` | either | starts |
| `remote-declared` | `none` | below `danger-full-access` | starts |
| `remote-declared` | `none` | `danger-full-access` | **refuses before readiness** |

The permission read is intentionally optional (`ctx.get('sandboxPolicy')`): a loopback-only declaration never requires the owner, and declaring an injection would make the row wait forever on a missing provider instead of failing loud under a remote declaration.

A refusal error names all three facts and exactly one remediation changes the outcome:

- declare `exposure: 'loopback-only'` when nothing bridges this socket beyond the loopback host;
- compose real application authentication and set `authKind` to its kind (e.g. `'token'`) — `trustedHosts`/Host/Origin checks are not authentication;
- move the effective permission preset below `danger-full-access` (`sandboxPolicy` config `mode`, e.g. `read-only` or `workspace-write`).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, declared-fact resolution, the refusal rule |
| — | No runtime invariant companion is published; the guard registers no services, events, or effects and owns no mutable data — its entire contract is the synchronous apply-time evaluation, enforced by the package tests. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the guard blocks a deployment or the refusal predicate is not enough. They move from the owning permission service to the policy vocabulary and the group map.

- [Sandbox policy](../../../packages/sandbox/sandbox-policy/README.md) — the owning service behind `ctx.sandboxPolicy.defaultMode`.
- [Sandbox subsystem](../../../docs/subsystems/sandbox.md) — the permission-mode vocabulary and per-session overrides.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Startup evaluation

#### What the model sees

Nothing. The `deployment-refusal` plugin registers no prompt section, tool schema, session event, or model-visible context of any kind; on a refusal the process fails before readiness, so no session exists for a model to join.

#### Token effect

Zero tokens in every case: the evaluation runs at plugin activation over configuration values and never touches requests or history.

#### KV Cache effect

None. The plugin contributes nothing to any request prefix or cache key.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this guard is a poor fit. They are current package constraints, not a task backlog.

- **Deployment-default scope** — the guard validates `ctx.sandboxPolicy.defaultMode` at startup; per-session `sandbox/mode` overrides switched later at runtime are not re-evaluated.
- **Declared facts only, by design** — a deployment that actually reaches remotely but declares `exposure: 'loopback-only'` gets no protection; detection would contradict the declared-fact contract this package exists to enforce.
- **`authKind` is a declaration, not enforcement** — setting `'token'` does not install any authenticating proxy; it only records that one is composed, so a false declaration silences the guard.
- **Only the sandbox half of presets is consulted** — the approval-policy knob (`ask`/`never`) is not part of the refusal predicate; `danger-full-access` alone triggers it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
