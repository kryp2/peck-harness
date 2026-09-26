# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-09-27_

## Sist gjort
- 26.09: upstream-sync til dsh-v0.1.7-rc.2 (PR #32). Presets er deklarasjonsrader (`peck` i `packages/bundle/peck/presets/`); `deployment-refusal` på app-boots required-liste; fork-pakker portet og tilbake på 100 % dekning per fil.
- 26.09 23:47: P15 `dsh-web` kjører denne branchen. `settings.yaml` er importert til web-profilen, personlige presets `peck`/`regnskap` ligger i `~/.dsh/profiles/web/cordis.patch.yml`, og web krever token-innlogging. Rollback: `~/dsh-home-backup-pre-v017-20260926.tgz` + gammel commit `cd2b7ce7b3`.

## Neste
- llm.peck.to: deploy llm-gateway #44 på b550, mint metered `peck-harness`-nøkkel og legg den som `PECK_GATEWAY_API_KEY` i `~/.dsh/.credentials.yaml`. Ruten `peck-gateway` er allerede i profilen.

## Blokkert / venter på
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`. En ny worktree får worktree-lokal `core.hooksPath` ved install; kopier `lefthook-local.yml` inn eller fjern innstillingen, ellers mangler attribusjon.
