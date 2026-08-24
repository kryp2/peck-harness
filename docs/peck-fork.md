# Peck fork divergence inventory

English | [中文](peck-fork.zh.md)

This reference inventories every path this fork changes relative to upstream `deepseek-ai/deepseek-harness`, and states for each class of divergence who owns it, what retires it, and what validates it today. The executable counterpart is [scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts), which rejects any divergent path no group claims. Vendored Cordis divergence is a separate mechanism with its own manifest and sync procedure in [vendor/README.md](../vendor/README.md); this page covers everything else.

## Baseline and enforcement

Divergence is measured against one pinned upstream merge-base: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. That SHA lives in the `UPSTREAM_MERGE_BASE` constant of [scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts) as its single home; this page repeats it for review only.

`pnpm run verify-peck-fork`, part of `doc-sync`, runs `git diff --name-only <merge-base>...HEAD` with local git only, and requires every returned path to match a pattern in the script's `FORK_PATH_GROUPS` manifest. A merge-base missing from history fails with refresh instructions; an unmatched path fails naming the path plus both update locations, the manifest array in the script and the ownership table below. The script manifest is the enforcement authority; the table here is its reviewed human counterpart, so a group edit lands in both files in one change.

## Refresh procedure

After every upstream sync, or whenever the gate reports a missing baseline:

1. Run `git fetch upstream && git merge-base upstream/master HEAD`, and record the resulting SHA in `UPSTREAM_MERGE_BASE` ([scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts)) and in the section above within the same change.
2. Run `git diff --name-only <new-base>...HEAD` and classify every new path into an existing group, or open a new table row together with its manifest entry.
3. Re-read each touched group's retirement criterion: a sync is the moment to drop divergence upstream has absorbed.
4. Run `npx -y pnpm@11.7.0 exec tsx scripts/verify-peck-fork.ts` until it passes, then `pnpm run doc-sync`.

## Ownership groups

| Group | Owner | Allowed paths | Upstreaming / retirement | Validation today |
|---|---|---|---|---|
| Agent Notes (fork decision records) | peck | `.agents/notes/**` | Decisions stay until archived; generic fixes go upstream through GitHub Discussions | `verify-agent-note-classification`, `verify-agent-note-format`, translation pairing |
| Fork CI workflow adjustments | peck | `.github/workflows/*.yml`, `scripts/ci-workflow.spec.ts` | Reverts once upstream trigger budgets and runner labels work for this fork | `scripts/ci-workflow.spec.ts` |
| Fork runbooks and status documents | peck | `IN_FLIGHT.md`, `PECK_DEPLOYMENT_TRAPS.md`, `PECK_HARNESS_BUILD_PLAN.md` | Deleted when the distribution plan completes and fork operations match upstream documentation | Markdown gates (`verify-md-links`, `verify-md-wrap`) |
| Repository security metadata | peck | `.gitleaksignore` | Entries drop when the flagged false positive disappears | gitleaks scanning |
| Regenerated references and paired counterparts | upstream-shared | `THIRD_PARTY_NOTICES.md`, `docs/config-catalog.*`, `docs/event-producer-consumer.*`, `docs/persistence-catalog.*`, `docs/subsystems/extensions.*`, `docs/subsystems/user-questions.*`, `packages/core/scope/src/scoped-events.generated.ts` | Never retired separately; generators re-derive them from whatever the diverged sources contain | catalog freshness gates in `doc-sync`; lefthook regenerates notices on dependency changes |
| Peck-owned packages | peck | `packages/interaction/telegram-answerer/**`, `packages/llm/llm-claude-cli/**`, `packages/session/session-metered-receipt/**`, `packages/session/session-usage/**` | Offered upstream as whole packages through GitHub Discussions if adopted; otherwise permanent fork payload | package vitest suites under `pnpm run test`; README pairing gates |
| Feature work on upstream-shared packages | upstream-shared | `packages/core/agent/**`, `packages/core/session/src/known-event-types.ts`, `packages/client/ui-agent-preset/**`, `packages/extensions/cordis-host-runner/**`, `packages/extensions/tool-cordis/**`, `packages/host/apiproxy/**`, `packages/interaction/README.*`, `packages/interaction/tool-ask-user/**`, `packages/interaction/user-questions/**`, `packages/plan/plan-mode/tests/plan-mode.spec.ts`, `packages/session/README.*` | Each change goes upstream through GitHub Discussions when generic, else is deliberately re-applied across every sync | package vitest suites; affected `doc-sync` gates |
| Fork naming and visual identity | upstream-shared | `apps/cli/config/agent-presets/cordis/agent.cordis.yml`, `apps/web/index.html`, `apps/web/public/**`, `apps/web/tests/**`, `packages/bundle/web-app/**`, `packages/client/ui-brand-official/**`, `packages/client/ui-conversation/**`, `packages/client/ui-primitives/**`, `packages/client/ui-theme/**`, `packages/core/system-prompt/src/index.ts`, `scripts/client-build-environment.client.spec.ts`, `scripts/client-build-environment.ts` | Never upstreamed while the product runs under the Peck name; re-applied across every sync | client vitest specs, web snapshot expectations, branding e2e tests |
| Workspace and gate registration of peck packages | upstream-shared | `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.host.json`, `scripts/gen-cordis-catalog.ts`, `scripts/verify-package-readme-model-experience.ts` | Regenerates or re-applies whenever peck-package membership changes; never upstreamed alone | `constraints`, `verify-runtime-closure`, catalog freshness gates |
| Fork inventory gate and its registration | peck | `docs/peck-fork.i18n.yaml`, `docs/peck-fork.md`, `docs/peck-fork.zh.md`, `package.json`, `scripts/run-gates.ts`, `scripts/verify-peck-fork.spec.ts`, `scripts/verify-peck-fork.ts` | Permanent fork plumbing; retiring it means upstream adopted the divergence gate itself | `verify-peck-fork` and `run-gates.spec.ts` |

## Responsibilities

Every author of a fork change keeps the inventory complete: a PR that adds, moves, or deletes a divergent path extends the matching manifest entry and table row in the same change, and the gate makes an omission impossible to merge unnoticed once registered.

The integration owner performing an upstream sync owns the baseline refresh, the reclassification of newly exposed paths, and the retirement decisions for divergence upstream has absorbed. The owner records the outcome by landing the refreshed baseline and manifest in the sync change itself, so `master` never carries an unclassified divergence window.
