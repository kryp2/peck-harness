# Agent Note: The Peck composition layer

Status: implemented

English | [中文](2026-08-24-peck-composition-layer.zh.md)

## Problem

Audit P1: Peck branding and persona were patched directly across GENERIC upstream-owned surfaces — the system-prompt fallback identity line, the shipped `cordis` agent preset's persona, the web bundle's surface-context strings and CLI description, the shared primitives' brand artwork (`PeckLogo`, a rewritten `BrandWordmark`), the conversation status copy ("Pecking..."), the shared theme palette values, the app shell title/favicon/manifest, and the official build-environment title. Every one of those files is upstream-owned, so every upstream sync re-fought the same conflicts, and nothing about the fork's structure said where product identity was allowed to live. The distribution plan's composition section ([the proposed distribution Agent Note](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.md)) calls for a `peck` composition bundle that owns product behavior while generic defaults return to upstream-neutral; this note implements that host-and-client slice.

## Decision

Product identity composes in exactly two places, both new; every generic surface returns to byte-equal upstream content.

**Host side: the `peck` agent preset** (`apps/cli/config/agent-presets/peck/`). It is a full copy of the shipped `standard` toolset whose persona row carries the Peck Harness identity, plus an opt-in block for Peck host packages — `telegram-answerer` ships disabled, enabled per deployment by deleting `disabled` and supplying its credentials. The deployment-refusal guard stays composed nowhere ([its own Agent Note](2026-08-24-deployment-refusal-guard.md) keeps it opt-in pending review), and the metered-receipt/routing packages stay uncomposed until their acceptance gates pass. The generic `cordis` and `standard` presets carry no Peck text.

**Composition: the `dsh-peck` bundle** (`packages/bundle/peck/`, patch-only like `dsh-base`). Its patch layer rides over `dsh-web-app` and does four things: disables the `ui-brand-official` row, inserts the unconditional Peck brand client package, overrides the `web-runtime` row with `productName: Peck Harness` (restating every web-app key, because a patch replaces a whole config), and points the deployment default preset at `peck`. Its manifest declares `telegram-answerer` as a dependency so bare preset rows resolve through the profile module fallback — resolution, not composition; the choice to run opt-in packages stays in the preset.

**Client side: `@deepseek-ai/dsh-client-ui-brand-peck`** fills the existing generic brand slots (`sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`) UNCONDITIONALLY. Composition decides branding — whoever mounts the row wants the Peck surface — so no build-profile gate exists on this path; the upstream `DSH_CLIENT_BUILD_PROFILE=official` gate on `ui-brand-official` keeps working untouched for compositions that use it. Both packages fill single-occupant slots, which is why the bundle disables one when inserting the other. The bird mark and wordmark are private to this package, and the Peck palette applies as ONE `overrideTokens` layer under the package id over the active theme, riding a Cordis effect so teardown removes it with the occupants. The shared primitives keep their upstream whale artwork, and the shared stylesheet keeps its upstream blue values.

**The generic knob that makes host neutrality possible:** `dsh-web-app`'s runtime glue gains a validated `productName` config field (default `DeepSeek Harness`, blank fails at activation) used by the `app:web-surface` prompt section and the `DSH_WEB_URL` description. That field is upstreamable feature work under the no-hardcoded-tunables rule; only the peck bundle's patch sets it to `Peck Harness`.

**Fork inventory:** the divergence gate gains a wholly peck-owned `peck-composition` group for the three new path spaces, and the legacy `fork-branding` group's retirement now reads as retirement-by-reset: its paths drop at the next merge-base refresh once this change lands, since their content again matches upstream. The manifest keeps the legacy patterns until then because the gate measures committed divergence.

## Alternatives considered

**Keep filling brand through the build profile.** Rejected as the primary path: `DSH_CLIENT_BUILD_PROFILE=official` is a build-process fact, so a Peck deployment could not compose, audit, or remove its own branding from configuration, and the generic `ui-brand-official` would stay diverged forever. The gate stays in place for its real audience (upstream official artifacts); the bundle makes it redundant for Peck.

**Re-point the `ui-brand-official` row id at the Peck package instead of disable-plus-insert.** Rejected: it hides which implementation runs behind a generic-sounding row name, and re-enabling official branding in an overlay would silently mean editing the peck layer rather than adding a row.

**Override palette tokens with a raw injected `<style>`.** Rejected: `ThemeRuntime.overrideTokens` already provides per-source layers, light/dark pairs, seq stacking, inspection export, and effect-scoped disposal; hand-rolled style tags would duplicate all of it outside the presenter's retraction set.

**Carry the persona in the system-prompt fallback keyed by environment.** Rejected outright: any identity branch inside `dsh-system-prompt` recreates the exact coupling this change removes; the persona slot exists precisely so a preset can shadow it per session.

## Consequences

A stock profile boots byte-for-byte the upstream surface — DeepSeek identity, whale wordmark, blue palette, "Deep diving..." status — and every file involved can merge from upstream without conflict. A Peck deployment stacks the `peck` bundle (plus its shipped preset) and gets bird-and-wordmark branding, the amber palette over either color scheme, Peck-named model-facing surface context, and sessions that default to the Peck persona with opt-in Telegram answering. Honest gaps, documented in the bundle README: the browser tab title, favicon, and PWA manifest remain build-time artifacts of `apps/web`, so they stay upstream-generic until a distribution build profile owns them; the streaming status copy has no composition seam and remains upstream text. Verification: focused suites for every touched package (bundle patch assertions, brand-plugin jsdom specs including the unconditional-fill and palette-disposal contracts, `productName` behavior including the blank-name failure), the reset surfaces confirmed byte-identical to the pinned merge-base, and the divergence gate classifying the complete committed tree.
