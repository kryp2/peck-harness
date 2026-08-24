# Agent Note: Deployment refusal guard over declared facts

Status: implemented

English | [中文](2026-08-24-deployment-refusal-guard.zh.md)

## Problem

The audit's P0: a harness deployment can end up reachable off-host while running with no application authentication and the `danger-full-access` permission preset — remote unauthenticated code execution. The runtime cannot detect this state from the process alone: `dsh web` binds the loopback interface by design (`--host 0.0.0.0` is refused at the command line), while an external socat bridge over WireGuard creates the actual reachability. Socket and interface inspection therefore cannot infer exposure, and `trustedHosts`/Host/Origin fencing is browser-trust enforcement, not authentication ([the carrier-level browser-trust-boundary Agent Note](2026-07-28-api-browser-trust-boundary.md) owns that fence and defers remote-deployment authentication). A guard built on detection would either misread every deployment or demand infrastructure changes this repository does not own.

## Decision

`packages/guard/deployment-refusal` (`@deepseek-ai/dsh-guard-deployment-refusal`) is a function plugin whose activation evaluates three declared facts and throws before readiness when they combine dangerously:

1. **Reachability** — `exposure: 'loopback-only' | 'remote-declared'`, a new explicit declaration owned by the guard's `Config`. `'remote-declared'` is the honest value for a loopback-bound process fronted by socat/WireGuard or any external forwarder; nothing about the local bind address changes its meaning.
2. **Application authentication** — `authKind: 'none' | 'token'`, also declared in the guard's `Config` with fail-safe default `'none'`. No application-auth mechanism exists in the host stack today, so `'none'` is the only truthful default; `'token'` records that a deployment composed one.
3. **Effective permission preset** — read from the owning service, `ctx.sandboxPolicy.defaultMode`, never duplicated into guard config. That service already owns the file-effect mode execution resolves beneath per-session overrides, so the guard validates exactly the value execution uses. The preset table's `danger-full-access` entry bundles sandbox mode `danger-full-access`; the sandbox mode is the operative fact and the predicate keys on it.

The rule refuses exactly when exposure is declared remote AND auth is `'none'` AND the effective mode is `'danger-full-access'`; loopback-only declarations never consult the other facts. A `remote-declared` profile whose permission owner is missing fails loud with a missing-fact error instead of guessing (misconfiguration-fails-loud rule). The plugin registers no services, events, or tools — a refusal is a synchronous throw inside Loader tree start, which by construction precedes any later readiness row (URL line, browser handoff wait for Loader settlement). It ships composed nowhere: no shipped profile changes behavior; a deployment opts in through its own composition row, mounted early.

## Alternatives considered

**Infer exposure by socket/interface inspection.** Rejected as unsound for this product: the process binds loopback while an external bridge creates reachability, so every inference is wrong in the dangerous direction (a fully exposed deployment reads as loopback-safe). Detection would also silently change meaning when operators move the bridge, the one thing this design cannot afford for a security gate.

**Treat `trustedHosts` presence as authentication.** Rejected outright: Host/Origin fencing protects browser surfaces from DNS rebinding and cross-origin requests; it authenticates no client and is trivially absent for non-browser callers. The refusal message names this explicitly so nobody "remediates" by adding trust entries.

**Read the permission fact from `permission-presets` config.** Rejected because the preset service is an optional user-facing layer over the knobs, not the owner: deployments without it still execute under `ctx.sandboxPolicy.defaultMode`, and duplicating preset-table knowledge into a guard would create a second place presets could drift.

**Enforce at request time instead of startup.** Rejected for this mitigation class: per-request interception cannot give the operator the fail-at-boot property the audit demands, would run on every tool call, and still leaves a window where a ready-but-dangerous deployment serves traffic.

## Consequences

The dangerous combination now fails loudly at boot with all three facts named and one-action remediations, while every safe combination boots unchanged and least-privilege or authenticated remote deployments remain expressible. The cost of declared facts cuts both ways: a deployment that reaches remotely but declares `loopback-only` gets no protection, and declaring `token` without actually composing authentication silences the guard — both are documented limitations rather than fixable defects, because any heuristic reintroduces the unsoundness the declared-fact contract removes. Runtime `sandbox/mode` switches after boot are out of scope; the guard pins the deployment default, not per-session policy. Verification lives in the package suite: the eight-combination truth table, message-content assertions, the missing-owner failure, and one real Loader composition proving a refusal aborts boot while the same tree under a loopback-only declaration starts.
