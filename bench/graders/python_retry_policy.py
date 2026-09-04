#!/usr/bin/env python3
"""Hidden grader for the retry-policy fixture."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


WORKSPACE = Path(sys.argv[1]).resolve()
SPEC = importlib.util.spec_from_file_location("candidate_retry", WORKSPACE / "retry.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RetryPolicyGrader(unittest.TestCase):
    def test_retryable_statuses_and_attempt_count(self) -> None:
        self.assertEqual(MODULE.retry_delays(408, 1, 0.5, 9), [])
        self.assertEqual(MODULE.retry_delays(429, 4, 0.5, 9), [0.5, 1.0, 2.0])
        self.assertEqual(MODULE.retry_delays(503, 3, 1, 10), [1, 2])

    def test_cap_and_non_retryable_status(self) -> None:
        self.assertEqual(MODULE.retry_delays(599, 5, 2, 5), [2, 4, 5, 5])
        self.assertEqual(MODULE.retry_delays(409, 5, 2, 5), [])

    def test_rejects_invalid_values(self) -> None:
        invalid = [
            (True, 2, 1, 2), (99, 2, 1, 2), (600, 2, 1, 2),
            (500, True, 1, 2), (500, 0, 1, 2),
            (500, 2, True, 2), (500, 2, 0, 2),
            (500, 2, float("inf"), 2), (500, 2, 1, float("nan")),
        ]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(ValueError):
                MODULE.retry_delays(*values)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
