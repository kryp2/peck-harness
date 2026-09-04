# Peck Bench

English | [中文](README.zh.md)

Peck Bench compares models through one DeepSeek Harness composition. Every run gets a fresh copy of the same fixture, prompt, tools, timeout, and grader; only the provider route and model change. Hidden grader code remains outside the copied model workspace.

## Run

Install this checkout's SDK after `pnpm install`, validate without an API call, then run the paired comparison. The runner uses the source JSON-RPC runtime inside a Harness checkout and the SDK's bundled runtime outside one.

```sh
python -m pip install -e python/sdk
python bench/peck_bench.py validate
export OPENCODE_API_KEY=...
python bench/peck_bench.py run --repetitions 3
```

Use `--model omen-alpha` to select one model and `--output DIR` to move run artifacts. Each run preserves its copied workspace, Harness session log, grader output, and result JSON. The suite writes `summary.json` and `summary.md` after every completed attempt.

Fixtures must contain no secrets or production configuration. The Harness tools start in the copied fixture, but this MVP is not an operating-system sandbox. Do not use it with untrusted models or sensitive host state. A deterministic grader owns pass/fail. Missing provider usage stays unknown rather than being estimated, and routing decisions require several repetitions.
