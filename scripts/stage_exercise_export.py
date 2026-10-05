#!/usr/bin/env python3
"""Stage a private own-app JSON export without making any network write."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rpos.delivery_store import DeliveryStore
from rpos.exercise_export import event_from_export


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--database", type=Path, default=Path("data/private/delivery.sqlite3"))
    args = parser.parse_args()
    event = event_from_export(json.loads(args.export.read_text()))
    args.database.parent.mkdir(parents=True, exist_ok=True)
    delivery = DeliveryStore(args.database).stage(event)
    print(f"Staged: {delivery.state}; pending deliveries: {len(DeliveryStore(args.database).pending())}")
    print("No Notion write performed. Reconcile evidence and verify remote readback before confirmation.")


if __name__ == "__main__":
    main()
