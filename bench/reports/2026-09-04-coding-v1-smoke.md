# Coding-v1 smoke report — 2026-09-04

This report records two local single-repetition smoke runs of the `coding-v1` suite (cases `python-pagination-boundary`, `python-jsonl-aggregation`, `python-retry-policy`, `python-config-merge`) through the benchmark-owned composition in `bench/cordis.yml`, without ranking the models.

## Sources

Source run `bench/runs/deepseek-v4-flash-smoke/20260904T121157Z-coding-v1` holds 4 results for `deepseek-v4-flash` (provider `commandcode`, model `deepseek/deepseek-v4-flash`); source run `bench/runs/coding-v1-expanded-smoke/20260904T114732Z-coding-v1` holds 8 results for `omen-alpha` and `muse-spark-1.3-contributor`. Raw sessions and copied workspaces stay under the gitignored `bench/runs/` tree and are not committed; the summaries below are read from each run's `summary.json` and its per-attempt `result.json` files.

## Results

| Model | Attempts | Completed | Passed | Mean seconds | Reported cost |
|---|---|---:|---:|---:|---|
| deepseek-v4-flash | 4 | 4 | 4 | 62.124 | unknown |
| omen-alpha | 4 | 4 | 4 | 28.372 | unknown |
| muse-spark-1.3-contributor | 4 | 4 | 4 | 27.294 | unknown |

Every attempt finished with harness `finish_reason` `completed` and grader `passed: true` with exit code 0. Per-attempt harness durations in seconds: DeepSeek V4 Flash 86.722 (pagination), 74.586 (jsonl), 65.026 (retry), 22.161 (config-merge); Omen Alpha 26.392, 18.465, 28.867, 39.766 in the same case order; Muse Spark 1.3 Contributor 27.300, 35.310, 30.743, 15.824 in the same case order.

## Limitations

Each case ran once per model (repetition `r01`), so these numbers describe one unattended pass and cannot support routing decisions, which require several repetitions. Provider usage reported `cost_usd` as null for all 12 attempts, so cost is recorded as unknown and is not estimated. All completed attempts passed, so this report states observed completion only and makes no quality ranking between models.
