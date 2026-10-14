# Samsung Health Bridge 0.7.1

The current release repairs receipt-only retries and the foreground status refresh while retaining Samsung hardening observed in the owner's signed 0.7.0 APK. It updates `com.rpos.bridge.delivery` in place with versionCode8 and the existing certificate. Never uninstall, clear app data, rotate the key or substitute a signing certificate for this test.

## Provenance

- Original0.7.0 APK SHA256: `1d927b50bd3bf09ee646b3e5ec937173f49a7d57170efcc21de6e8f20eade616`.
- The original Git commit `2cdc7f065a38202e5e076f660c1c7d90c54a7d00` and Kotlin text were not found in the repository or retained backups. Only R-POS-owned APK classes were inspected; no Samsung SDK implementation was decompiled.
- Recovered behavior: SDK errors3000–3003, unknown-error fallback, `exercise_read_permission_denied`, deferred `hasResolution` action and `Open setup` UI. The code/messages and six persisted model/configuration/queue class fields were compared with the original APK.
- Original Samsung AAR1.1.0 SHA256: `f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`. Keep it and all signing material out of Git.
- Certificate SHA256: `765e88966e33c23baec6def8445015623154d04f550c1d8592ae4506d7fa24a3`.

## Validation and boundary

Real Samsung delivery build/release lint and57 Android unit cases passed;49 mock,46 Python and209 Apps Script cases passed. These are technical tests. The APK is not yet installed, and acceptance is0/3 device E2E cycles. No backend runtime, activation flag, unattended acquisition, schema or visibility is changed by this release.

## Fast physical acceptance

The contract calls for three consecutive real cycles, not three calendar days. Use one device window and three different real Samsung Exercise UIDs after checking their existing Notion/journal identities. Existing workouts can be used; future/synthetic records or three replays of one receipt cannot replace three complete cycles. A replay still belongs in each cycle's deduplication proof.

1. Install the APK over the existing delivery app; confirm0.7.1-delivery and that queue/configuration remain. Read actual Samsung Exercise data.
2. Cycle1: capture one real UID, signed intake receipt/hash, durable backend confirmation, matching Android acknowledgement and independent unique-UID Notion readback. Backend delivery must use the existing reviewed bounded operator/path; do not manually repair row data to make the cycle pass.
3. Cycle2: repeat with another UID and a controlled connection/process interruption, preserving the export and backoff. Reopen/recover the same receipt; confirm a single canonical row and matching acknowledgement.
4. Cycle3: repeat with a third UID and verify replay without additional remote writes. Retain each cycle's provenance and readback. An unresolved cycle does not count; resolve its cause and restart the consecutive-success sequence.

`TEST RECEIPT RECOVERY` is a separate read-only probe of an already confirmed receipt; it does not itself count as a new full E2E cycle. The existing recovered10/0 queue checkpoint is historical and should not be re-finalized just for this release.

After device acceptance and all remaining release/Samsung gates, recheck the existing backend binding, source/alias conflicts, intents, journals, bounded reviewed migration plan and scheduler wrapper before enabling the user-authorized delivery/migration gates. Preserve all original records. Foreground receipt polling is not unattended acquisition of new Samsung workouts.
