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

    def test_network_constrained_persisted_job_has_both_permissions(self):
        MODULE.validate_job_permissions(self.manifest("ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED"))

    def test_missing_network_state_permission_rejects_release(self):
        with self.assertRaisesRegex(ValueError, "ACCESS_NETWORK_STATE"):
            MODULE.validate_job_permissions(self.manifest("RECEIVE_BOOT_COMPLETED"))

    def test_missing_boot_permission_rejects_persisted_job(self):
        with self.assertRaisesRegex(ValueError, "RECEIVE_BOOT_COMPLETED"):
            MODULE.validate_job_permissions(self.manifest("ACCESS_NETWORK_STATE"))

    def test_comment_is_not_a_manifest_permission(self):
        manifest = self.manifest("RECEIVE_BOOT_COMPLETED").replace(
            "</manifest>", "<!-- android.permission.ACCESS_NETWORK_STATE --></manifest>"
        )
        with self.assertRaisesRegex(ValueError, "ACCESS_NETWORK_STATE"):
            MODULE.validate_job_permissions(manifest)

    @staticmethod
    def manifest(*permissions):
        declarations = "".join(
            f'<uses-permission android:name="android.permission.{permission}" />'
            for permission in permissions
        )
        return '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' + declarations + '</manifest>'


if __name__ == "__main__":
    unittest.main()
