"""Aggregate successful event amounts from JSON Lines input."""

from __future__ import annotations

import json


def aggregate_successes(document: str) -> dict[str, int]:
    """Return total successful amounts grouped by event kind."""
    totals: dict[str, int] = {}
    for line in document.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("status") != "ok":
            continue
        totals[event["kind"]] = event["amount"]
    return totals
