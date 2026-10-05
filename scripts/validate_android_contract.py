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

    print("PASS: Android acquisition contract is structurally valid")


if __name__ == "__main__":
    validate_android_contract()
