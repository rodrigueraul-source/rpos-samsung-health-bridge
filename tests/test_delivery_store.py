import tempfile
from pathlib import Path
import unittest

from rpos.delivery_store import DeliveryStore
from rpos.exercise_export import event_from_export


def fixture(**record_changes):
    return {
        "schema_version": "rpos.exercise.export.v1", "source": "samsung_health",
        "sdk_version": "1.1.0", "read_at": "2026-01-02T00:00:00Z",
        "record": {"uid": "synthetic-uid", "start_time": "2026-01-01T00:00:00Z",
                   "end_time": "2026-01-01T01:00:00Z", "sessions": [], **record_changes},
    }


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "private.sqlite3"
        self.event = event_from_export(fixture())

    def test_pending_retry_and_replay_survive_restart(self):
        first = DeliveryStore(self.path).stage(self.event)
        # A failed remote call never confirms anything; retry stays pending.
        reopened = DeliveryStore(self.path)
        self.assertEqual(reopened.stage(self.event), first)
        self.assertEqual(reopened.pending(), [self.event])
        reopened.confirm_readback(first, notion_page_id="synthetic-page", observed_source="samsung_health",
                                  observed_uid="synthetic-uid")
        replay = DeliveryStore(self.path)
        self.assertEqual(replay.stage(self.event).state, "confirmed")
        self.assertEqual(replay.pending(), [])

    def test_changed_record_requires_new_readback_and_preserves_target(self):
        store = DeliveryStore(self.path)
        first = store.stage(self.event)
        store.confirm_readback(first, notion_page_id="synthetic-page", observed_source="samsung_health",
                               observed_uid="synthetic-uid")
        changed = event_from_export(fixture(end_time="2026-01-01T01:10:00Z"))
        updated = store.stage(changed)
        self.assertEqual(updated.state, "pending")
        self.assertEqual(updated.notion_page_id, "synthetic-page")
        with self.assertRaises(ValueError):
            store.confirm_readback(first, notion_page_id="synthetic-page", observed_source="samsung_health",
                                   observed_uid="synthetic-uid")

    def test_mismatched_or_different_target_readback_rejected(self):
        store = DeliveryStore(self.path)
        staged = store.stage(self.event)
        with self.assertRaises(ValueError):
            store.confirm_readback(staged, notion_page_id="synthetic-page", observed_source="samsung_health",
                                   observed_uid="wrong-uid")
        store.confirm_readback(staged, notion_page_id="synthetic-page", observed_source="samsung_health",
                               observed_uid="synthetic-uid")
        with self.assertRaises(ValueError):
            store.confirm_readback(staged, notion_page_id="other-page", observed_source="samsung_health",
                                   observed_uid="synthetic-uid")

    def test_new_read_timestamp_does_not_create_new_delivery(self):
        store = DeliveryStore(self.path)
        first = store.stage(self.event)
        later = fixture()
        later["read_at"] = "2026-01-03T00:00:00Z"
        self.assertEqual(store.stage(event_from_export(later)), first)
        self.assertEqual(len(store.pending()), 1)

    def test_mock_and_invalid_time_or_uid_rejected(self):
        mock = fixture()
        mock["source"] = "mock"
        for bad in [mock, fixture(uid=12), fixture(uid=""), fixture(start_time="2026-01-01T00:00:00"),
                    fixture(start_time="invalid")]:
            with self.subTest(payload=bad), self.assertRaises(ValueError):
                event_from_export(bad)


if __name__ == "__main__":
    unittest.main()
