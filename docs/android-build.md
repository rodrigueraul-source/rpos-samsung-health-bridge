# Android acquisition layer v0.2

## Purpose

Recover the missing Android acquisition layer without replacing the existing Python normalization MVP.

## Flavors

- `mockDebug`: compiles without Samsung proprietary binaries and is used by CI to prove the Android project structure.
- `samsungDebug`: real acquisition flavor. Requires the official Samsung Health Data SDK AAR in `app/libs/`.

## SDK pin and Samsung build

The Samsung dependency is pinned to `samsung-health-data-api-1.1.0.aar`.
The official ZIP supplied in the R-POS Drive folder has SHA-256
`7a51440d840e099769b150c6414365bc43eecb61c01fa5bf6d0e54e09c2b663f`;
the AAR has SHA-256
`f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`.

The SDK archive/AAR stays out of source control. A successful build does not
prove permission or Exercise READ on a physical device. The Samsung web download
endpoint returned a non-ZIP response during CI; use the verified official archive
already supplied instead of accepting that response.

For a local build, extract that AAR to `app/libs/` and run:

```sh
gradle :app:assembleSamsungDebug :app:testSamsungDebugUnitTest
```

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
