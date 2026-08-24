# @deepseek-ai/dsh-telegram-answerer

English | [中文](README.zh.md)

Opt-in answerer on the `ctx.userQuestions` waterfall that asks the human over Telegram. When composed alongside the web-GUI answerer, the same `ask_user_question` is delivered to both channels; whichever the human answers first wins.

## Role

An answerer (provider) for the user-questions seam. It registers a `user-questions/ask` listener that posts each question to an authorized Telegram chat — with tap-selectable inline buttons when the question offers options, free text otherwise — and resolves the question from the first reply.

Replies are correlated to the question they answer. Before an ask touches Telegram, the answerer drains every already-pending update by probing the bot's latest `update_id`, so history older than the question can never arrive during the poll, and the update cursor persists across asks. Inline-button presses are accepted only when they reference the message that very ask sent (each press carries a per-question nonce); free-text replies are accepted from the authorized chat once the question is posted. Asks are serialized behind one queue so concurrent questions never interleave sends and polls against one chat.

## Configuration

Credentials are read per operation from the credential provider under two refs:

- `TELEGRAM_BOT_TOKEN` — the bot token from BotFather.
- `TELEGRAM_CHAT_ID` — the authorized chat id; replies are accepted only from this chat.

Transport is the Telegram Bot API over `ctx.shell` (curl). The tokened API URL reaches curl through a per-run environment entry, never through the command line, so the token stays out of argv. The answerer degrades to a no-op (falls through to the next answerer) when the shell or credentials are absent; a failed drain probe, send, or unreplied poll falls through as well.

## Model Experience

None, as the answerer observes the model-called `ask_user_question` flow and registers no prompt, tool, or session event; `dsh-tool-ask-user` owns every model-visible effect of the question flow.

#### KV Cache effect

No direct effect. Composing or removing the answerer leaves the assembled system prompt unchanged.

## Known Limitations and Deferred Work

- Replies are collected by long-polling `getUpdates`, so a *running* relay (webhook) is not supported; only the raw bot API is used.
- An inline-button press is not acknowledged with `answerCallbackQuery`, so the button may show a transient loading spinner until the answer resolves the question.
- A batch with several questions is answered one question at a time in order; there is no per-question timeout, only the whole-ask ceiling.
- Asks are serialized: a second concurrent ask waits for the earlier one to settle before it posts anything, so under concurrency its Telegram delivery is delayed until then (the web-GUI answerer is unaffected).
- Free-text replies are bound by freshness (drain plus cursor), not by message identity — only button presses require correlation to the exact sent message.
