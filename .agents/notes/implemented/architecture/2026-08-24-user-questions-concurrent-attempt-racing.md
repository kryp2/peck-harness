# Agent Note: User-questions concurrent attempt racing

Status: implemented

English | [中文](2026-08-24-user-questions-concurrent-attempt-racing.zh.md)

## Problem

The `'user-questions/ask'` seam dispatched as a Cordis waterfall: listeners ran outermost-first, so registration order decided which channel a question reached first. The web-GUI answerer held its promise without delegating, and the Telegram answerer only received the question after the web channel settled — while its own long-poll ignored abort signals by documented design and could keep polling for 30 minutes after the ask was already over. The seam's docs promised first-answer-wins across channels, but the mechanism delivered listener-order-wins.

## Decision

`UserQuestionService.ask()` now races: it resolves the filtered listeners once through the events bus (`EventsService.dispatch`, which keeps scope-chain filtering, carrier validation, and fiber-owned disposal exactly as before) and invokes every one concurrently with the same request and one shared per-dispatch race signal. A synchronous settlement guard in `raceUserQuestionAttempts` makes exactly one resolution path win regardless of microtask interleaving; losing attempts observe the race signal aborted with a `UserQuestionError` reason (`SUPERSEDED`, or the caller's own `ASK_ABORTED` error).

The listener contract changed from waterfall to racing participants:

- resolve with an answer to claim; the first fulfillment settles the ask;
- resolve `undefined` to decline (channel cannot or will not answer) and free the slot;
- reject with a `UserQuestionError` for an authoritative failure that settles the whole ask; any other rejection is a channel failure equivalent to declining.

With no attempts, or all declined or channel-failed, the ask rejects `NO_ANSWERER` unchanged. Caller abort still settles `ASK_ABORTED` and cancels every attempt. The Telegram answerer's long-poll now observes its cancellation honestly: the signal rides each curl run, the poll stops at its next turn, and an attempt cancelled while queued skips without touching Telegram. Its loser cleanup edits each posted message best-effort via Bot API `editMessageText` through the same env-carried-URL curl pattern, appending "(answered elsewhere)" — only on a `SUPERSEDED` loss, never on a caller abort where nothing answered, and never thrown into the winner path. The web answerer resolves its pending entry with `undefined` on loss and withdraws the GUI surface by broadcasting `question/resolved`; the wire vocabulary keeps the existing `answered | cancelled` outcomes, so supersession rides `cancelled`.

## Alternatives considered

**Keep the sequential waterfall and make each channel time out faster.** Rejected because ordering, not patience, was the defect: a non-delegating listener would still monopolize the question, and timeouts would add latency instead of removing it.

**Replace the event with a service-owned attempt registry** (`registerAttempt` on `ctx.userQuestions`). Rejected because the registry would have to reimplement what the bus already owns: scope-chain admission for agent-scoped answerers, fiber-owned disposal, and the generated scoped-event subject mapping for `'user-questions/ask'`.

**Treat every rejection as authoritative.** Rejected: a single channel's transport failure would then kill the ask for every other channel, regressing the composed fail-closed behavior that pins `NO_ANSWERER` for telegram-only failures today.

**Treat every rejection as a decline.** Rejected for the mirror reason: the web GUI's "user cancelled" is a terminal decision about the question itself. Letting a slower channel answer after the user pressed cancel would let one human override another, and would break plan review, whose dismissal must reach the caller verbatim.

## Consequences

A question asked under a multi-channel composition reaches every channel at once, the first human answer wins regardless of composition order, and losers clean up deterministically instead of polling to their timeout. The classification rule gives the error taxonomy operational meaning: `UserQuestionError` rejections are terminal for the whole ask, foreign errors stay channel-local. Costs: a declined channel's diagnostic no longer reaches the caller (only the aggregated `NO_ANSWERER` does), and the declared `@mode parallel` describes the invocation family rather than `ctx.parallel`'s all-settled aggregation — the event JSDoc owns the exact racing contract. Supersession cross-reference: the multi-channel proposal in [2026-08-16-user-questions-waterfall-telegram](../../proposed/architecture/2026-08-16-user-questions-waterfall-telegram.md) anticipated fan-out delivery but specified a sequential chain; this note replaces that dispatch shape while keeping its registration and scope model.
