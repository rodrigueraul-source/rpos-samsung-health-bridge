# Android acquisition layer v0.2

## Purpose

Recover the missing Android acquisition layer without replacing the existing Python normalization MVP.

## Flavors

- `mockDebug`: compiles without Samsung proprietary binaries and is used by CI to prove the Android project structure.
- `samsungDebug` / `samsungRelease`: original real acquisition package `com.rpos.bridge`. Requires the official Samsung Health Data SDK AAR in `app/libs/` and the original private certificate for an in-place update.
- `deliveryRelease`: real Samsung acquisition plus the same delivery implementation, package `com.rpos.bridge.delivery`, label **R-POS Bridge Envío**. Shares the Samsung provider/AAR; it coexists with the original app when its private signing key is unavailable. It has independent consent, Android Keystore, queue and configuration. It does not import or remove the original app data.

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
gradle :app:assembleSamsungRelease :app:assembleDeliveryRelease :app:testDeliveryReleaseUnitTest
```

Release outputs are unsigned by Gradle. Align and sign the delivery APK with the
dedicated retained private key using Android build-tools; verify the resulting
certificate and application ID before installation. Keep signing material and
its recovery password outside Git, APKs, logs and chat. An APK includes only the
public certificate, which cannot recover its lost private key.

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
