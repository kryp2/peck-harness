---
description: "Peck Harness brand occupants for the sidebar and conversation hero, unconditional on mount; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-peck

English | [中文](README.zh.md)

## Summary

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` unconditionally: composition, not a build profile, decides whether the Peck surface shows, because whoever mounts this package's row wants Peck branding. It is the Peck counterpart of [`ui-brand-official`](../ui-brand-official/README.md) and must not share a composition with it — both fill the same single-occupant slots, and the [`dsh-peck` bundle](../../bundle/peck/README.md) disables that row when it inserts this one. It retains no runtime state and contributes nothing to model requests.

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

Mount this plugin in the browser roster of a deployment whose identity is Peck's own. No build profile gates the occupants: they register whenever the row activates.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar slots — and the hero slot, which this package fills unconditionally, unlike its official counterpart. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The bird mark and "Peck Harness" wordmark are private artwork: the shared primitives package keeps its upstream-neutral brand art.

The package also stacks one theme override layer (`overrideTokens` under this package id) carrying the Peck palette — the recolored static ramp plus every alias token the product re-pointed — over whichever theme is active. The layer rides a Cordis effect, so disposing the plugin removes the palette exactly as it removes the slot occupants; the base stylesheets stay untouched for compositions without this row.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [dsh-peck bundle](../../bundle/peck/README.md) — the layer that inserts this package and disables the official row.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One palette layer per composition** — the override carries fixed values; a deployment wanting different accents authors another client package rather than configuring this one.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot, so the tab title stays outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its slot occupants and palette layer install and leave through one transactional effect.
