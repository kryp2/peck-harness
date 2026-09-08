# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-09-08 (kveld)_

## Sist gjort
- 08.09 kveld: **PR #30 CI nede fra 3 røde lanes til 2**. Fant og fikset en selvpåført regresjon fra ettermiddagen: `9ea8650b` la `fetch-depth: 0` på ALLE checkouts, men `scripts/ci-compatible-selfhosted.spec.ts:95` asserter node-compat sine egne checkout-opsjoner — meta-testen falt derfor i begge coverage-lanes. `66e445cb` skoper full historie til de to lanes som faktisk kjører fork-divergence-gaten (node-24 static + windows-observational). Resultat på `66e445cb`: static, benchmarks, node 22.19/24.9/26, alle windows-lanes og hele python-matrisen GRØNNE.
- 08.09: lockfile (pinned pnpm 11 + overrides), lisens-gate (public MIT på refusal + metered-receipt), versjoner 0.1.3-alpha.2, brand-sletting, inventory 214/12, invariant-migrasjon.

## Neste
- **Thomas' avgjørelse på 2 gjenstående lanes** (ingen er fork-eid kode — alt er upstream-kode som feiler i vårt runner-miljø):
  1. `node 24 / coverage`: 17 feil i 6 filer, alle i samme rot — `linux-scope.ts:380` «subprocess scope exited before its bootstrap consumed the launch request». Reproduserer lokalt på syncen, GRØNT på pre-sync-treet (peck-harness-metadata). Upstream-kode urørt av forken.
  2. `node 24 / snapshots and artifacts`: 5 e2e-feil (30s loader-smoke-timeout + en 3-vs-2 request-telling). Alle 5 PASSERER lokalt — ren runner-treghet.
  Valg: (a) merge med de to som kjent-røde og åpne oppfølgingsissue, (b) hev loader-smoke-timeout for snapshots og lever linux-scope som upstream-rapport, (c) grav videre i linux-scope først.
- Etter merge: #29 rebase (benchmark), session-header/per-model-API fra go-session-worktree, grader-timeout, 38-filers doc-rebase — hver som egen PR.

## Blokkert / venter på
- Upstream er pull-only; syncen ligger 457 commits bak `upstream/master` (merge-base `b0a7d2ce3b4c`). Etter hver sync: refresh `UPSTREAM_MERGE_BASE` i scripts/verify-peck-fork.ts.
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`.
