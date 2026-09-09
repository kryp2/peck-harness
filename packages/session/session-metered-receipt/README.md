---
description: "Cross-language receipt schema, canonical serialization, and verification for Peck metered model inference: proves what a paid model call cost, for deployments settling inference through BSV payment channels."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-metered-receipt

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-session-metered-receipt` is the receipt contract for Peck metered model inference: it defines the canonical schema and cryptographic verification helpers for inference calls funded through BSV / BRC-104 payment channels behind `llm.peck.to`. The receipt bytes are canonical on purpose — one ASCII serialization shared by the TypeScript adapter, the Go `llm-gateway`, and the sCrypt settlement contract — so a receipt signed anywhere verifies everywhere. It registers the `meteredReceipts` session projection, which aggregates verified signed receipts and cumulative satoshi charges across the log for billing surfaces to read.

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

Mount this plugin when a deployment settles model-inference spend through Peck payment channels. It registers the `meteredReceipts` projection and exports the schema, canonicalization, and verification helpers that the inference path calls per paid request.

### When to choose it

Choose it when inference calls are funded through BSV / BRC-104 payment channels and billing needs a verifiable per-call receipt — schema version `peck/v1/inference-receipt`, deterministic canonical bytes, signature verification. Deployments that never touch metered inference leave it out: the projection aggregates nothing and the helpers have no callers.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-session-metered-receipt'
```

| Field | Default | Meaning |
|---|---|---|
| (no config fields) | — | The package takes no plugin Config; behavior is fixed by the receipt schema version |

### What you get

Verified signed receipts accumulate in the `meteredReceipts` projection as a JSON-wire summary — `totalChargedSats`, `receiptCount`, and the receipt list — so billing and UI surfaces read cumulative spend from the session state without re-scanning the log. Cross-language golden vectors are committed in `vectors/receipt-vectors.json` and asserted across the test suites, so the TypeScript canonicalization stays byte-identical with Go and sCrypt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the canonicalization and verification behind the package; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

A metered receipt is only useful if every party hashes the same bytes. `canonicalizeReceipt` fixes a line-delimited ASCII representation of the receipt fields; `hashReceipt` and `parseSignedReceipt` then sign and verify over exactly those bytes. The projection applies only `peck/metered-receipt` events whose `data` parses as a signed receipt, so malformed or forged events never enter the billed total.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Schema definitions, canonicalization, verification, the `meteredReceipts` projection, plugin entry |
| [`src/types.ts`](src/types.ts) | Receipt and summary TypeScript types |
| [`vectors/receipt-vectors.json`](vectors/receipt-vectors.json) | Cross-language golden vectors asserted by the test suites |
| — | No runtime invariant companion is published; every receipt contract is enforced by the schema, canonicalization, and projection tests. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when a receipt fails verification or the billed total surprises. They move from the projection infrastructure to the spending side of metered inference.

- [session-projection capability](../session-projection/README.md) — the projection registry this package registers on.
- [Persistence subsystem](../../../docs/subsystems/persistence.md) — how `peck/metered-receipt` events reach the log the projection reads.

-----

<a id="model-experience"></a>
## Model Experience

### Metered receipt projection

#### What the model sees

Nothing. `peck/metered-receipt` is log-only and never enters the session surface, `deriveMessages()`, the system prompt, tool schemas, or a request prefix.

#### Token effect

Zero. Verified receipts append to the log only and add no tokens to any model request; cumulative satoshi charges reach projections and UI, not model context.

#### KV Cache effect

None. Receipt events do not change any request's reconstructed content or cache key.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this V1 receipt contract stops. They are current package constraints, not a task backlog.

- V1 assumes channel state is tracked through `amount_spent_new_sats` monotonic accumulation; multi-channel routing within a single turn is deferred to later milestones.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
