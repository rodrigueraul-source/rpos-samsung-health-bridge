"""Canonical event + idempotent replay logic for Samsung Health Bridge."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BridgeEvent:
    source: str
    source_record_id: str
    recorded_at: str
    metric_type: str
    objective: dict[str, Any]

    @property
    def dedupe_key(self) -> tuple[str, str]:
        return (self.source, self.source_record_id)

    def to_notion_properties(self) -> dict[str, Any]:
        """Return the minimal provenance mapping required by R-POS.

        This deliberately does not perform network writes.
        """
        return {
            "Source": self.source,
            "Source Record ID": self.source_record_id,
            "Recorded At": self.recorded_at,
            "Metric Type": self.metric_type,
        }


class ReplayGuard:
    """In-memory reference implementation of the Bridge idempotency rule."""

    def __init__(self) -> None:
        self._seen: set[tuple[str, str]] = set()

    def accept(self, event: BridgeEvent) -> bool:
        """Return True once per (source, source_record_id), False on replay."""
        key = event.dedupe_key
        if key in self._seen:
            return False
        self._seen.add(key)
        return True


def event_from_samsung_exercise(payload: dict[str, Any]) -> BridgeEvent:
    """Normalize the minimum proven Samsung Exercise envelope.

    The original Samsung UID is mandatory. A synthetic record_id is never used
    as a substitute for source provenance.
    """
    uid = str(payload.get("uid") or "").strip()
    if not uid:
        raise ValueError("Samsung Exercise uid is required")

    start_time = str(payload.get("start_time") or "").strip()
    if not start_time:
        raise ValueError("Samsung Exercise start_time is required")

    return BridgeEvent(
        source="samsung_health",
        source_record_id=uid,
        recorded_at=start_time,
        metric_type="exercise",
        objective={
            key: value
            for key, value in payload.items()
            if key not in {"uid", "start_time"} and value is not None
        },
    )
