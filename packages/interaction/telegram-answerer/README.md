---
description: "Opt-in user-questions answerer that asks the human over Telegram: races other channels, first answer settles the ask, for deployments composing that channel."
kind: "package-reference"
---

# @deepseek-ai/dsh-telegram-answerer

English | [中文](README.zh.md)

## Summary

An opt-in answerer racing on the `ctx.userQuestions` `'user-questions/ask'` event that asks the human over Telegram. Composed alongside the web-GUI answerer, the same `ask_user_question` is delivered to every channel at the same time; whichever the human answers first settles the ask, and this attempt is cancelled through its race signal when another channel wins.

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

The common path is explicit composition outside the preset: the `peck` preset leaves this answerer disabled by default, resolved through the profile module fallback by its bare row. Questions with options render as tap-selectable inline buttons, free text otherwise; the first reply from the authorized chat claims the question.

### When to choose it

Choose it when the operator lives on Telegram and questions must reach them there; the ask races this channel against the web-GUI answerer in parallel. Browser-only deployments leave it out — a new transport surface adds attack surface with no benefit.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-telegram-answerer'
```

Credentials are read per operation from the credential provider under two refs:

- `TELEGRAM_BOT_TOKEN` — the bot token from BotFather.
- `TELEGRAM_CHAT_ID` — the authorized chat id; replies are accepted only from this chat.

| Field | Default | Meaning |
|---|---|---|
| (no config fields) | — | The package reads two credential refs and takes no plugin Config |

Transport is the Telegram Bot API over `ctx.shell` (curl). The tokened API URL reaches curl through a per-run environment entry, never through the command line, so the token stays out of argv. The answerer degrades to a no-op (declines) when the shell or credentials are absent.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-telegram-answerer) is the exhaustive source for every accepted field and its JSDoc.

### What you get

Channel-internal failures (unconfigured credentials, transport errors, deadline elapsed without a reply) decline the race by resolving `undefined` so the other channels keep racing; only a composition where no channel claims produces the fail-closed `NO_ANSWERER`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains reply correlation and loser cleanup; the observable behavior is fully covered in [Use this package](#use-this-package).

### Reply correlation

Replies are correlated to the question they answer. Before an ask touches Telegram, the answerer drains every already-pending update by probing the bot's latest `update_id`, so history older than the question can never arrive during the poll, and the update cursor persists across asks. Inline-button presses are accepted only when they reference the message that very ask sent (each press carries a per-question nonce); free-text replies are accepted from the authorized chat once the question is posted. Asks are serialized behind one queue so concurrent questions never interleave sends and polls against one chat; an attempt whose race signal already fired when its queue turn arrives skips without touching Telegram.

### Loser cleanup

The race signal from `ask()` is observed promptly: it rides every curl run, so a cancelled attempt kills its in-flight long-poll instead of waiting out the transport timeout, and the poll loop stops at its next turn. When the loss reason is `SUPERSEDED` — another channel answered — each posted message is edited best-effort (`editMessageText`) to append "(answered elsewhere)". On any other cancellation (caller abort, host teardown) nothing answered, so the sent message is left untouched rather than claiming an answer that did not happen. The edit never throws into the winner path: a failed edit silently leaves the stale message.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `user-questions/ask` listener, serial queue, long-poll and race-signal handling |
| — | No runtime invariant companion is published; the answerer only consumes the racing channel and owns no checkable mutable relation. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when an ask goes unclaimed or the racing behavior surprises. They move from the capability contract to the preset and tool that surface it.

- [user-questions capability](../user-questions/README.md) — the racing channel answerers register on and the fail-closed semantics.
- [peck preset](../../../apps/cli/config/agent-presets/peck) — the bare row that leaves this package disabled by default.
- [dsh-tool-ask-user](../tool-ask-user/README.md) — the tool owning the model-visible side of the question flow.

-----

<a id="model-experience"></a>
## Model Experience

None, as the answerer observes the model-called `ask_user_question` flow and registers no prompt, tool, or session event; `dsh-tool-ask-user` owns every model-visible effect of the question flow.

#### KV Cache effect

No direct effect. Composing or removing the answerer leaves the assembled system prompt unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this channel is a poor fit. They are current package constraints, not a task backlog.

- Replies are collected by long-polling `getUpdates`, so a *running* relay (webhook) is not supported; only the raw bot API is used.
- An inline-button press is not acknowledged with `answerCallbackQuery`, so the button may show a transient loading spinner until the answer resolves the question.
- A batch with several questions is answered one question at a time in order; there is no per-question timeout, only the whole-ask ceiling.
- Asks are serialized: a second concurrent ask waits for the earlier one to settle before it posts anything, so under concurrency its Telegram delivery is delayed until then (the web-GUI answerer is unaffected).
- Free-text replies are bound by freshness (drain plus cursor), not by message identity — only button presses require correlation to the exact sent message.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
