"""Merge application configuration values."""

from __future__ import annotations

from typing import Any


def merge_config(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Return configuration with override values applied."""
    result = base.copy()
    result.update(override)
    return result
