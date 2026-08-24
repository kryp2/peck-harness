# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-08-24 (bølge 3 kjørt: #24 + #25 åpne [HOLD]-stakk, #86 åpen)_

## Sist gjort
- 24.08: **Bølge 3**: **#24 [HOLD]** `deployment-refusal`-guard (`packages/guard/deployment-refusal`; eksplisitte fakta exposure/authKind + preset lest fra owning service; nekt ved remote+none+danger-full-access med tiltak i feilen; 21 tester inkl. real-Loader-composition, 100 % coverage, composed ingen steder). **#25 [HOLD-stakk på #24]** Peck composition layer: `peck`-preset + `packages/bundle/peck` + `ui-brand-peck` (brand slots fylles ubetinget, palette som overrideTokens-lag); generiske flater (system-prompt, cordis-preset, primitives, theme, web-app, ui-brand-official) restaurert BYTE-EKSAKT mot upstream merge-base `b150a551b8d4` — fremtidige syncs konfliktfrie. doc-sync 29/29, typecheck ren, test:web:built 281 grønn under official artifacts.
- 24.08: **Alle fire beslutningene tatt av Thomas**: true racing (02), egen VM+gVisor/Docker (03), dispatch-only ci-master (04), receipt-spesifikasjon green-lightet (01).
- 24.08: **Bølge 1–2 landet** (#18–#23): inbox-typing, claude-cli + metered-receipt 100 % coverage, fork-divergence-gate (`verify-peck-fork`, nå 204 stier/11 grupper), ci-meta-align, TRUE RACING for user-questions. Receipt-trust-spesifikasjon = **[HOLD] PR #86** i peck-overlay-schema (worktree `peck-overlay-schema-spec`, main-checkout urørt): 14 seksjoner, 25 kryssverifiserte vektorer Python↔@bsv/sdk 24/24; @bsv/sdk dobbel-hash-felle dokumentert i §6.

## Neste
- **Thomas' samlede runde** — se gjennom og merge i rekkefølge **#24 → #25** ([HOLD]: deployment-atferd), og **#86** (= protokollgodkjenning). Deretter: verifyReceipt()-briefe (TS/Go/Python), task 15 keyless canary, task 05 HMR-diagnose.
- **Én beslutning gjenstår fra bølge 3**: infra-repo-hjem for task 14 (anbefaling: nytt `peck-infra`); revidert brief ligger i peck-to/reports/TASKS_2026_08_24/14-hosted-sandbox-hardening.md.
- Etter #25-merge: bygg med peck-bundle aktiv — verifiseringsparet er `DSH_BUILD_CLIENT_PROFILE=official pnpm run build` → `test:web:built` (se bundle README Known Limitations).

## Blokkert / venter på
- **Prod-peck-stacken kjører på b550 siden 24.08** (P15 beholder dev-harnessen foreløpig). Når harnessen flyttes dit: land #24+#25 og task 16 (immutable deploy-manifest) FØRST — b550 må ikke eksponeres uten app-auth.
- Upstream er pull-only speiling; sync = fetch upstream + merge inn i kryp2/peck-harness. Etter hver sync: refresh `UPSTREAM_MERGE_BASE` i scripts/verify-peck-fork.ts og re-klassifiser nye stier (gate feiler ellers med refresh-instruks).
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`; node_modules reinstallert på 11.7.0 (purge godkjent av Thomas 22.08).
