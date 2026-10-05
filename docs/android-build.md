# Android acquisition layer v0.2

## Purpose

Recover the missing Android acquisition layer without replacing the existing Python normalization MVP.

## Flavors

- `mockDebug`: compiles without Samsung proprietary binaries and is used by CI to prove the Android project structure.
- `samsungDebug`: real acquisition flavor. Requires the official Samsung Health Data SDK AAR in `app/libs/`.

## Current minimal read contract

The Samsung flavor requests only:

`Permission.of(DataTypes.EXERCISE, AccessType.READ)`

It builds a `DataTypes.EXERCISE` read request with a local-time window and retains these fields from each returned point:

- Samsung `uid`
- `startTime`
- `endTime`
- `zoneOffset`
- source app/device IDs when available
- exercise type

Duration/calories/distance remain intentionally null in v0.2 until the first real read proves the base contract. This prevents widening the mapping before UID provenance is validated.

## Boundary

No Samsung Health real data or SDK AAR is committed to Git.
