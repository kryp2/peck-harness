#!/usr/bin/env python3
"""Hidden grader for the recursive configuration merge fixture."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


WORKSPACE = Path(sys.argv[1]).resolve()
SPEC = importlib.util.spec_from_file_location("candidate_config", WORKSPACE / "config.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ConfigMergeGrader(unittest.TestCase):
    def test_recursively_merges_and_replaces_non_dicts(self) -> None:
        base = {"db": {"host": "a", "ports": [1, 2]}, "feature": {"on": True}, "keep": None}
        override = {"db": {"host": "b", "ports": [3]}, "feature": None}
        self.assertEqual(MODULE.merge_config(base, override), {
            "db": {"host": "b", "ports": [3]}, "feature": None, "keep": None,
        })

    def test_result_is_independent_of_both_inputs(self) -> None:
        base = {"left": {"items": [1]}, "shared": {"base": [2]}}
        override = {"right": {"items": [3]}, "shared": {"extra": [4]}}
        result = MODULE.merge_config(base, override)
        result["left"]["items"].append(5)
        result["right"]["items"].append(6)
        result["shared"]["base"].append(7)
        result["shared"]["extra"].append(8)
        self.assertEqual(base, {"left": {"items": [1]}, "shared": {"base": [2]}})
        self.assertEqual(override, {"right": {"items": [3]}, "shared": {"extra": [4]}})

    def test_rejects_non_dictionary_inputs(self) -> None:
        with self.assertRaises(TypeError):
            MODULE.merge_config([], {})
        with self.assertRaises(TypeError):
            MODULE.merge_config({}, [])


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
