# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-08-24 (bølge 1 kjørt: PR #18–#21 merget)_

## Sist gjort
- 24.08: **Bølge 1 fra oppgavebriefene (peck-to/reports/TASKS_2026_08_24/) fullført**: #18 legacy inbox boundary typet ærlig via `PersistedInboxEntry` + type guard (siste kjente lint-feil i core/agent borte). #19 llm-claude-cli 100 % fokusert coverage på src/{adapter,index,invariant,serialize,translate}, +25 tester, lint null. #20 metered-receipt: typed vector-fikstur, alle brancher dekket, 12 tester, lint null. #21 `docs/peck-fork.md` + `verify-peck-fork`-gate: alle 183 divergente stier klassifisert i 10 eiergrupper mot pinnet merge-base; uklassifisert upstream-eid endring feiler nå doc-sync med actionable output. doc-sync = 29/29.
- 24.08: Codex Runde 1 leverte 17 oppgavebriefe med bølgeindeks; QA-et mot kodetilstand — alle faktapåstander verifisert (5 receipt-lint-diagnostikker, 2 av 16 ci-meta-tester, hmr-live.e2e grønn standalone, merge-base + 172→173 stier).
- Tidligere 24.08: audit-batch #13–#16 og toppologi-noten #17 (se git-logg).

## Neste
- **Thomas må ta fire beslutninger** (briefe klare i TASKS-mappen): 02 first-answer-wins-semantikk (låser task 10 racing-registry), 03 canary-isolering E2B vs egen VM/gVisor (låser task 14), 04 ci-master-policy dispatch-only vs push-trigger (låser task 12), 01 receipt-trust-protokoll ([HOLD]-spesifikasjon; låser all betalingsoppfølging).
- Bølge 2 etter beslutningene: 10 racing-answerers (absorberer user-questions lint+coverage-debt), 11 deployment-refusal-guard ([HOLD]), 12 ci-meta-test-align.
- Bølge 3/4: 13 Peck composition layer, 15 keyless canary, 14 sandbox-hardening ([HOLD]), 16 deploy-preflight/rollback ([HOLD]).
- CI-restgjeld: hmr-live.e2e feiler kun i runner (passerer standalone verifisert — diagnosebrief 05 klar til kjøring).

## Blokkert / venter på
- **Prod-peck-stacken kjører på b550 siden 24.08** (P15 beholder dev-harnessen foreløpig; flytting av harness dit «når den er klar»). Når den flyttes: land task 16 (immutable deploy-manifest) og task 11 (refusal guard) FØRST — migrering er det billigste øyeblikket å slutte med mutabel home-profil-patch, og b550 må ikke eksponeres uten app-auth.
- Upstream er pull-only speiling; sync = fetch upstream + merge inn i kryp2/peck-harness. Etter hver sync: refresh `UPSTREAM_MERGE_BASE` i scripts/verify-peck-fork.ts og re-klassifiser nye stier (gate feiler ellers med refresh-instruks).
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`; node_modules reinstallert på 11.7.0 (purge godkjent av Thomas 22.08).
