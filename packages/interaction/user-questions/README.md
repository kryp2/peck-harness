---
description: "Question and answer service for tools, permission plugins, local answerers, and Agent-scoped Web interactions."
kind: "package-reference"
---

# @deepseek-ai/dsh-user-questions

English | [中文](README.zh.md)

## Summary

User-interaction Service Definition. It owns `ctx.userQuestions`, the service a model-facing tool or permission plugin uses when it needs to pause work and ask the human for a decision. Use it when a consumer must suspend an operation until the user answers.

## Table of Contents

- [Service: `UserQuestionService` (ctx key: `userQuestions`)](#service-userquestionservice-ctx-key-userquestions)
- [Role](#role)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-userquestionservice-ctx-key-userquestions"></a>
## Service: `UserQuestionService` (ctx key: `userQuestions`)

### Public API

- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` Dispatch the scoped answerer waterfall and race it against every composed racing answerer; resolve with the first claimed answer.
- `ctx.userQuestions.registerProvider(provider): () => void` Legacy shim that registers a provider as one `'user-questions/ask'` listener. New answerers register on the event directly (`ctx.on('user-questions/ask', ...)`).
- `raceUserQuestionAttempts(attempts, request, callerSignal?): Promise<AskUserQuestionAnswer>` The race engine `ask()` uses: invoke every attempt concurrently and settle exactly once.

### Answerer composition

Answerers reach an ask through two channels that settle the same question:

- The scoped waterfall `'user-questions/request'`. The shipped Web answerer composes here through Remote Events (Agent-scoped); unscoped local waterfall listeners serve agentless programmatic requests. With no racing answerer composed, `ask()` runs this waterfall directly, preserving its exact contract: transported-error restoration and in-flight abort normalization.
- The racing event `'user-questions/ask'`. Every composed answerer is invoked with the same request at the same time (true racing, not a sequential chain): resolve with an answer to claim the question, resolve `undefined` to decline (the channel cannot or will not answer — the ask stays open for the other attempts), and reject only to report an authoritative failure in the seam's error taxonomy, which settles the whole ask for every channel. When racing answerers exist, the waterfall runs as one attempt beside them and observes the race signal, so a win elsewhere withdraws its pending question too.

Fail-closed default: when no answerer is composed, or every attempt declined or failed as a channel, `ask()` rejects with `NO_ANSWERER`. A losing attempt observes its race signal aborted with a `UserQuestionError` reason naming why: `SUPERSEDED` when another answerer claimed first, or the caller's own `ASK_ABORTED` error after a turn cancel. Late settlements after the ask has settled are discarded idempotently.

### Key Types

- `AskUserQuestionRequest` — `{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }], agent?, signal? }`; `detail` supplies supporting text that providers render with the question without turning it into an option label. When present, `agent` must be the registry's exact live runtime root.
- `AskUserQuestionOption` — `{ label, description? }`.
- `AskUserQuestionIntent` — `{ kind: 'plan-review', approve }`; the tagged presentation intent below.
- `AskUserQuestionAnswer` — `{ answers: [{ id, selected, custom? }] }`.
- `UserQuestionProvider` — UI implementation with `ask(request)`.
- `UserQuestionAttempt` — one racing listener: `(request, signal) => Promise<AskUserQuestionAnswer | undefined>` under the claim/decline/authoritative contract above.
- `UserQuestionError` — `HarnessError` subclass with codes such as `EMPTY_QUESTIONS`, `BAD_INTENT`, `NO_ANSWERER`, `ASK_ABORTED`, `ASK_CANCELLED`, `SUPERSEDED`, `CALLER_NOT_LIVE`, and `DELEGATED_CALLER`.

For a single-select question, `custom` overrides the selected choice and `selected` is empty. For a multi-select question, `custom` may supplement the labels in `selected`. A UI may preserve a skipped item as `{ id, selected: [] }`, keeping the existing answer shape while retaining other answers in the batch.

When a request carries an agent, `ask()` authenticates its exact identity through the live `AgentRegistry` and admits only a runtime root. Durable lineage is not authority: a session with historical delegation depth may ask after it is resumed as a new runtime root, while a live child owned by another agent is rejected even if its durable depth is zero. The Web answerer receives only Agent-scoped requests; an agentless programmatic request remains available to unscoped local waterfall listeners.

### Presentation intent

`intent` declares that a question IS a known kind of decision, so a UI that recognises the tag may present it as such — `plan-review` says `detail` is a plan under review, and `dsh-plan-mode` sets it on the `exit_plan_mode` question. An intent changes presentation only: a UI honouring it answers with the same option labels a generic UI would send, and a UI that does not know the tag renders the generic option list, so callers read the same answer fields either way. `approve` names the label that approves rather than relying on option order. `ask()` rejects with `BAD_INTENT` the two assertions no type can carry: an `approve` naming none of that question's own options, and an intent on a question with no `detail` — the thing it declares itself a review of.

<a id="role"></a>
## Role

This is the Service Definition package. Consumers such as `@deepseek-ai/dsh-tool-ask-user` depend on this service; the Web client contributes an Agent-scoped answerer through Remote Events, and opt-in channels such as `@deepseek-ai/dsh-telegram-answerer` compose alongside it on the racing event. The loop stays unchanged: a tool call awaits the settled answer, and that result resumes the normal agent loop.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-ask-user`, which retains a successful answer as compact JSON or one of these failures: `Error: ask_user_question was aborted before the user answered`, `Error: ask_user_question requires at least one question`, `Error: human interaction requires the exact live calling agent when an agent is supplied`, `Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result`, `Error: no user-questions answerer is composed`, or `Error: <message>`. Waiting for the human adds no tokens.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Decline carries no detail** — a channel failing internally resolves `undefined`, so its diagnostic never reaches the caller; only the aggregated `NO_ANSWERER` (or an authoritative taxonomy error) does.
- **Agent-scoped Web answering** — Remote Events route the shipped Web answerer only when the request carries a live Agent scope; agentless callers need an unscoped local waterfall listener.
- **The vocabulary is the question-form shape only** — selectable options plus optional custom text; richer interaction shapes (file pickers, diff-preview confirmations) have no seam vocabulary yet.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Answerer attempts resolve per ask through the bus and asks return directly to their caller; the seam publishes no independent request/answer audit stream.
