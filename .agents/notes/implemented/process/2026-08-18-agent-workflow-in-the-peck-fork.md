# Agent Note: How agents build the Peck Harness fork

Status: implemented

English | [中文](2026-08-18-agent-workflow-in-the-peck-fork.zh.md)

## Problem

Agents — harness sessions and external CLI agents alike — build the Peck distribution inside `kryp2/deepseek-harness` under the [distribution plan](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.md), but the fork's mechanics differ from the upstream workflow the repository documentation assumes. A fork cannot host pull requests against itself, the local toolchain drifted from the manifest's pnpm pin, and a mid-session preset storm could silently recompose a session under the wrong composition ([expired stage](../bug-fix/2026-08-18-agent-preset-stage-expires.md)). An agent inferring its workflow from upstream documentation alone would open PRs that cannot exist, trigger a node_modules purge under the live web server, or build on a stale master.

## Decision

Standing order for work in the fork:

**Baseline.** `master` tracks the reviewed upstream baseline by fast-forward (at the time, dsh-0.1.0-rc.7). Peck work branches from the baseline; upstream syncs land as an owner fast-forward of master, never as mixed content.

**No in-fork PRs, no upstream PRs.** GitHub forks host no pull requests against themselves, and upstream currently declines external pull requests outright (its CONTRIBUTING). A change lands as a named branch pushed to origin and merges to the fork trunk once its checks pass; a generic fix worth sharing upstream goes through GitHub Discussions as a bug report with the fix attached, and Peck behavior stays in plugins and the `peck` bundle, which is the distribution plan's shape anyway.

**Checks ladder.** The pre-push hook runs the incremental typecheck; GUI changes run `test:gui`; each touched package proves its own focused coverage; documentation runs `doc-sync`; assembled browser output runs `DSH_SNAPSHOT=replay` `test:web`. Three web e2e files fail identically with and without changes on this machine — `agent-preset-selection`, `skill-invocation-policy`, `skill-user-invoke` — a pre-existing local skill-discovery environment failure, not a regression; a change is judged against that baseline, not against a green fantasy.

**Toolchain.** The checkout's node_modules was built by pnpm 9.15.9 while the manifest pins 11.7.0. Pnpm runs must not attempt a modules-directory purge while the live `dsh web` server serves from this checkout; bringing the install to the manifest pin is a deliberate maintenance window, never a side effect of another task.

**Attribution.** The machine-global `prepare-commit-msg` hook stamps `Co-authored-by: peck-harness/<model> <peck-harness+<model>@agents.peck.to>` on every agent commit, strips any attribution an agent wrote by hand, and `pre-push` refuses a push that lacks it. An agent therefore writes no attribution at all — no `Co-authored-by:` line, no `Agent:` line, in a commit message or anywhere else. The earlier instruction to carry them by hand is what produced eight different invented addresses across the monorepo, one of which GitHub folded into the author so the agent vanished from the commit. The harness identity is `peck-harness/<model>`; `dsh-peck` is an alias that `agent-id` normalises away, and a session id is never a model name.

**Presets.** Sessions compose from the Peck.to preset by user-settings default; PTC code mode serves code-mode work only. The stage storm that could recompose a session mid-flight is fixed; a new session starts on the preset its creator chose.

**Coordination.** One fork issue is the epic for the cross-repository dependency graph; every work item names one repository, one base commit, allowed paths, and one stable agent identity, and leaf agents return source changes plus generation instructions instead of racing on shared artifacts.

## Alternatives considered

**Merge the mixed generic-and-Peck branch intact.** Rejected by the distribution plan: every upstream sync would become product-specific conflict resolution.

**Host review inside the fork.** Impossible — GitHub forks take no PRs against themselves; the branch-plus-target flow above is what exists.

**Let each agent discover the mechanics by failure.** The failures are expensive (a purge kills the live server, a stale master pollutes every diff) and the knowledge is stable; one note is cheaper than repeated discovery.

## Consequences

An agent starting work in the fork reads one note instead of inferring mechanics from upstream documentation. The epic issue tracks work items across repositories, and the baseline fast-forward keeps every Peck diff readable against upstream. Sharing a generic fix upstream means a Discussions post rather than a PR — recorded here so no agent spends a session discovering the OAuth limit or the closed PR door.
