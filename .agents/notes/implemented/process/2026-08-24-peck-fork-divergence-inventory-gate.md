# Agent Note: Executable fork-divergence inventory gate

Status: implemented

English | [中文](2026-08-24-peck-fork-divergence-inventory-gate.zh.md)

## Problem

The fork's changes scatter across upstream-shared files — packages, scripts, workflows, branding — while wholly peck-owned additions grow beside them. Nothing rejected a change that touched an upstream-owned path without recording why the fork owns that divergence, so the divergent-path set was known only through ad hoc audit counts (roughly 148, then 172, then 173 at successive audits), each stale the moment it was written. An upstream sync therefore had no mechanical guarantee that newly exposed paths get classified before landing on the fork trunk, and no single place stated which divergences are meant to be upstreamed versus re-applied forever.

## Decision

[docs/peck-fork.md](../../../../docs/peck-fork.md) is the ownership inventory of the fork versus upstream, and [scripts/verify-peck-fork.ts](../../../../scripts/verify-peck-fork.ts) is its executable half, registered as the `verify-peck-fork` gate inside `doc-sync`'s leaf list (`scripts/run-gates.ts`, root `package.json`). The gate pins one upstream merge-base SHA, runs `git diff --name-only <merge-base>...HEAD` through local git only, and requires every returned path to match a pattern in the embedded `FORK_PATH_GROUPS` manifest. A missing baseline fails with the refresh commands; an unmatched path fails naming the path and both update locations — the manifest array and the inventory table. The inventory classifies the current divergence into ten groups spanning peck-owned decision records, CI adjustments, runbooks, security metadata, regenerated references, peck-owned packages, features on upstream-shared packages, naming and visual identity, workspace registration, and the gate itself.

The classifier is pure: glob matching, diff parsing, and group assignment are exported functions, and the git boundary is an injectable runner, so [scripts/verify-peck-fork.spec.ts](../../../../scripts/verify-peck-fork.spec.ts) covers pass, unclassified, missing-baseline, and pattern edge cases against synthetic lists without a real repository or network. The manifest is embedded in the script rather than stored as JSON or parsed back out of the documentation: the script is the enforcement authority, the documentation table is its reviewed counterpart, and embedding keeps the pattern list next to the retirement criteria in one typed constant, following the membership-rule precedent in `scripts/coverage-exempt.ts`. Working-tree-only changes stay invisible by design — the gate measures committed divergence against the pinned base, which is the state an upstream sync consumes.

## Alternatives considered

**A JSON manifest beside the script.** Rejected: it adds a second file whose only consumer is the same gate, with import-path and type-drift risk for no separation benefit.

**Parsing patterns out of docs/peck-fork.md.** Rejected: making enforcement depend on reviewed prose formatting turns every documentation edit into a potential gate break, and it inverts the authority — the doc states facts for review, the code enforces them.

**Tests against real git state.** Rejected per the testing policy's aversion to mutable external state; the injected-runner design proves the identical failure output deterministically instead.

## Consequences

Every future divergent path fails `doc-sync` until it is classified, so the inventory cannot silently rot the way the audit counts did; the price is one manifest-and-table edit per genuinely new kind of divergence. Upstream syncs now carry a defined owner procedure — refresh the pinned SHA, reclassify, retire absorbed divergence — recorded in the inventory's refresh section. The gate checks completeness of classification, not correctness of any group's claims: a path filed under the wrong group still passes, which review owns. The fork workflow this gate serves is the standing order in [the fork workflow note](2026-08-18-agent-workflow-in-the-peck-fork.md).
