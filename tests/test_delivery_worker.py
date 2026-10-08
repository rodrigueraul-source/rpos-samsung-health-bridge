"""Fault injection at the remote boundary. All workouts/UIDs are synthetic."""

from dataclasses import replace
import multiprocessing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from rpos.bridge_event import BridgeEvent
from rpos.delivery_store import DeliveryStore, UnresolvedWriteError
from rpos.delivery_worker import (DeliveryWorker, DeliveryConflict, DeliveryBusy,
                                  PageReadback, Reconciliation)


def event(uid="fixture-a"):
    return BridgeEvent("samsung_health", uid, "2026-01-01T12:00:00Z", "exercise",
                       {"end_time": "2026-01-01T13:00:00Z", "sessions": []})


class FakeNotion:
    def __init__(self):
        self.pages = {}
        self.metrics = {}
        self.aliases = {}
        self.writes = 0
        self.fault = None
        self.visible = True
        self.resolution = Reconciliation(True)

    def find_uid(self, source, uid):
        if not self.visible:
            return []
        return [id for id, p in self.pages.items() if (p.source, p.uid) == (source, uid)]

    def reconcile(self, event):
        return self.resolution

    def read_page(self, id):
        if self.fault == "readback":
            self.fault = None
            raise TimeoutError("readback failure")
        return self.pages[id]

    def update_evidence(self, id, event, digest):
        self.aliases.setdefault(id, []).append(self.pages[id].uid)
        return self._write(id, event, digest)

    def create_evidence(self, event, digest):
        return self._write("page-" + event.source_record_id, event, digest)

    def _write(self, id, event, digest):
        self.writes += 1
        if self.fault == "before_write":
            raise TimeoutError("request never applied")
        self.pages[id] = PageReadback(id, event.source, event.source_record_id, digest)
        if self.fault == "after_write":
            raise TimeoutError("applied but response lost")
        if self.fault == "crash":
            raise SystemExit("process ended after applying write")
        return id


def contender(path, queue):
    try:
        DeliveryWorker(DeliveryStore(path), FakeNotion()).deliver(event())
        queue.put("entered")
    except DeliveryBusy:
        queue.put("busy")


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "receipt.sqlite3"
        self.remote = FakeNotion()
        self.store = DeliveryStore(self.path)
        self.worker = DeliveryWorker(self.store, self.remote)

    def test_two_uids_once_each_and_unchanged_replay_has_no_write(self):
        for uid in ["fixture-a", "fixture-b", "fixture-a"]:
            self.assertEqual(self.worker.deliver(event(uid)), "confirmed")
        self.assertEqual(self.remote.writes, 2)
        self.assertEqual(len(self.remote.pages), 2)
        self.assertEqual(self.store.outstanding(), [])

    def test_timeout_after_create_resolves_after_restart_without_second_create(self):
        self.remote.fault = "after_write"
        with self.assertRaises(TimeoutError): self.worker.deliver(event())
        self.assertEqual(DeliveryStore(self.path).stage(event()).state, "attempting")
        self.remote.fault = None
        reopened = DeliveryWorker(DeliveryStore(self.path), self.remote)
        self.assertEqual(reopened.resume(), ["confirmed"])
        self.assertEqual(self.remote.writes, 1)

    def test_crash_after_create_resolves_without_second_create(self):
        self.remote.fault = "crash"
        with self.assertRaises(SystemExit): self.worker.deliver(event())
        self.remote.fault = None
        self.assertEqual(DeliveryWorker(DeliveryStore(self.path), self.remote).resume(), ["confirmed"])
        self.assertEqual(self.remote.writes, 1)

    def test_empty_lookup_after_timeout_is_not_permission_to_repeat_create(self):
        self.remote.fault = "after_write"
        with self.assertRaises(TimeoutError): self.worker.deliver(event())
        self.remote.fault = None
        self.remote.visible = False
        self.assertEqual(self.worker.resume(), ["unresolved"])
        self.assertEqual(self.remote.writes, 1)
        self.remote.visible = True
        self.assertEqual(self.worker.resume(), ["confirmed"])

    def test_timeout_before_write_stays_unresolved_instead_of_blind_retry(self):
        self.remote.fault = "before_write"
        with self.assertRaises(TimeoutError): self.worker.deliver(event())
        self.remote.fault = None
        self.assertEqual(self.worker.resume(), ["unresolved"])
        self.assertEqual(self.remote.writes, 1)
        self.assertEqual(self.remote.pages, {})

    def test_readback_failure_retains_target_and_recovers(self):
        self.remote.fault = "readback"
        with self.assertRaises(TimeoutError): self.worker.deliver(event())
        self.assertEqual(self.store.stage(event()).notion_page_id, "page-fixture-a")
        self.assertEqual(self.worker.resume(), ["confirmed"])
        self.assertEqual(self.remote.writes, 1)

    def test_changed_payload_cannot_erase_an_uncertain_create(self):
        self.remote.fault = "after_write"
        with self.assertRaises(TimeoutError): self.worker.deliver(event())
        changed = replace(event(), objective={"end_time": "2026-01-01T14:00:00Z"})
        with self.assertRaises(UnresolvedWriteError): self.store.stage(changed)
        self.assertEqual(self.store.outstanding(), [event()])
        self.remote.fault = None
        self.worker.resume()
        self.assertEqual(self.worker.deliver(changed), "confirmed")
        self.assertEqual(len(self.remote.pages), 1)
        self.assertEqual(self.remote.writes, 2)

    def test_manual_target_reused_and_adapter_preserves_aliases_and_metrics(self):
        self.remote.pages["manual"] = PageReadback("manual", "drive", "capture-alias", None)
        self.remote.metrics["manual"] = {"calories": 664, "rir": 0}
        self.remote.resolution = Reconciliation(True, "manual")
        self.assertEqual(self.worker.deliver(event()), "confirmed")
        self.assertEqual(self.remote.metrics["manual"], {"calories": 664, "rir": 0})
        self.assertEqual(self.remote.aliases["manual"], ["capture-alias"])
        self.assertEqual(list(self.remote.pages), ["manual"])

    def test_ambiguous_or_unchecked_evidence_cannot_create(self):
        for plan in [Reconciliation(False), Reconciliation(True, ambiguous=True)]:
            self.remote.resolution = plan
            self.assertEqual(self.worker.deliver(event()), "needs_reconciliation")
        self.assertEqual(self.remote.writes, 0)

    def test_reconciliation_cannot_overwrite_another_samsung_uid(self):
        self.remote.pages["other"] = PageReadback("other", "samsung_health", "fixture-b", None)
        self.remote.resolution = Reconciliation(True, "other")
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.remote.writes, 0)

    def test_duplicate_remote_uid_blocks_writes(self):
        for id in ["a", "b"]:
            self.remote.pages[id] = PageReadback(id, "samsung_health", "fixture-a", None)
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.remote.writes, 0)

    def test_wrong_hash_or_identity_cannot_confirm(self):
        original = self.remote._write
        def altered(id, ev, digest):
            result = original(id, ev, digest)
            self.remote.pages[id] = replace(self.remote.pages[id], payload_hash="wrong")
            return result
        self.remote._write = altered
        self.assertEqual(self.worker.deliver(event()), "unresolved")
        self.assertEqual(self.store.stage(event()).state, "attempting")
        self.remote.pages["page-fixture-a"] = PageReadback("page-fixture-a", "mock", "fixture-a", None)
        # With no canonical match, uncertain writes still stay unresolved.
        self.assertEqual(self.worker.resume(), ["unresolved"])

    def test_other_process_cannot_write_while_worker_holds_lock(self):
        ctx = multiprocessing.get_context("fork")
        queue = ctx.Queue()
        with self.worker._exclusive():
            process = ctx.Process(target=contender, args=(str(self.path), queue))
            process.start()
            process.join(timeout=5)
            self.assertFalse(process.is_alive())
            self.assertEqual(queue.get(timeout=2), "busy")
        queue.close()
        self.assertEqual(self.remote.writes, 0)

    def test_wrong_returned_identity_keeps_the_write_unconfirmed(self):
        original = self.remote._write
        def altered(id, ev, digest):
            result = original(id, ev, digest)
            self.remote.pages[id] = replace(self.remote.pages[id], uid="wrong-uid")
            return result
        self.remote._write = altered
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.store.stage(event()).state, "attempting")

    def test_duplicate_appearing_during_readback_does_not_confirm_receipt(self):
        original = self.remote.read_page
        def racing(id):
            page = original(id)
            self.remote.pages["racing-page"] = replace(page, page_id="racing-page")
            return page
        self.remote.read_page = racing
        with self.assertRaises(DeliveryConflict): self.worker.deliver(event())
        self.assertEqual(self.store.stage(event()).state, "attempting")

    def test_existing_v03_database_is_migrated_without_losing_receipt(self):
        legacy = Path(self.directory.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy) as db:
            db.execute("CREATE TABLE deliveries (source TEXT,uid TEXT,payload TEXT,payload_hash TEXT,state TEXT,notion_page_id TEXT,PRIMARY KEY(source,uid))")
            db.execute("INSERT INTO deliveries VALUES ('samsung_health','legacy','{}','hash','confirmed','page')")
        DeliveryStore(legacy)
        with sqlite3.connect(legacy) as db:
            self.assertEqual(db.execute("SELECT state,notion_page_id,attempt_kind FROM deliveries").fetchone(),
                             ("confirmed", "page", None))


if __name__ == "__main__": unittest.main()
