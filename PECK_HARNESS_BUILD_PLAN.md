# Peck Harness build plan (rough working draft)

How this harness executes the [distribution and metered routing plan](.agents/notes/proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.md), and what gets upgraded before real work starts. Status tracker: [epic #3](https://github.com/kryp2/deepseek-harness/issues/3).

## A. Upgrades BEFORE we start (prerequisites, in order)

1. **Land the preset stage-storm fix in the fork trunk** — branch `fix/agent-preset-stage-storm-2026-08-18` (commit `ce623ca641`) is ready; upstream takes no external PRs and has PRs disabled, so the fix lives in the fork trunk; optionally report the bug upstream via GitHub Discussions.
2. **Fix the live deployment** — cherry-pick the fix into the branch the running `dsh web` serves from, rebuild in a coordinated window, verify preset switching works end-to-end (new session starts on Peck.to; no storm).
3. ~~**Toolchain alignment window**~~ — done 2026-08-22: node_modules reinstalled on the pinned pnpm 11.7.0 in a server-down window (see `IN_FLIGHT.md`).
4. **Repair the local e2e environment** — three apps/web files (agent-preset-selection, skill-invocation-policy, skill-user-invoke) fail identically with and without changes on this machine (skill-discovery environment failures). Agents need honest green/red before fan-out begins.
5. **Orchestration setup** — epic #3 is the single tracker; fix the worker model-tier map: cheap leaves (fixtures, docs, eval cases, broad tests) on deepseek-v4-flash; frontier work (wallet crypto, SPV, payment concurrency, settlement, contracts) on v4-pro / gpt-5.6-luna; subscription CLI agents (codex, claude, opencode-go) through the clia plugin; async decisions to Thomas via the telegram bridge.

## B. How the harness is used (execution model)

- One master session (Peck.to preset) orchestrates; fan-out through the DSH `workflow` tool with per-agent `model` overrides, plus `subagent`/`subagent_fork` for single delegations (depth cap 3).
- One work item = ONE repository, one base commit, allowed paths, forbidden shared paths, one unique worktree, one stable agent identity (`peck-harness/<model>`).
- Leaf agents return source changes + generation instructions; the integration owner alone updates shared artifacts (lockfiles, generated catalogs, bundle composition, schema hashes, final snapshots).
- Attribution follows the authoritative runbook (`peck-docs/GITHUB_WORKFLOW.md` in peck-to): the machine-global `prepare-commit-msg` hook writes every `Co-authored-by:` trailer and agents never write one by hand; when an agent contributed to a change, its PR body's FIRST line is `Agent: <harness>/<model>`. `pre-push` refuses a push whose agent commits lack the trailer. PRs touching production, infra, secrets, or smart contracts are `[HOLD]` for Thomas.
- Fork mechanics: the fork (`kryp2/peck-harness`) takes PRs; behavior-changing work lands as a PR from a feature branch and merges once checks pass (subject to `[HOLD]`). Upstream remains pull-only mirroring — sync = fetch upstream + merge into a `sync/upstream-<date>` branch.

## C. Work order (from the codex plan)

- [x] 0. Sync fork master to upstream baseline (rc.7, `99f6f02fec`)
- [x] 1. Preset stage-storm fix — merged to fork master (`ce623ca641`); agent-workflow + plan notes merged (`432ac1315b`); upstream Discussions post pending (token cannot write discussions)
- [x] 2. Split the mixed branch `feat/user-questions-waterfall-telegram` — landed as separate generic and brand/inbox work on master (post-sync repair, fork PR #11)
- [ ] 3. Freeze receipt schema + golden vectors (overlay-schema repo owns; harness + gateway pin one revision)
- [ ] 4. Repair reservation + channel opening (llm-gateway atomic reservation; BRC-100 funding proof after SPV)
- [ ] 5. **Canary**: one metered `deepseek-v4-flash` stream through llm.peck.to — reserve before serve, settle after, signed receipt verified + displayed, balance shown
- [ ] 6. Route catalog + constraint routing + receipt presentation (pinned route per session)
- [ ] 7. Channel close
- [ ] 8. Encrypted session backup (BRC-2, local-first)
- [ ] 9. Anchor receipt batches on BSV

## D. First steps tomorrow

Landed 2026-08-22: the upstream sync merged (PR #10), the GUI post-sync regressions were repaired (PR #11), and `dsh-web.service` was restarted on the rebuilt host. Living status — deployed state, next steps, blockers — lives in [`IN_FLIGHT.md`](IN_FLIGHT.md); this section is no longer a schedule.

## Known environment facts (for any agent)

- `pnpm` must run as `npx -y pnpm@11.7.0` (manifest pin; node_modules reinstalled on 11.7.0, 2026-08-22). Lefthook pre-push runs the incremental typecheck.
- Model routes live in `~/.dsh/settings.yaml`; subscription CLI agents (codex, claude, opencode-go) run through the clia plugin; async decisions go to Thomas via the telegram bridge.
- Session-specific facts are not tracked here — see `IN_FLIGHT.md`.
