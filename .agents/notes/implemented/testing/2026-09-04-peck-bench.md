# Agent Note: Peck Bench model comparison

Status: implemented

English | [中文](2026-09-04-peck-bench.zh.md)

## Problem

Direct model comparisons confound model quality with different agent tools, prompts, execution state, and graders. A useful routing decision requires repeated runs whose model selection is the only intentional variable, while retaining enough evidence to inspect failures rather than trusting one aggregate score.

## Decision

Model comparisons use the public Python SDK and one benchmark-owned Harness composition. Each model receives a fresh fixture copy and the same prompt, tools, timeout, output cap, and deterministic external grader. The matrix contains Omen Alpha and Muse Spark 1.3 Contributor through separate OpenCode Go routes, plus DeepSeek V4 Flash through Command Code; the routes preserve each gateway's required wire protocol.

Benchmark orchestration consumes the Harness; it is not an agent capability. Keeping it under `bench/` prevents scoring policy and provider prices from entering the agent loop or a published package. The SDK preserves the Harness session events for later behavioral graders.

Runs alternate model order between repetitions and copy fixtures before every attempt. Deterministic graders own pass/fail. Provider usage is stored when present and remains unknown when absent. Routing decisions require multiple repetitions and inspection of raw artifacts, not only the summary table.

The first suite uses four small Python maintenance tasks: pagination boundaries, validated JSON Lines aggregation, HTTP retry policy, and non-mutating recursive configuration merge. Distinct defect classes make aggregate results less dependent on one implementation pattern, while compact fixtures keep repeated comparisons inexpensive.

Both benchmark routes read `OPENCODE_GO_API_KEY`, matching the installed `OpenCode Go (responses)` provider. This avoids accidentally benchmarking with an unrelated OpenCode client credential whose workspace can have different Contributor data-policy consent.

## Security limitation

The first version isolates the working directory by copying a fixture but does not provide an operating-system sandbox. Fixtures contain no credentials or production state. Sandbox-backed execution is required before admitting untrusted models or sensitive repositories.

## Alternatives considered

**Continue using the standalone OpenCode experiment runner.** It preserves useful model artifacts, but an OpenCode-owned agent runtime cannot isolate model quality from agent-runtime behavior and therefore cannot measure models through Peck Harness.

**Put benchmark orchestration in an agent-loop plugin.** This would make scoring and provider pricing runtime responsibilities even though they neither affect a model turn nor provide an agent capability. A separate SDK consumer keeps the runtime unchanged.

**Grade tests stored inside each copied fixture.** A write-capable model could edit those tests and receive a passing result without implementing the requested behavior. Host-owned grader code remains outside the copied workspace.

## Consequences

Peck Bench can compare OpenCode Go models through an identical Harness composition, preserve run evidence, and reject a broken patch with deterministic code outside the model workspace. Alternating order reduces systematic first-run bias, while repetitions expose result variance.

The benchmark adds Python orchestration and a separate provider-route declaration for each wire protocol. The copied workspace is not an operating-system sandbox, cost remains unknown when provider events omit it, and four small Python fixtures still do not support a general model-ranking claim.
