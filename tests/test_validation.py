import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validate_sample", ROOT / "scripts" / "validate_sample.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ValidationTests(unittest.TestCase):
    def test_valid_record(self):
        MODULE.validate_record(
            {
                "schema_version": "0.1",
                "record_id": "test-1",
                "metric_type": "steps",
                "value": 100,
                "unit": "count",
                "recorded_at": "2026-09-20T08:00:00-06:00",
                "source": "test",
                "quality": "measured",
            }
        )

    def test_timezone_is_required(self):
        with self.assertRaises(ValueError):
            MODULE.validate_record(
                {
                    "schema_version": "0.1",
                    "record_id": "test-2",
                    "metric_type": "weight",
                    "value": 100,
                    "unit": "kg",
                    "recorded_at": "2026-09-20T08:00:00",
                    "source": "test",
                    "quality": "manual",
                }
            )


if __name__ == "__main__":
    unittest.main()
