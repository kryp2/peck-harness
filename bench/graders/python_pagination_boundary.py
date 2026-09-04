#!/usr/bin/env python3
"""Hidden external grader for the pagination fixture."""

from pathlib import Path
import sys
import unittest


if len(sys.argv) != 2:
    raise SystemExit("usage: python_pagination_boundary.py WORKSPACE")
workspace = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(workspace))

from pagination import page  # noqa: E402


class PaginationGrader(unittest.TestCase):
    def test_first_page_starts_at_first_item(self) -> None:
        self.assertEqual(page(["a", "b", "c"], 1, 2), ["a", "b"])

    def test_partial_last_page(self) -> None:
        self.assertEqual(page(["a", "b", "c"], 2, 2), ["c"])

    def test_page_after_end_is_empty(self) -> None:
        self.assertEqual(page(["a"], 3, 2), [])

    def test_invalid_arguments_are_rejected(self) -> None:
        for page_number, page_size in ((0, 1), (1, 0), (-1, 1), (1, -1)):
            with self.subTest(page_number=page_number, page_size=page_size):
                with self.assertRaises(ValueError):
                    page(["a"], page_number, page_size)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
