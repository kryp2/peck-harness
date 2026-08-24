# `@deepseek-ai/dsh-peck`

English | [中文](README.zh.md)

The Peck Harness product bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md) as a later profile layer: it disables the `ui-brand-official` row, inserts the unconditional Peck brand package ([`dsh-client-ui-brand-peck`](../../client/ui-brand-peck/README.md), slot fill plus palette override), points the deployment default agent preset at the shipped `peck` preset, and overrides the `web-runtime` row to add `productName: Peck Harness` (restating every web-app key, because a patch replaces a whole config). Everything Peck-branded composes here, so a profile without this layer boots the upstream-neutral surface.

The manifest also declares `@deepseek-ai/dsh-telegram-answerer` as a dependency. That is resolution, not composition: opt-in Peck host packages must resolve for bare preset rows through the profile module fallback, while the choice to run them belongs to an agent preset (`apps/cli/config/agent-presets/peck`, disabled by default there). The bundle itself mounts no Peck behavior beyond brand and product naming; wallet, metered routing, and receipt packages stay uncomposed everywhere until their own acceptance gates pass.

## Model Experience

Indirectly, through the rows this patch contributes: the default `peck` preset selects the persona and toolset every session on this deployment mounts, and `productName` renames the GUI in the `app:web-surface` prompt section and the `DSH_WEB_URL` variable description.

#### KV Cache effect

The preset's persona sits at the system prompt head and is stable per mounted preset; switching a deployment between this bundle's default and another preset establishes a different prefix for sessions created afterwards and never invalidates reuse for sessions already running.

## Known Limitations and Deferred Work

- **Requires its matching preset** — `default: peck` fails loud at the first session when the distribution did not ship `apps/cli/config/agent-presets/peck`; that failure is the intended missing-distribution signal.
- **Brand is one occupant set** — re-enabling `ui-brand-official` in an overlay above this layer requires also removing the `ui-brand-peck` insert; both fill the same single-occupant slots.
- **Shell identity stays generic** — the browser tab title, favicon, and PWA manifest remain build-time artifacts of `apps/web`, not runtime composition; a future distribution build profile owns them.
- **No keyless assembled-output snapshot yet** — the shipped `apps/web` snapshot scenarios boot the default profile, so they never see this bundle's branding; recording a peck-composed scenario needs a keyed snapshot run the integration owner has not spent yet. Package suites pin the pieces (slot fill, palette layer, patch rows) until then.
