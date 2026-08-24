# Agent Note: Inspect registry serves queries through a live holder

Status: implemented

English | [中文](2026-08-22-inspect-registry-live-holder.zh.md)

## Problem

The Host Cordis inspect registry deduplicated provider ids across preset mounts by storing the first mount's registration and counting later mounts of the same id as references. When the first mounting preset unloaded while another holder stayed mounted, the shared entry survived with a positive reference count while its query handler still closed over the disposed preset's context, so inspect queries executed against a dead context. The existing regression test only asserted that the id remained listed after disposal and never invoked the surviving handler.

## Decision

`register()` now appends each mount's registration to a per-id list. A mount's disposer removes exactly its own entry, and the id is evicted only when that last entry goes. Host queries and `list()` views resolve to the most recently registered live entry and fall back to earlier entries as newer holders dispose, so every executed handler belongs to a context that is still mounted.

## Alternatives considered

**Reject conflicting same-id registrations.** Rejected because today's static providers register identical manifests from every preset copy, so a hard failure would reintroduce the session-creation breakage the shared id exists to prevent, while doing nothing about the disposed-closure hazard itself.

**Keep first-wins storage and rebind the stored handler on disposal.** Rejected because it moves mutable rebinding into the query path; the ordered per-id list makes ownership explicit and disposal removes one entry at constant cost.

**Make static providers host-owned singletons resolved against the active agent.** Rejected as a larger refactor across `tool-cordis` and preset composition; the per-holder list fixes the hazard without changing who registers providers.

## Verification

`inspect-registry.spec.ts` executes queries after the first holder disposes and asserts the surviving handler answers; asserts newest-wins while multiple holders are live plus fallback after the newest disposes; covers rejection for an unregistered host provider id; and treats repeated disposal as a no-op in both orders (splice then reuse, evict then reuse).

## Consequences

A shared provider id always routes to a mounted context. Last-registration-wins also means two holders registering different manifests under one id serve the newest manifest — the behavior dynamic plugin replacement needs — while identical static manifests are unaffected. Disposal remains constant-time per mount, and the reference-count map is gone.
