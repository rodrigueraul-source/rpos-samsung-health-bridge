import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "validate_android_contract",
    ROOT / "scripts" / "validate_android_contract.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AndroidContractTests(unittest.TestCase):
    def test_android_contract(self):
        MODULE.validate_android_contract()


if __name__ == "__main__":
    unittest.main()
