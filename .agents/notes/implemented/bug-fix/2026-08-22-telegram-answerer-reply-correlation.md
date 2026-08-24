# Agent Note: Telegram answerer correlates replies to the question asked

Status: implemented

English | [中文](2026-08-22-telegram-answerer-reply-correlation.zh.md)

## Problem

Every poll started `getUpdates` at offset zero, so Telegram redelivered recent unconfirmed history on each ask, and the first text or callback from the authorized chat answered whatever question happened to be polling — a stale reply could answer a new prompt, and two concurrent asks interleaved their sends and polls against one chat. Sends also checked only curl's exit status, so an `{ok:false}` envelope (bad token, wrong chat) counted as delivered, and the tokened URL sat on curl's command line, readable from `/proc/<pid>/cmdline`.

## Decision

The answerer keeps one serialized bot session per plugin mount. Before its first send in an ask it drains pending history by probing `getUpdates?offset=-1` — which returns only the latest update and confirms nothing — and parks the cursor one past it; the cursor then persists across polls and asks. A failed drain fails the ask closed so another answerer can serve.

Each sent question generates an unpredictable nonce embedded in the message text and in every button's `callback_data`, and `sendMessage`'s envelope must carry `result.message_id`. Callback presses are accepted only when they reference that message id; free-text replies remain accepted from the authorized chat because after the drain only updates newer than the question can arrive. The Bot API URL travels to curl through a per-run environment entry instead of argv, and non-ok envelopes now throw with Telegram's description. Concurrent asks queue behind one promise chain, so their sends and polls never interleave; a queued ask waits until the earlier ask settles.

## Alternatives considered

**Require every reply to be a swipe-reply of the sent message.** Rejected because plain typed answers — the common case for this chat — would silently stop answering questions.

**Persist the update cursor on disk across restarts.** Rejected because each process re-establishes the drain before its first send anyway; persistence adds state without removing any reachable staleness.

**Reject conflicting manifests or move bot access into a long-lived worker.** Deferred — both are larger refactors than the audit's failure modes require; the serialized session inside the plugin already removes interleaving and replay.

## Verification

`telegram-answerer.spec.ts` covers: callback correlation to the sent message id with stale presses ignored; drain-before-send ordering and cursor reuse across consecutive asks without re-probing; nonce presence in text and callbacks; serialization of concurrent asks including queue recovery after a failed ask; `{ok:false}` envelopes, missing message ids, transport failures, and malformed updates failing closed or retrying within the deadline; and the token never appearing on a command line.

## Consequences

A stale or cross-question reply can no longer answer a prompt, and delivery failures are visible instead of silently "delivered". A second concurrent question reaches Telegram later than before — after the earlier ask settles — which is the cost of one human chat having one writer. The nonce is visible in the message text, giving humans the same correlation handle the code uses.
