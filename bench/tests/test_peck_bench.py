import json
from pathlib import Path
import shutil
import tempfile
import unittest

from bench import peck_bench


class PeckBenchTest(unittest.TestCase):
    def test_bundled_suite_and_models_validate(self) -> None:
        suite_id, cases = peck_bench.load_suite(peck_bench.DEFAULT_SUITE)
        models = peck_bench.load_models(peck_bench.DEFAULT_MODELS)
        self.assertEqual(suite_id, "coding-v1")
        self.assertEqual([case.case_id for case in cases], [
            "python-pagination-boundary",
            "python-jsonl-aggregation",
            "python-retry-policy",
            "python-config-merge",
        ])
        self.assertEqual(set(models), {"omen-alpha", "muse-spark-1.3-contributor"})

    def test_paired_order_alternates(self) -> None:
        models = list(peck_bench.load_models(peck_bench.DEFAULT_MODELS).values())
        self.assertEqual(peck_bench.paired_order(models, 1), models)
        self.assertEqual(peck_bench.paired_order(models, 2), list(reversed(models)))

    def test_usage_keeps_missing_values_unknown(self) -> None:
        usage = peck_bench.usage_from_events([
            {"data": {"usage": {"inputTokens": 12, "outputTokens": 4}}},
            {"data": {"usage": {"inputTokens": 3, "outputTokens": 2}}},
        ])
        self.assertEqual(usage["input_tokens"], 15)
        self.assertEqual(usage["output_tokens"], 6)
        self.assertIsNone(usage["cost_usd"])

    def test_summary_does_not_estimate_cost(self) -> None:
        results = [{"model_alias": "omen-alpha", "grader": {"passed": True},
                    "harness": {"finish_reason": "completed", "duration_seconds": 2.0,
                                "usage": {"cost_usd": None}}}]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            peck_bench.write_summary(output, "fixture", results)
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["aggregates"][0]["pass_rate"], 1.0)
            self.assertIsNone(summary["aggregates"][0]["reported_cost_usd"])
            self.assertIn("| omen-alpha | 1/1 | 1 | 100% |", (output / "summary.md").read_text(encoding="utf-8"))

    def test_failed_harness_attempt_is_not_scored_as_model_failure(self) -> None:
        results = [{"model_alias": "muse", "grader": {"passed": False},
                    "harness": {"finish_reason": "error", "duration_seconds": 1.0,
                                "usage": {"cost_usd": None}}}]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            peck_bench.write_summary(output, "fixture", results)
            aggregate = json.loads((output / "summary.json").read_text(encoding="utf-8"))["aggregates"][0]
            self.assertEqual(aggregate["completed"], 0)
            self.assertIsNone(aggregate["pass_rate"])

    def test_hidden_grader_rejects_baseline_and_accepts_fix(self) -> None:
        _, cases = peck_bench.load_suite(peck_bench.DEFAULT_SUITE)
        case = cases[0]
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "workspace"
            shutil.copytree(case.fixture, workspace)
            self.assertFalse(peck_bench.grade(case, workspace)["passed"])
            source = workspace / "pagination.py"
            source.write_text(source.read_text(encoding="utf-8").replace(
                "start = page_number * page_size", "start = (page_number - 1) * page_size"
            ), encoding="utf-8")
            self.assertTrue(peck_bench.grade(case, workspace)["passed"])

    def test_every_hidden_grader_rejects_its_baseline(self) -> None:
        _, cases = peck_bench.load_suite(peck_bench.DEFAULT_SUITE)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for case in cases:
                with self.subTest(case=case.case_id):
                    workspace = root / case.case_id
                    shutil.copytree(case.fixture, workspace)
                    self.assertFalse(peck_bench.grade(case, workspace)["passed"])


if __name__ == "__main__":
    unittest.main()
