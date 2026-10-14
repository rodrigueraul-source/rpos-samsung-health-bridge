#!/usr/bin/env python3
"""Static guardrails for the Android acquisition layer.

This does not replace a real Android build or Samsung device UAT. It protects
the architectural contract that can be checked without proprietary binaries.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    ROOT / "settings.gradle.kts",
    ROOT / "build.gradle.kts",
    ROOT / "app" / "build.gradle.kts",
    ROOT / "app" / "src" / "main" / "AndroidManifest.xml",
    ROOT / "app" / "src" / "main" / "java" / "com" / "rpos" / "bridge" / "MainActivity.kt",
    ROOT / "app" / "src" / "main" / "java" / "com" / "rpos" / "bridge" / "source" / "ExerciseReader.kt",
    ROOT / "app" / "src" / "samsung" / "java" / "com" / "rpos" / "bridge" / "source" / "ExerciseReaderProvider.kt",
    ROOT / "app" / "src" / "mock" / "java" / "com" / "rpos" / "bridge" / "source" / "ExerciseReaderProvider.kt",
]

SAMSUNG_READER = REQUIRED_FILES[6]
BUILD_FILE = ROOT / "app" / "build.gradle.kts"
GITIGNORE = ROOT / ".gitignore"


def validate_android_contract() -> None:
    missing = [str(path.relative_to(ROOT)) for path in REQUIRED_FILES if not path.exists()]
    if missing:
        raise ValueError(f"Missing Android files: {missing}")

    reader = SAMSUNG_READER.read_text(encoding="utf-8")
    build = BUILD_FILE.read_text(encoding="utf-8")
    gitignore = GITIGNORE.read_text(encoding="utf-8")

    required_reader_tokens = [
        "Permission.of(DataTypes.EXERCISE, AccessType.READ)",
        "DataTypes.EXERCISE.readDataRequestBuilder",
        "sourceRecordId = point.uid",
    ]
    for token in required_reader_tokens:
        if token not in reader:
            raise ValueError(f"Samsung reader contract missing: {token}")

    forbidden_reader_tokens = [
        "AccessType.WRITE",
        "insertData(",
        "updateData(",
        "deleteData(",
    ]
    for token in forbidden_reader_tokens:
        if token in reader:
            raise ValueError(f"Read-only boundary violated by: {token}")

    if 'create("mock")' not in build or 'create("samsung")' not in build:
        raise ValueError("Both mock and samsung product flavors are required")

    if "app/libs/*.aar" not in gitignore:
        raise ValueError("Samsung SDK AAR must remain ignored")

    delivery = ROOT / "app/src/main/java/com/rpos/bridge/delivery"
    for name in ["BridgeProtocol.kt", "BridgeQueue.kt", "AndroidBridgeRuntime.kt",
                 "AppsScriptTransport.kt", "BoundedStreams.kt"]:
        if not (delivery / name).exists():
            raise ValueError(f"Missing delivery implementation: {name}")
    manifest = (ROOT / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
    if 'android.permission.INTERNET' not in manifest or 'android:usesCleartextTraffic="false"' not in manifest:
        raise ValueError("Delivery must use explicit network permission and TLS-only transport")
    runtime = (delivery / "AndroidBridgeRuntime.kt").read_text(encoding="utf-8")
    for token in ["noBackupFilesDir", "AtomicFile", "AndroidKeyStore", "AES/GCM/NoPadding"]:
        if token not in runtime:
            raise ValueError(f"Private persistence contract missing: {token}")
    transport = (delivery / "AppsScriptTransport.kt").read_text(encoding="utf-8")
    if 'instanceFollowRedirects = false' not in transport:
        raise ValueError("Implicit forwarding of signed requests is forbidden")
    if any(".readNBytes(" in p.read_text(encoding="utf-8") for p in delivery.glob("*.kt")):
        raise ValueError("Network/storage reads must work on the minimum supported Android API")

    print("PASS: Android acquisition contract is structurally valid")


if __name__ == "__main__":
    validate_android_contract()
