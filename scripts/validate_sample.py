#!/usr/bin/env python3
"""Validación mínima sin dependencias externas para los registros de ejemplo."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "samples" / "health-records.sample.json"
REQUIRED = {
    "schema_version",
    "record_id",
    "metric_type",
    "value",
    "unit",
    "recorded_at",
    "source",
    "quality",
}
METRICS = {"steps", "sleep", "exercise", "heart_rate", "weight"}
QUALITY = {"measured", "estimated", "manual"}


def validate_record(record: dict) -> None:
    missing = REQUIRED - record.keys()
    if missing:
        raise ValueError(f"Missing fields: {sorted(missing)}")
    if record["schema_version"] != "0.1":
        raise ValueError("Unsupported schema_version")
    if record["metric_type"] not in METRICS:
        raise ValueError("Unsupported metric_type")
    if record["quality"] not in QUALITY:
        raise ValueError("Unsupported quality")
    if not isinstance(record["value"], (int, float)):
        raise ValueError("value must be numeric")
    timestamp = datetime.fromisoformat(record["recorded_at"])
    if timestamp.tzinfo is None:
        raise ValueError("recorded_at must include a timezone")


def main() -> None:
    records = json.loads(SAMPLE.read_text(encoding="utf-8"))
    for record in records:
        validate_record(record)
    print(f"PASS: {len(records)} sample records are valid")


if __name__ == "__main__":
    main()
