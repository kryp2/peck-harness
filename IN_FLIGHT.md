# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-08-24 (bølge 0–2 kjørt: PR #18–#23 merget, #86 åpen [HOLD])_

## Sist gjort
- 24.08: **Alle fire beslutningene tatt av Thomas**: true racing (02), egen VM+gVisor/Docker for canary-isolering (03 — task 14-brief må revideres mot infra-repo før oppdrag), dispatch-only ci-master (04), receipt-spesifikasjon green-lightet (01).
- 24.08: **Bølge 1+2 landet**: #18 inbox boundary-typing, #19 claude-cli 100 % coverage, #20 metered-receipt typed vectors + 100 % coverage, #21 fork-divergence-inventar + `verify-peck-fork`-gate (183 stier/10 grupper), #22 ci-meta-test alignert til dispatch-only (+`.github/AGENTS.md`-linje, klassifisert i fork-ci-gruppen), **#23 TRUE RACING** for user-questions: samtidig dispatch til alle answerers, settle-once, kansellering ned i telegram long-poll, web-superseded UX, telegram editMessageText «(answered elsewhere)» kun ved SUPERSEDED; lint-feilene :173/:175 borte; user-questions 100 % coverage; 436 tester i målsuitene. doc-sync 29/29.
- 24.08: **Receipt-trust-spesifikasjon levert som [HOLD] PR #86** i peck-overlay-schema (worktree `peck-overlay-schema-spec`, main-checkout urørt): 14 seksjoner, 25 kjørbare vektorer kryssverifisert Python↔@bsv/sdk 24/24; nøkkelfunn: @bsv/sdk dobbel-hash-felle dokumentert i §6. Å merge #86 = godkjenne protokollen.

## Neste
- **Task 05** HMR-runner-diagnose (read-only først; passerer standalone, feiler bare i CI-runner) og **task 11** deployment-refusal-guard ([HOLD]-PR) er de eneste ubestilte fra bølge 0–2.
- **Bølge 3**: task 13 Peck composition layer (nå ulåst av #23) → task 15 keyless canary. Task 14 sandbox-hardening venter revidert brief mot valgt infra-repo (egen VM+gVisor).
- Betalingsimplementering forblir [HOLD] til #86 merges; deretter: verifyReceipt()-briefe (TS/Go/Python) + projection stateVersion 2 re-fold.

## Blokkert / venter på
- **Prod-peck-stacken kjører på b550 siden 24.08** (P15 beholder dev-harnessen foreløpig). Når harnessen flyttes dit: land task 16 (immutable deploy-manifest) og task 11 (refusal guard) FØRST — b550 må ikke eksponeres uten app-auth.
- Upstream er pull-only speiling; sync = fetch upstream + merge inn i kryp2/peck-harness. Etter hver sync: refresh `UPSTREAM_MERGE_BASE` i scripts/verify-peck-fork.ts og re-klassifiser nye stier (gate feiler ellers med refresh-instruks).
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`; node_modules reinstallert på 11.7.0 (purge godkjent av Thomas 22.08).
