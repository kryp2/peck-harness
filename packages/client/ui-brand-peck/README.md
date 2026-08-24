# @deepseek-ai/dsh-client-ui-brand-peck

English | [中文](README.zh.md)

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` unconditionally: composition, not a build profile, decides whether the Peck surface shows, because whoever mounts this package's row wants Peck branding. It is the Peck counterpart of [`ui-brand-official`](../ui-brand-official/README.md) and must not share a composition with it — both fill the same single-occupant slots, and the [`dsh-peck` bundle](../../bundle/peck/README.md) disables that row when it inserts this one.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. The bird mark and "Peck Harness" wordmark are private artwork: the shared primitives package keeps its upstream-neutral brand art.

The package also stacks one theme override layer (`overrideTokens` under this package id) carrying the Peck palette — the recolored static ramp plus every alias token the product re-pointed — over whichever theme is active. The layer rides a Cordis effect, so disposing the plugin removes the palette exactly as it removes the slot occupants; the base stylesheets stay untouched for compositions without this row.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One palette layer per composition** — the override carries fixed values; a deployment wanting different accents authors another client package rather than configuring this one.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot, so the tab title stays outside this package.
