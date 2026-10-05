"""Private durable staging. Not a Notion client or proof of a remote write."""

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import sqlite3

from rpos.bridge_event import BridgeEvent


@dataclass(frozen=True)
class StagedDelivery:
    source: str
    uid: str
    payload_hash: str
    state: str
    notion_page_id: str | None


class DeliveryStore:
    """One durable row per source/UID; pending events survive process restarts.

    A worker must query Notion by source/UID, reconcile manual evidence, then
    write and read back. Only that verified readback may confirm a delivery.
    The payload hash rejects a stale confirmation if the source record changed.
    """

    def __init__(self, path: str | Path):
        self.path = str(path)
        with sqlite3.connect(self.path) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS deliveries (
                source TEXT NOT NULL, uid TEXT NOT NULL, payload TEXT NOT NULL,
                payload_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                notion_page_id TEXT, PRIMARY KEY(source, uid))""")

    def stage(self, event: BridgeEvent) -> StagedDelivery:
        if not event.source or not event.source_record_id:
            raise ValueError("Source and original UID are required")
        payload = json.dumps(asdict(event), sort_keys=True, separators=(",", ":"), allow_nan=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        with sqlite3.connect(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""INSERT INTO deliveries(source,uid,payload,payload_hash)
                VALUES (?,?,?,?) ON CONFLICT(source,uid) DO UPDATE SET
                payload=excluded.payload, payload_hash=excluded.payload_hash,
                state=CASE WHEN deliveries.payload_hash=excluded.payload_hash
                    THEN deliveries.state ELSE 'pending' END""",
                (*event.dedupe_key, payload, digest))
            row = db.execute("""SELECT source,uid,payload_hash,state,notion_page_id
                FROM deliveries WHERE source=? AND uid=?""", event.dedupe_key).fetchone()
        return StagedDelivery(*row)

    def pending(self) -> list[BridgeEvent]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT payload FROM deliveries WHERE state='pending' ORDER BY source,uid").fetchall()
        return [BridgeEvent(**json.loads(row[0])) for row in rows]

    def confirm_readback(self, delivery: StagedDelivery, *, notion_page_id: str,
                         observed_source: str, observed_uid: str) -> None:
        """Caller must supply actual readback; this function makes no network call."""
        if not notion_page_id or (observed_source, observed_uid) != (delivery.source, delivery.uid):
            raise ValueError("Readback must match the original source/UID and target page")
        with sqlite3.connect(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("""SELECT payload_hash,notion_page_id FROM deliveries
                WHERE source=? AND uid=?""", (delivery.source, delivery.uid)).fetchone()
            if current is None or current[0] != delivery.payload_hash:
                raise ValueError("Delivery changed; stale readback cannot confirm it")
            if current[1] is not None and current[1] != notion_page_id:
                raise ValueError("UID already reconciled to a different Notion page")
            db.execute("""UPDATE deliveries SET state='confirmed',notion_page_id=?
                WHERE source=? AND uid=?""", (notion_page_id, delivery.source, delivery.uid))
