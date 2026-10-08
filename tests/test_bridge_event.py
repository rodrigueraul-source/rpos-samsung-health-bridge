import unittest

from rpos.bridge_event import ReplayGuard, event_from_samsung_exercise


class BridgeEventTests(unittest.TestCase):
    def test_original_samsung_uid_becomes_source_record_id(self):
        event = event_from_samsung_exercise(
            {
                "uid": "samsung-uid-001",
                "start_time": "2026-10-03T17:36:00-06:00",
                "exercise_type": "WEIGHT_MACHINE",
            }
        )
        self.assertEqual(event.source, "samsung_health")
        self.assertEqual(event.source_record_id, "samsung-uid-001")
        self.assertEqual(
            event.to_notion_properties()["Source Record ID"],
            "samsung-uid-001",
        )

    def test_missing_uid_is_rejected(self):
        with self.assertRaises(ValueError):
            event_from_samsung_exercise(
                {"start_time": "2026-10-03T17:36:00-06:00"}
            )

    def test_mapping_matches_existing_fitness_sessions_schema(self):
        event = event_from_samsung_exercise(
            {
                "uid": "samsung-uid-schema-test",
                "start_time": "2026-10-03T23:36:00.247Z",
                "exercise_type": "OTHER",
            }
        )
        self.assertEqual(
            event.to_notion_properties(),
            {
                "Source": "samsung_health",
                "Source Record ID": "samsung-uid-schema-test",
                "date:Date:start": "2026-10-03T23:36:00.247Z",
                "date:Date:is_datetime": 1,
            },
        )
        self.assertEqual(event.metric_type, "exercise")
        self.assertEqual(event.objective, {"exercise_type": "OTHER"})

    def test_replay_is_idempotent(self):
        event = event_from_samsung_exercise(
            {
                "uid": "samsung-uid-002",
                "start_time": "2026-10-03T17:36:00-06:00",
            }
        )
        guard = ReplayGuard()
        self.assertTrue(guard.accept(event))
        self.assertFalse(guard.accept(event))

    def test_same_uid_from_different_source_is_not_collapsed(self):
        event = event_from_samsung_exercise(
            {
                "uid": "shared-id",
                "start_time": "2026-10-03T17:36:00-06:00",
            }
        )
        guard = ReplayGuard()
        self.assertTrue(guard.accept(event))

        other = type(event)(
            source="other_source",
            source_record_id="shared-id",
            recorded_at=event.recorded_at,
            metric_type=event.metric_type,
            objective={},
        )
        self.assertTrue(guard.accept(other))


if __name__ == "__main__":
    unittest.main()
