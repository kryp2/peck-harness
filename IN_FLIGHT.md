# IN_FLIGHT — deepseek-harness (Peck fork)
_Sist oppdatert: 2026-09-26_

## Sist gjort
- 26.09: upstream-sync til dsh-v0.1.7-rc.2 (4390 commits) på `chore/upstream-sync-2026-09-26`. Presets er nå deklarasjonsrader: `peck` flyttet til `packages/bundle/peck/presets/peck.patch.yml`; `deployment-refusal` lagt på app-boots required-liste (feil ved oppstart er ellers bare advarsler); telegram-answerer, legacy-inbox og llm-claude-cli portet.

## Neste
- P15-cutover: `~/.dsh/settings.yaml` importeres automatisk til web-profilen ved første boot; personlige presets (`peck`, `regnskap`) må inn som deklarasjonsrader i `~/.dsh/profiles/web/cordis.patch.yml` før restart.
- llm.peck.to: `peck-gateway`-rute i `llm-pi-ai` + metered nøkkel (`gw_admin.py mint peck-harness`) når b550 er oppe; katalogen er llm-gateway PR #44.

## Blokkert / venter på
- pnpm A3: bruk alltid `npx -y pnpm@11.7.0`; `pnpm install` i en worktree setter worktree-lokal `core.hooksPath` som skygger for de globale hookene — `git config --worktree --unset core.hooksPath` etterpå.
