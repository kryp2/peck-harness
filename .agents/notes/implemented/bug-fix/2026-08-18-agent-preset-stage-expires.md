# Agent Note: The agent-preset stage waits at most two minutes

Status: implemented

English | [中文](2026-08-18-agent-preset-stage-expires.zh.md)

## Problem

The new-session chip stages a preset pick until a session becomes current and is still blank ([creator introduce cue](../../archived/feature/2026-08-10-creator-guidance-introduce-cue.md) rides the same stage). The stage had no deadline, and the seat applied it on EVERY session-list change. One session received five committed preset switches, four of them inside 28 milliseconds, each overwriting the one before; the last write won and the session ran a preset its user never settled on.

The burst was stale stages spending themselves. A pick made where no session exists yet stays staged until some blank session arrives; a flow that never completed (an abandoned tab, a start that did not land) leaves that stage waiting indefinitely. Every tab folds every committed preset switch into its session list, and the fold mutates the list — so one tab's commit re-triggered every other tab's leftover stage against the same blank session, and each spent stage fired one more switch, overwriting the pick the user actually made. The seat also lacked a busy guard, so list churn while a select was in flight could mint a second call racing the first.

## Decision

The stage carries the moment it was made, and `apply()` drops a stage older than two minutes, returning the chip to the deployment default. The constant is a property of the staging mechanism, not a deployment choice: both staging flows — the workspace connect after a chip pick and the creator start after a section entry — mint their session within moments, so a stage still waiting once the window closes belongs to a flow that is gone. A fixed protocol constant keeps every deployment on the same semantics; a config field would only let one deployment revive the storm.

`apply()` also returns while a select is in flight: the in-flight call already carries the pick, and a second wire call for it would only race the first.

The pick and its timestamp live in one private field so the pair cannot drift, and every path that consumes or drops the pick clears both.

## Alternatives considered

**Consume the stage on any failed apply.** Rejected: the documented flow stages BEFORE its session exists — the hero screen's pick reaches the session the workspace connect produces afterward, and a failure to serve right now is normal for it.

**Scope the stage to the session it targets.** Rejected: the session the flow mints does not exist at stage time, and "a session created after staging" would exclude the documented reuse of an existing blank session.

**Make the window a Config field.** Rejected: nothing about the window varies by deployment; a tunable here is a knob for re-enabling the defect.

**Coordinate tabs through the wire.** Rejected: the host already queues selects per session and commits each; the defect is stale client intent, and expiry removes it without a new wire field.

## Consequences

A stage older than two minutes can no longer spend itself: the observed storm cannot recur, and an expired stage visibly returns the chip to the default instead of silently waiting. The documented hand-off — a stage reaching a blank session that becomes current — is unchanged inside the window, and the drop-on-started-session and spent-on-first-use semantics survive as they were.

One residue remains by design: two tabs that both stage different picks inside the window can still race over the same blank session. The host serializes the switches and the last commit wins — that is live multi-tab contention over one session, not stale intent, and resolving it belongs to a session-level ownership decision, not this fix.

Two real-composition cases pin the behavior: a deferred select answers no second call while list churn runs underneath it, and a fake-clock stage advanced past the window drops itself when a blank session finally arrives, restoring the default. The package [README](../../../../packages/client/ui-agent-preset/README.md) states the window beside the staging description.
