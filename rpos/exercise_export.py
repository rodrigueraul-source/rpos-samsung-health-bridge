"""Validate the own-app handoff before staging it as real Samsung evidence."""

from datetime import datetime
from typing import Any

from rpos.bridge_event import BridgeEvent, event_from_samsung_exercise


def event_from_export(envelope: dict[str, Any]) -> BridgeEvent:
    if envelope.get("schema_version") != "rpos.exercise.export.v1":
        raise ValueError("Unsupported Exercise export schema")
    if envelope.get("source") != "samsung_health" or envelope.get("sdk_version") != "1.1.0":
        raise ValueError("Real Samsung SDK provenance is required; mock exports are rejected")
    record = envelope.get("record")
    if not isinstance(record, dict):
        raise ValueError("Exercise record must be an object")
    if not isinstance(record.get("uid"), str) or not record["uid"].strip():
        raise ValueError("Original Samsung UID must be a nonempty string")
    start = record.get("start_time")
    try:
        parsed = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError("Timezone is required")
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("Exercise start_time must be an ISO timestamp with timezone") from error
    return event_from_samsung_exercise(record)
