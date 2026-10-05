#!/usr/bin/env python3
"""Use the approved host's Notion credential and canonical private receipt DB."""

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rpos.delivery_store import DeliveryStore
from rpos.delivery_worker import DeliveryWorker, DeliveryConflict, DeliveryBusy
from rpos.exercise_export import event_from_export
from rpos.notion_transport import NotionHttp, NotionRestPort, ReviewedTargets, TransportError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "deliver", "resume"])
    parser.add_argument("--export", type=Path)
    parser.add_argument("--database", type=Path,
                        help="Approved persistent DB shared by all workers; required for writes")
    parser.add_argument("--review", type=Path, help="Private event-bound source-window/sequence review")
    args = parser.parse_args()
    if args.command == "deliver" and not args.export:
        parser.error("deliver requires --export")
    if args.command != "check" and not args.database:
        parser.error("writes require the approved --database; no implicit second receipt DB")
    # Read credentials only from the approved host environment, never arguments.
    try:
        token = os.environ["RPOS_NOTION_TOKEN"]
        source_id = os.environ["RPOS_FITNESS_DATA_SOURCE_ID"]
        reviews = ReviewedTargets(json.loads(args.review.read_text()) if args.review else None)
        remote = NotionRestPort(NotionHttp(token), source_id, reviews)
        remote.validate_schema()
        if args.command == "check":
            print("Existing Fitness schema/access: ready. No writes performed.")
            return 0
        os.umask(0o077)
        path = args.database.expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        worker = DeliveryWorker(DeliveryStore(path), remote)
        if args.command == "deliver":
            event = event_from_export(json.loads(args.export.read_text()))
            results = [worker.deliver(event)]
        else:
            results = worker.resume()
        print(json.dumps({"results": results, "outstanding": len(worker.store.outstanding())}))
        return 0 if all(result == "confirmed" for result in results) else 2
    except (KeyError, ValueError, OSError, DeliveryConflict, DeliveryBusy, TransportError):
        # Do not log raw health fields, credentials, server bodies or manifest data.
        print("Delivery blocked/failed. Preserve the original receipt; review privately.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
