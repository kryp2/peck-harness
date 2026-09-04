#!/usr/bin/env python3
"""Run reproducible model comparisons through the DeepSeek Harness SDK."""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any, Iterable


BENCH_ROOT = Path(__file__).resolve().parent
DEFAULT_SUITE = BENCH_ROOT / "suites" / "coding-v1.json"
DEFAULT_MODELS = BENCH_ROOT / "models.json"
DEFAULT_OUTPUT = BENCH_ROOT / "runs"


@dataclass(frozen=True)
class Model:
    """One named Harness provider/model selection."""

    alias: str
    provider: str
    model: str


@dataclass(frozen=True)
class Case:
    """One immutable fixture, task, and deterministic grader command."""

    case_id: str
    fixture: Path
    prompt_file: str
    grader: tuple[str, ...]
    timeout_seconds: int


def load_json(path: Path) -> dict[str, Any]:
    """Read one JSON object."""
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def load_models(path: Path) -> dict[str, Model]:
    """Load and validate the named model matrix."""
    models: dict[str, Model] = {}
    for alias, value in load_json(path).items():
        if not isinstance(value, dict):
            raise ValueError(f"model {alias!r} must be an object")
        provider, model = value.get("provider"), value.get("model")
        if not isinstance(provider, str) or not provider:
            raise ValueError(f"model {alias!r} needs a provider")
        if not isinstance(model, str) or not model:
            raise ValueError(f"model {alias!r} needs a model id")
        models[alias] = Model(alias, provider, model)
    if not models:
        raise ValueError("the model matrix is empty")
    return models


def load_suite(path: Path) -> tuple[str, list[Case]]:
    """Load cases and resolve fixture paths relative to the suite."""
    raw = load_json(path)
    suite_id, rows = raw.get("id"), raw.get("cases")
    if not isinstance(suite_id, str) or not suite_id:
        raise ValueError("suite needs a non-empty id")
    if not isinstance(rows, list) or not rows:
        raise ValueError("suite needs at least one case")
    cases: list[Case] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("each case must be an object")
        case_id, fixture_value = row.get("id"), row.get("fixture")
        prompt_file, grader = row.get("prompt_file"), row.get("grader")
        timeout = row.get("timeout_seconds", 300)
        if not isinstance(case_id, str) or not case_id or case_id in seen:
            raise ValueError(f"invalid or duplicate case id: {case_id!r}")
        seen.add(case_id)
        if not isinstance(fixture_value, str) or not isinstance(prompt_file, str):
            raise ValueError(f"case {case_id!r} needs fixture and prompt_file")
        if not isinstance(grader, list) or not grader or not all(isinstance(v, str) and v for v in grader):
            raise ValueError(f"case {case_id!r} needs a non-empty grader argv")
        if not isinstance(timeout, int) or timeout < 1:
            raise ValueError(f"case {case_id!r} has an invalid timeout")
        fixture = (path.parent / fixture_value).resolve()
        if not fixture.is_dir() or not (fixture / prompt_file).is_file():
            raise ValueError(f"case {case_id!r} fixture or prompt is missing")
        cases.append(Case(case_id, fixture, prompt_file, tuple(grader), timeout))
    return suite_id, cases


def paired_order(models: list[Model], repetition: int) -> list[Model]:
    """Alternate model order to reduce systematic first-run bias."""
    return models if repetition % 2 else list(reversed(models))


def jsonable(value: Any) -> Any:
    """Project SDK event values into JSON-compatible values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        return jsonable(value.model_dump())
    if hasattr(value, "__dict__"):
        return jsonable(vars(value))
    return repr(value)


def usage_from_events(events: Iterable[Any]) -> dict[str, int | float | None]:
    """Sum provider usage fields without estimating absent values."""
    totals: dict[str, int | float] = defaultdict(int)
    found: set[str] = set()
    aliases = {
        "inputTokens": "input_tokens", "input_tokens": "input_tokens",
        "outputTokens": "output_tokens", "output_tokens": "output_tokens",
        "cacheReadTokens": "cache_read_tokens", "cache_read_tokens": "cache_read_tokens",
        "cacheWriteTokens": "cache_write_tokens", "cache_write_tokens": "cache_write_tokens",
        "costUsd": "cost_usd", "cost_usd": "cost_usd",
    }

    def visit(value: Any) -> None:
        value = jsonable(value)
        if isinstance(value, dict):
            for key, item in value.items():
                target = aliases.get(key)
                if target and isinstance(item, (int, float)) and not isinstance(item, bool):
                    totals[target] += item
                    found.add(target)
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    for event in events:
        visit(event)
    return {key: totals[key] if key in found else None for key in (
        "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"
    )}


def run_harness(model: Model, case: Case, workspace: Path, sessions: Path) -> dict[str, Any]:
    """Execute one case through the public Python SDK."""
    try:
        from deepseek_harness import DeepSeekHarness
    except ImportError as exc:
        raise RuntimeError("install the local SDK with: python -m pip install -e python/sdk") from exc
    prompt = (workspace / case.prompt_file).read_text(encoding="utf-8")
    started = time.monotonic()
    source_entry = BENCH_ROOT.parent / "packages" / "examples" / "jsonrpc-demo" / "src" / "bin.ts"
    source_launch = ("node", "--import", "tsx", str(source_entry)) if source_entry.is_file() else None
    with DeepSeekHarness(
        provider=model.provider, model=model.model, max_tokens=32768,
        cordis=str(BENCH_ROOT / "cordis.yml"), cwd=str(workspace),
        runtime_cwd=str(BENCH_ROOT.parent), session_root=str(sessions),
        request_timeout_seconds=case.timeout_seconds,
        launch_args_override=source_launch,
    ) as harness:
        result = harness.run(prompt)
    events = [jsonable(event) for event in result.events]
    return {
        "duration_seconds": round(time.monotonic() - started, 3),
        "session_id": str(result.session_id), "finish_reason": result.finish_reason,
        "final_response": result.final_response, "events": events,
        "usage": usage_from_events(events),
    }


def grade(case: Case, workspace: Path) -> dict[str, Any]:
    """Run the fixed grader after the model process exits."""
    started = time.monotonic()
    command = tuple(value.replace("{bench_root}", str(BENCH_ROOT)).replace("{workspace}", str(workspace))
                    for value in case.grader)
    completed = subprocess.run(command, cwd=workspace, text=True, capture_output=True,
                               timeout=case.timeout_seconds, stdin=subprocess.DEVNULL)
    return {"passed": completed.returncode == 0, "exit_code": completed.returncode,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout": completed.stdout, "stderr": completed.stderr}


def write_summary(output: Path, suite_id: str, results: list[dict[str, Any]]) -> None:
    """Write machine-readable results and a compact leaderboard."""
    aggregates = []
    for alias in sorted({row["model_alias"] for row in results}):
        rows = [row for row in results if row["model_alias"] == alias]
        completed = [row for row in rows if row.get("harness", {}).get("finish_reason") == "completed"]
        durations = [row["harness"]["duration_seconds"] for row in completed]
        costs = [row["harness"]["usage"]["cost_usd"] for row in completed
                 if row["harness"]["usage"]["cost_usd"] is not None]
        passed = sum(bool(row.get("grader", {}).get("passed")) for row in completed)
        aggregates.append({"model_alias": alias, "attempts": len(rows), "completed": len(completed),
                           "passed": passed, "pass_rate": passed / len(completed) if completed else None,
                           "mean_duration_seconds": round(sum(durations) / len(durations), 3) if durations else None,
                           "reported_cost_usd": round(sum(costs), 8) if costs else None})
    summary = {"suite": suite_id, "generated_at": datetime.now(timezone.utc).isoformat(),
               "aggregates": aggregates, "results": results}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    lines = [f"# {suite_id} results", "", "| Model | Completed | Passed | Pass rate | Mean seconds | Reported cost |",
             "|---|---:|---:|---:|---:|---:|"]
    for row in aggregates:
        duration = "—" if row["mean_duration_seconds"] is None else str(row["mean_duration_seconds"])
        cost = "—" if row["reported_cost_usd"] is None else f"${row['reported_cost_usd']:.6f}"
        rate = "—" if row["pass_rate"] is None else f"{row['pass_rate']:.0%}"
        lines.append(f"| {row['model_alias']} | {row['completed']}/{row['attempts']} | {row['passed']} | {rate} | {duration} | {cost} |")
    (output / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_suite(args: argparse.Namespace) -> int:
    """Stage, execute, grade, and summarize a model matrix."""
    suite_id, cases = load_suite(args.suite.resolve())
    available = load_models(args.models.resolve())
    aliases = args.model or list(available)
    unknown = [alias for alias in aliases if alias not in available]
    if unknown:
        raise ValueError(f"unknown model alias(es): {', '.join(unknown)}")
    selected = [available[alias] for alias in aliases]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output.resolve() / f"{stamp}-{suite_id}"
    output.mkdir(parents=True, exist_ok=False)
    results: list[dict[str, Any]] = []
    for repetition in range(1, args.repetitions + 1):
        for model in paired_order(selected, repetition):
            for case in cases:
                run_id = f"r{repetition:02d}-{case.case_id}-{model.alias}"
                run_dir = output / run_id
                workspace, sessions = run_dir / "workspace", run_dir / "sessions"
                shutil.copytree(case.fixture, workspace, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
                sessions.mkdir(parents=True)
                row: dict[str, Any] = {"run_id": run_id, "repetition": repetition,
                                       "case_id": case.case_id, "model_alias": model.alias,
                                       "provider": model.provider, "model": model.model}
                print(f"[{run_id}] running", flush=True)
                try:
                    row["harness"] = run_harness(model, case, workspace, sessions)
                except Exception as exc:
                    row["error"] = f"{type(exc).__name__}: {exc}"
                row["grader"] = grade(case, workspace)
                (run_dir / "result.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
                (run_dir / "grader.stdout.txt").write_text(row["grader"]["stdout"], encoding="utf-8")
                (run_dir / "grader.stderr.txt").write_text(row["grader"]["stderr"], encoding="utf-8")
                results.append(row)
                write_summary(output, suite_id, results)
                print(f"[{run_id}] grader {'PASS' if row['grader']['passed'] else 'FAIL'}", flush=True)
    return 0 if all(row.get("harness", {}).get("finish_reason") == "completed"
                    and row["grader"]["passed"] for row in results) else 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate, run = commands.add_parser("validate"), commands.add_parser("run")
    for command in (validate, run):
        command.add_argument("--suite", type=Path, default=DEFAULT_SUITE)
        command.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    run.add_argument("--model", action="append")
    run.add_argument("--repetitions", type=int, default=3)
    run.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    if getattr(args, "repetitions", 1) < 1:
        parser.error("--repetitions must be positive")
    return args


def main(argv: list[str] | None = None) -> int:
    """Run the requested command."""
    args = parse_args(argv)
    try:
        suite_id, cases = load_suite(args.suite.resolve())
        models = load_models(args.models.resolve())
        if args.command == "validate":
            print(json.dumps({"suite": suite_id, "cases": [case.case_id for case in cases],
                              "models": list(models)}, indent=2))
            return 0
        return run_suite(args)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"peck-bench: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
