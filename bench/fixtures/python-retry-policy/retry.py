"""Describe retry delays for HTTP failures."""

from __future__ import annotations


def retry_delays(status_code: int, attempts: int, base_seconds: float, cap_seconds: float) -> list[float]:
    """Return delays before retries for one HTTP response status."""
    if attempts < 1 or base_seconds <= 0 or cap_seconds <= 0:
        raise ValueError("invalid retry policy")
    if status_code < 500:
        return []
    return [min(base_seconds * (2 ** attempt), cap_seconds) for attempt in range(attempts)]
