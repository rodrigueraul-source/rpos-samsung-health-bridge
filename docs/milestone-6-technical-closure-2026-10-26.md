# Milestone 6 · GAS and Android certification · 26-Oct-2026

**Technical HOLD / NO-GO · 5/6 · 83.33%.** Limited operational PASS is retained.
BR07 is **CLOSED / PASS WITH EXCEPTIONS** under the owner's explicit acceptance:
physical READ51 and error3000/recovery PASS;3001–3003 were not physically tested.
Their residual risk is accepted. This audit does not reopen BR07 or modify a device.

## New executed Android evidence

An independent unsigned delivery-release build of candidate commit
`b7b6dc1ce98915ac94e275dee4abb0d2b7425860` completed successfully. All36
Android/Gradle/test source blobs were retrieved and checked against Git hashes.
The build used the original private SDK1.1.0 AAR with accepted SHA-256
`f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`.
Gradle8.13 matched its official SHA-256. JDK17.0.20 was recovered from a
GPG-verified Ubuntu repository snapshot and its signed package index. Android
platform36rev2 and build-tools36.0.0 matched Google's repository checksums.
AGP8.13.2, Kotlin2.3.20, coroutines1.10.2 and Gson2.13.2 were retained.
Tools, caches and source copies were isolated from production. Repository source
was not changed to produce the build; standard dependency routing was configured
only in the isolated launcher.

`:app:assembleDeliveryRelease :app:testDeliveryReleaseUnitTest` completed in
2m47s: **71 tests, zero failures/errors/skips**, release lint-vital PASS.
No signing key was accessed and no APK was signed, installed or distributed.

| Artifact | SHA-256 |
| --- | --- |
| Accepted signed distribution | e4e8a4b470eb9b23c41cbd18f06cd1e78e5113ee9065722ffaf5e91ca72607d5 |
| Independent unsigned build | ece7d0e093ebb15c2e4a8ca082b2e8b30d396837af980fb84c7607bee9e681dc |
| Full classes.dex, both copies | 67aeaed8b66b32813acc612a9a3f8d7ae41771fd737e08fdb4d26020b3baf7e4 |

Eighteen of19 common ZIP entries are **byte-identical**, including the complete
DEX, binary AndroidManifest.xml, resources.arsc and every resource. Only
META-INF/version-control-info.textproto differs: original NO_VALID_GIT_FOUND,
rebuild NO_SUPPORTED_VCS_FOUND. The original additionally contains three signing
metadata entries and its APK signature block. The different whole-APK hashes
are not presented as binary identity. Official Android apksigner36 verifies the
original v3 signature with one signer and the previously approved certificate
SHA-256 `765e88966e33c23baec6def8445015623154d04f550c1d8592ae4506d7fa24a3`.

**Technical payload correspondence: PASS. Historical build provenance: HOLD.**
The contemporaneous PR8 records the exact distributed hash, candidate head and
71 Samsung tests; merge72ad54f3 is GitHub-verified. Original distribution creation
followed that merge on15-Oct. This is a release declaration, not an independently
retained original checkout/build log. Full payload reproduction does not identify
which historical checkout produced those bytes. The verified original build
commit remains null. No provenance exception was approved by this audit.

Historical GitHub job116548516478 checked out temporary PR merge2114ea9 and
compiled mockDebug only. Its log proves that mock artifact11991143213 was
uploaded with seven-day retention. An empty artifact list on26-Oct does not
mean no artifact was ever created. Mock CI is not the signed delivery build.

Machine-readable evidence: [independent rebuild](independent-rebuild-proof-2026-10-26.json)
and [release provenance](release-provenance-0.8.3-2026-10-26.json).

## New executed GAS source evidence

The official authenticated Google Drive source export recovered the live
unversioned project: **19 complete file contents** were fingerprinted. Source
values from unrelated private modules are not published. Google Drive confirms
the existing project metadata; its revisions API reports revisionsNotSupported.
This export is current source, **not an immutable deployment-v9 snapshot**.

| Live HEAD source | Bytes | Result |
| --- | --- | --- |
| BridgeAutomaticRuntime | 72658 | Exact UTF-8 hash feeb0e2ad9780e681f3ffa9d337190ee00c05764481b54ce14db4093724ee4f3, identical to approved PR7 |
| BridgeRuntime | 67671 | Six approved core modules, distinct from the full eight-module repository template |

The installed partial runtime contains Intake, Endpoint, Notion, Scheduler,
Migration and Diagnostics. Each module's generated source matches PR7.
Regeneration of this six-module composition differs only by one extra LF at
character offset26016 between Endpoint and Notion. Removing exactly that blank
line gives equal text. This is **normalized text equality**, not byte identity
of the files. The isolated automatic addon supplies its own approved delivery
modules. AST inspection of12 Bridge files finds one top-level doPost in
BridgeRuntime, one worker entry in BridgeAutomaticRuntime, and no duplicate
top-level function declarations; declarations inside its IIFE remain lexical.
No source function was invoked.

HEAD BridgeRuntime SHA-256:
`f8b3fa39f2f4d0c46fc9a92493d5bd5df7e7bc61c945d86f6aff545dd1ed58bb`.
The full PR7 template hash308f3f55 is a different composition and must not be
used to declare the partial installed runtime corrupt or identical.

[HEAD source evidence](head-source-proof-2026-10-26.json) complements the
[approved PR7 baseline](gas-release-reference-pr7-2026-10-26.json), commit
`41a67b3a0751b014df0f741c77fc75140424437c`. Version9 identity remains previously
accepted. Full official v9 content and authenticated deployment metadata remain
unavailable: the cloud browser requires human verification and the owner's
shared-control view repeatedly expires. Connected Drive export cannot certify
GAS versions. No redeploy or alternate browser/network route was used.

## Remaining gate

Two evidence controls remain: official immutable v9 content/deployment binding;
and historical Android build-origin provenance or a separately approved owner
exception after review of the reproduced payload. Neither a waiver nor the
current HEAD fingerprint substitutes for v9. Any6/6 proposal requires those
controls and the owner's final approval. BR07 stays closed.

Current continuous flags/journals/triggers were not newly read. The accepted
05:42CDMX operational cut remains historical; its13confirmed/0attempting/0future
pending counts are not relabeled current. No active production incident was
established and no production action was taken. Preserve migrationOFF, cutoff,
endpoint, triggers, receipts, Fitness and all unrelated components.
