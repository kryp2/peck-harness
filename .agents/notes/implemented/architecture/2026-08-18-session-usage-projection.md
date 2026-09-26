# Agent Note: Per-route usage projection for metered provider accounting

Status: implemented

English | [中文](2026-08-18-session-usage-projection.zh.md)

## Problem

Peck Harness lets one agent session switch between personal subscriptions, user-owned API keys, and metered gateway calls, each with its own billing and usage-reporting rules. Users need to see, per provider route, how much they have consumed without logging into each provider's console. The harness already logs every call's token usage on the `assistant/message` event and every call's `provider`/`model` on the `request/header` and `request/context` events, but nothing folds those facts into a per-route total; `session-stats` only sums output tokens and does not attribute them to a route.

## Decision

A new package `@deepseek-ai/dsh-session-usage` registers a `usageByRoute` projection unit on `ctx.sessionProjections`. The unit folds the whole durable log into one per-route table, keyed by `(provider, model)` and exposed as `{ routes, totalCalls }`.

Attribution keys on the latest `request/header.header.config` or `request/context` `provider`/`model` fields. The agent loop logs both before the request they describe, so each step's `assistant/message` is attributed to the route current when it assembles. The fold keeps a single `lastRoute` pointer rather than per-step custody; this matches the loop's ordering and keeps the state a plain-JSON table.

- `calls` increments on every assembled assistant message whose route is known, even without a usage report.
- Token fields accrue only from finite, non-negative provider reports, guarded like the window fold guards node usage.
- `routes` sorts by descending output tokens; every route the log used appears once.

Cost, external balances, and CLI-agent aggregation are deliberately out of scope: the unit counts tokens and calls, which are stable provider-neutral facts. A `$` price table, the OpenRouter `/credits` fetch, and `usage.jsonl` (codex/claude/opencode CLI agents) belong in later dashboard layers.

## Alternatives considered

**Extend `session-stats` instead of a new unit.** The existing unit's view is a flat wall-time/token summary; folding a route-keyed table into it would mix two different read shapes and force every existing consumer to grow. A separate `usageByRoute` key keeps each unit's schema self-contained and lets a dashboard consume usage without depending on wall-time fields.

**Attribute usage by parsing the assistant message's own source.** The message source carries a provider/model, but it records which route produced that message, not the request configuration, and the loop's authoritative route identity is the `request/header`/`request/context` config. Keying on the logged request config reproduces the pinned route and stays correct across replay.

**Embed a price table in the projection.** Prices are owner-curated, change on provider schedules, and differ per execution class; folding money into a schema-validated wire value would require re-recording the unit on every price change. Tokens are the durable measurement; cost is a later, separately-owned mapping.

## Consequences

- A composed registry always serves the `usageByRoute` key, so consumers read the value, never key presence; mounting the plugin late folds the in-memory log lazily, and unmounting removes the key (HMR safety), matching every other projection unit.
- Attribution is a single pointer, so a message assembled after a mid-session route switch is charged to the new route — consistent with the loop's config-before-request ordering, but not per-step custody. A message with no preceding request config is skipped rather than guessed into a synthetic route.
- Usage figures are only as complete as provider reports: a route whose adapter reports no usage still accumulates `calls` with zero tokens.

This unit is the accounting building block the [pecK distribution and metered routing proposal](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.md) names under "the harness verifies and displays provider-reported usage"; routing, pricing, and receipt settlement build on it in later changes.
