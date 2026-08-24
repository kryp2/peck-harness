# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-08-24 (audit-batch: 4 PR-er merget, #13–#16)_

## Sist gjort
- 24.08: **Codex-audit-batch landet** (rapport: `reports/PECK_HARNESS_AUDIT_2026-08-22.md`). #13 inspect-registry: per-holder registrering — spørringer/list() kjører mot nyeste *levende* holder og faller tilbake ved disposal (første holders døde ctx ble tidligere værende). #14 telegram-answerer: drain-before-send via `getUpdates?offset=-1` + persistant offset-kursor på tvers av asks, nonce + `message_id`-korrelasjon av callbacks (stale presses ignoreres), `{ok:false}`-validering på send, token ut av argv (env-var), asks serialisert bak én kø. #15 regresjonstester: legacy inbox-replay (`core/agent/tests/inbox.spec.ts`) + peck-fugl-brandart; lukker coverage-debt på `BrandWordmark.tsx` og `inbox.ts`. #16 runbook-fiks: BUILD_PLAN-attribusjon/fork-mekanikk korrigert mot GITHUB_WORKFLOW, mutable deploy-tilstand flyttet ut av DEPLOYMENT_TRAPS hit.
- CI-status etter merge: static/coverage/snapshots/windows-native er fortsatt røde på master, men feilene er **baseline-gjeld, ikke fra denne batchen** (unntatt: coverage-jobben er nå GRØNN etter #15).

## Neste
- Topologiforslag for hostet flerbruker (wallet-login + sandbox-per-bruker + llm.peck.to-måling): `.agents/notes/proposed/architecture/2026-08-24-hosted-multi-user-topology.md` — fase 1 = betalt kanary på denne toppologien; lokal workspace-bro er eksplisitt fase 2.
- Gjenstår fra auditen: P0 WireGuard-flaten (app-auth/preflight-nekt ved non-loopback + danger-full-access), receipt-signaturverifisering + kanonisering før paid canary, first-answer-wins racing-registry i user-questions, deploy-manifest + preflight/rollback, Peck composition layer.
- CI-baseline-gjeld: 9 lint-feil (receipt.spec ×4, translate.spec ×1, user-questions ×2, inbox.ts no-unnecessary-condition); `hmr-live.e2e` feiler i runner; windows-native meta-test (`scripts/ci-workflow.spec.ts`) strider med PR #12 sitt dispatch-only-valg; coverage-debt i llm-claude-cli/session-metered-receipt/user-questions.

## Blokkert / venter på
- Upstream er pull-only speiling; sync = fetch upstream + merge inn i kryp2/peck-harness.
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`; node_modules reinstallert på 11.7.0 (purge godkjent av Thomas 22.08).
