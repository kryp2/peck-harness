---
description: "The Peck Harness product layer over the web-app surface: official brand off, Peck default preset, and product naming, for users composing or customizing a profile."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-peck`

English | [中文](README.zh.md)

## Summary

Add this layer to a web-app profile and the surface becomes Peck Harness: the official brand row is disabled, the deployment default agent preset points at the shipped `peck` preset, and the `web-runtime` row carries `productName: Peck Harness`. Shipped Peck distributions already include it; a custom web-app profile names it as a later layer. A profile without this layer boots the upstream-neutral surface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

To add the Peck product layer to a web-app profile, name `@deepseek-ai/dsh-peck` as a later bundle; in-box bundles resolve from the dsh installation. To remove it, drop the bundle and the profile returns to the upstream-neutral surface. Everything Peck-branded composes here: [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md) as a later profile layer, disabling the `ui-brand-official` row, pointing the deployment default agent preset at the shipped `peck` preset, and overriding the `web-runtime` row to add `productName: Peck Harness` (restating every web-app key, because a patch replaces a whole config). There is no Peck brand package by design: the product identity rides the preset default and the product name, not slot occupants.

The manifest also declares `@deepseek-ai/dsh-telegram-answerer` as a dependency. That is resolution, not composition: opt-in Peck host packages must resolve for bare preset rows through the profile module fallback, while the choice to run them belongs to an agent preset (`apps/cli/config/agent-presets/peck`, disabled by default there). The bundle itself mounts no Peck behavior beyond the preset default and product naming; wallet, metered routing, and receipt packages stay uncomposed everywhere until their own acceptance gates pass.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` list applied over the web-app layer. It mounts no service, emits no events, and holds no mutable state; each inserted row's package owns that row's behavior and invariants.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: brand-off, preset default, and product-name rows, with per-row rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the package is a static patch-list carrier (a YAML document of loader rows owned by other packages); it mounts no service, emits no events, and owns no mutable relation to check. Each inserted row's own package carries that row's invariants. |
| [`tests/peck.spec.ts`](tests/peck.spec.ts) | Manifest declaration, patch-row checks, and loader-level composition proof (brand off, product rows, no active Peck package rows) |

### Invariant ownership

No invariant companion is published because the package is a static patch-list carrier: each inserted row's package owns that row's invariants, and the bundle owns no mutable relation to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the brand seam or the exact composition.

- [web-app bundle](../web-app/README.md) — the surface this layer rides over.
- [Official brand package](../../client/ui-brand-official/README.md) — the sidebar occupants this layer leaves off; no Peck brand package exists by design.
- [Generated composition graph](../../../apps/cli/composition.md) — the exact plugin set each shipped profile uses (generated English reference, Chinese counterpart pending).

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the rows this patch contributes: the default `peck` preset selects the persona and toolset every session on this deployment mounts, and `productName` renames the GUI in the `app:web-surface` prompt section and the `DSH_WEB_URL` variable description.

#### KV Cache effect

The preset's persona sits at the system prompt head and is stable per mounted preset; switching a deployment between this bundle's default and another preset establishes a different prefix for sessions created afterwards and never invalidates reuse for sessions already running.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you when the layer needs extra care or where an override must go. They are current package constraints, not a general comparison or a task backlog.

- **Requires its matching preset** — `default: peck` fails loud at the first session when the distribution did not ship `apps/cli/config/agent-presets/peck`; that failure is the intended missing-distribution signal.
- **Brand is one occupant set** — re-enabling `ui-brand-official` in an overlay above this layer takes dropping this layer's disable row; Peck ships no brand package of its own to conflict with.
- **Shell identity stays generic** — the browser tab title, favicon, and PWA manifest remain build-time artifacts of `apps/web`, not runtime composition; a future distribution build profile owns them.
- **No keyless assembled-output snapshot yet** — the shipped `apps/web` snapshot scenarios boot the default profile, so they never see this bundle's product rows; recording a peck-composed scenario needs a keyed snapshot run the integration owner has not spent yet. The bundle suite pins the composition through the real loader until then.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
