# Agent Note: fork CI triggers budgeted to releases and manual dispatch

Status: implemented

English | [中文](2026-08-22-fork-ci-trigger-budget.zh.md)

## Problem

This fork pays for hosted Actions minutes from a personal budget. Six workflows fired automatically — `ci.yml`, `ci-master.yml`, `release.yml`, `release-vendor.yml`, `sandbox.yml`, and `e2e.yml` — so an ordinary push or pull request spent minutes on two full pack proofs, the OS×runner sandbox matrix, and the real-API e2e suite that also consumes DeepSeek API credits. August burned through the account's entire included quota mid-month and GitHub stopped starting jobs entirely.

## Decision

Automatic triggers are budgeted to what only automation can prove; everything else moves to tags or manual dispatch.

- `release.yml` and `release-vendor.yml` pack from their release tags (`dsh-v*`, `vendor-*`) or `workflow_dispatch`. The pack proof runs exactly when a release is being cut — the moment its verdict can change a decision — instead of on every change.
- `sandbox.yml` is `workflow_dispatch`-only. It is a reference signal outside the pull-request verdict by design ([rationale](../../implemented/process/2026-07-21-serial-cross-platform-ci-reference.md)); dispatch keeps it available without paying for it on every push.
- `e2e.yml` is `workflow_dispatch`-only and loses its nightly schedule. It spends real API credits in addition to minutes; a maintainer dispatches it when provider behavior is under test.
- `scripts/ci-workflow.spec.ts` pins every shape above, plus the manual-only state of `e2e.yml` and `sandbox.yml`, so a future edit cannot silently reintroduce automatic spend.

The same PR repairs pre-existing drift: commit `e76268ce7e` deleted `issue-lifecycle.yml` and `issue-policy.yml` but left their assertions behind, which kept this spec failing on master.

## Consequences

Monthly Actions spend drops by roughly the pack-proof, sandbox, and nightly-e2e share of the previous bill, at the cost of later feedback: a broken pack is discovered when cutting a release instead of on every pull request, and real-API drift is caught only when someone dispatches the suite. The `.gitleaksignore` entries are line-scoped and must be refreshed whenever an i18n sidecar regroups its records.

## Alternatives considered

Path filters on the pack workflows were rejected because packaging-adjacent changes are common enough to keep burning the budget, and the proof still arrives at times when no release decision depends on it. A self-hosted runner was deferred: zero marginal minute cost, but it adds runner maintenance to a personal VM before the simpler trigger fix has been shown to be insufficient. Relying on `cancel-in-progress` alone (already present on `ci.yml`) was rejected because it bounds concurrency, not the number of paid starts.
