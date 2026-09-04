#!/usr/bin/env python3
"""Hidden grader for the JSON Lines aggregation fixture."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest


WORKSPACE = Path(sys.argv[1]).resolve()
SPEC = importlib.util.spec_from_file_location("candidate_events", WORKSPACE / "events.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class JsonlAggregationGrader(unittest.TestCase):
    def test_sums_duplicate_kinds_and_sorts_keys(self) -> None:
        rows = [
            {"kind": "zeta", "status": "ok", "amount": 2},
            {"kind": "alpha", "status": "failed", "amount": 99},
            {"kind": "alpha", "status": "ok", "amount": 3},
            {"kind": "zeta", "status": "ok", "amount": -1},
        ]
        document = "\n\n".join(json.dumps(row) for row in rows)
        result = MODULE.aggregate_successes(document)
        self.assertEqual(result, {"alpha": 3, "zeta": 1})
        self.assertEqual(list(result), ["alpha", "zeta"])

    def test_rejects_invalid_json(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.aggregate_successes('{"kind":"a"}\nnot-json')

    def test_rejects_invalid_included_fields(self) -> None:
        invalid = [
            {"status": "ok", "amount": 1},
            {"status": "ok", "kind": 7, "amount": 1},
            {"status": "ok", "kind": "a", "amount": True},
            {"status": "ok", "kind": "a", "amount": 1.5},
        ]
        for row in invalid:
            with self.subTest(row=row), self.assertRaises(ValueError):
                MODULE.aggregate_successes(json.dumps(row))

    def test_ignores_fields_on_unsuccessful_records(self) -> None:
        self.assertEqual(MODULE.aggregate_successes('{"status":"failed"}'), {})


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
