# Samsung delivery APK evidence — 06-Oct-2026

The owner approved the Android SDK license at 09:47 America/Mexico_City.
The required android-sdk-license was accepted; platform 36, build-tools
36.0.0 and platform-tools installed. The initial runtime had Java without
javac. A matching Ubuntu OpenJDK 17.0.20 JDK was recovered from the configured
Ubuntu snapshot package source and assembled locally with the same-version JRE.
No project dependency versions were downgraded.

## Source/build boundary

A `delivery` flavor reuses the existing Samsung provider and SDK AAR and adds
only a separate application ID and app label. The original `samsung` and mock
flavors remain available. Local Gradle 8.13, AGP 8.13.2, Kotlin 2.3.20,
JDK 17.0.20, compile/target SDK 36 and minimum SDK 29 were used. An environment
init script limited the Google repository to Android groups; Kotlin/JUnit were
resolved from publisher Maven Central. It changes repository routing only, not
source or dependency coordinates.

`assembleSamsungRelease`, `assembleDeliveryRelease` and
`testDeliveryReleaseUnitTest`: **BUILD SUCCESSFUL**, 1m44s.
The 29 actual Android Gradle unit cases passed with zero failures/errors/skips.
Release lint-vital tasks passed for both real flavors. This compiles
MainActivity, AndroidBridgeRuntime and the real Samsung provider; it is separate
from the earlier host-only JVM tests and mock CI.

SDK AAR SHA256: `f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`.

## Signed artifact

- File: `RPOS-Samsung-Health-Bridge-Delivery-v0.5.0.apk`
- Package: `com.rpos.bridge.delivery`
- Label: **R-POS Bridge Envío**
- Version code/name: **5 / 0.5.0-delivery**
- Size: **3884826 bytes**
- APK SHA256: `0c93f37deaa7f953fd8e65f6b1a1007faa1ae88cdcc5d970885f6d9e4f1ee6af`
- Certificate SHA256: `765e88966e33c23baec6def8445015623154d04f550c1d8592ae4506d7fa24a3`
- RSA 4096, dedicated PKCS12 key, APK signature v3 verification PASS
- 16 KiB zip alignment check PASS; non-debuggable release
- Merged manifest has INTERNET and TLS-only transport; backup disabled
- Compiled provider is Samsung with source samsung_health; SDK classes present
- No deployment ID or private signing password embedded

The private signing key/password/certificate recovery package is retained
privately outside Git. It is a dedicated app-signing key, not the HMAC, Notion
token or Google password. The old v0.4 APK public certificate SHA256 is
`f23af18e8802e5c19aa80ccc2b6ff65e1d92876b33d3a576f74c6daba4fa409c`.
The original private key was not found in reviewed workspace/tmp/Android/Gradle
locations or signing filename searches. The new package coexists with the old
app. No old app uninstall, data clearing, private queue extraction or migration
was performed. Future delivery-package updates must retain the new key.

## Live backend checkpoint and remaining gates

Web app version 1 was published at 09:40 with explicit owner approval at 09:33:
execute as owner, anonymous access, endpoint initially OFF. External empty POST
returned HTTP200/application-json/receipt.v1/status disabled/retryable false.
Four activation flags OFF were directly verified at 09:38; scheduler legacy.
Owner readiness audit 09:22 passed: two receipts, two confirmed migration
journals, fourteen aliases; no delivery/scheduler journals. The complete live
bundle bytes remain unverified; clipboard export returned only one line.

Read-only live trigger inventory at the current checkpoint: six existing
owner time triggers, four Fitness and two Mental Drop, all show 0% errors.
No Bridge delivery trigger or new trigger was added. Drive receipt-folder
metadata lists owner-only access and shared=false, with the personal Drive
root as its parent; no explicit group/domain/anyone permission returned. This
is metadata evidence, not a complete independent effective-access attestation.
Writers outside this Apps Script project remain unverified.

The APK is not installed or physically tested. New-package consent/private
configuration, reviewed backend activation/scheduler binding, signed delivery,
Android Keystore/queue restart and actual uncertain-result recovery remain
open. Accepted v0.4 acquisition checkpoints remain valid and are not repeated.
Neither release automatically reads or uploads in the background. BUILD35
remains the approved Registry baseline; this build does not establish Bridge
PASS, BR05/BR06 closure or an 80% completion claim.
