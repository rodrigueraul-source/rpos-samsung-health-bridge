# Samsung Health Bridge — Device UAT gate

This is the first point where Raul must intervene physically.

## Preconditions

1. Use a physical Android 10+ phone with Samsung Health 6.30.2+ installed and initialized; emulators are unsupported.
2. For a source build, place the verified official SDK 1.1.0 AAR in `app/libs/`; the supplied APK already includes the SDK.
3. Install the `samsungDebug` APK (package `com.rpos.bridge`, not `com.rpos.bridge.mock`).
4. For this development test, open Samsung Health > Settings > About Samsung Health. Tap the version line at least ten times, open **Developer mode (Samsung Health Data SDK)**, acknowledge the test notice and enable **Developer Mode for Data Read**.
5. Launch **R-POS Samsung Health Bridge**.
6. Ensure Samsung Health has at least one Exercise record within the last 30 days.

Official prerequisites and developer test steps:
https://developer.samsung.com/health/data/overview.html
https://developer.samsung.com/health/data/guide/developer-mode.html

## UAT

1. Tap **READ EXERCISE**.
2. Grant **Exercise READ** when Samsung Health requests consent.
3. The app must return at least one real Exercise record.
4. Capture the screen showing:
   - `READ PASS`
   - record count
   - original Samsung `UID`
   - exercise type
   - start time

## PASS evidence

Device UAT passes only when:

- the app itself reads a real Samsung Health Exercise record;
- the original Samsung-assigned `uid` is visible and retained;
- no generic R-POS `record_id` is substituted for that UID;
- the same UID can later be mapped to Notion `Source Record ID`.

A DataViewer screenshot, exported file, synthetic fixture, or mock flavor does **not** close this gate.

## v0.4: another real UID and consent recovery

**Checkpoint 05-Oct-2026:** the second real UID/export and assisted remote
delivery/replay are complete. Denied Exercise READ was evidenced with COPY and
selection disabled; restoration was accepted from the user's requested PASS
follow-up (same PASS image, no independently timestamped fresh-read trace).
The batch below is retained as the test procedure, not a repeat request.
Next immediate owner is AI for runtime/transport preparation; other Samsung
error cases remain open until a concrete test is prepared.

The initial own-app read and same-UID activity-reopen checkpoints are complete.
Use the Samsung v0.4 APK for the next gate:

1. Install v0.4 as an update over v0.3. The retained development certificate is
   reused; normal updates should not need uninstall/reconfiguration.
2. Tap **READ EXERCISE**. In the record dropdown, choose a different workout
   from the previously reconciled one. Date/title/type and a UID suffix identify
   rows; the selected full original UID appears above the picker.
3. Tap **COPY SELECTED JSON**, then paste that JSON into the private project
   chat. The export contains only the selected record, with the count/read time
   of this fresh batch. No additional success screenshot or repeated same-UID
   activity-reopen test is needed.
4. In the same device-test window, revoke the Bridge's Exercise READ access in
   Samsung Health, tap READ, and decline its request. The result must be READ
   FAIL, with COPY and selection disabled. Capture only that failure screen.
5. Tap READ again and grant Exercise READ. Confirm READ PASS, reselect the
   intended workout and copy its JSON. Send the final JSON plus the denied-read
   screen together; no need to send two exports of the same selected record.

If Samsung Health provides different permission-management controls, report
the visible options rather than uninstalling Samsung Health or deleting data.
Missing/outdated/disabled Samsung Health error paths remain separate open UAT;
this batch only covers denied/revoked consent and restoration.

The app sends nothing to Notion or a server. AI reconciles the new UID against
existing source windows/segment sequences before any live Fitness write.
Ambiguous matches remain pending; existing metrics/manual aliases are preserved.

The export retains the parent Samsung UID/time/source/device metadata and
per-session exercise type, start/end, reported duration (milliseconds), calories
(kcal), distance (meters) and heart-rate summaries (bpm). Unknown values remain
null. Parent totals are not inferred from elapsed time or sums of sub-sessions.
This is a reconciliation export, not every SDK field: routes, detailed logs,
comments and other sport-specific properties are outside this version.

The initial activity-reopen proof does not establish an OS reboot or measured
process termination. Delivery-worker fault-injection tests use synthetic data;
authenticated unattended transport and real cross-system timeout/crash tests
remain open.

## v0.5 separate-package handoff · 06-Oct-2026

The old APK certificate was recovered from the retained v0.4 APK, but its
private key was not found. Preparing `com.rpos.bridge.delivery` avoids replacing
or uninstalling that installation. Install the signed **R-POS Bridge Envío**
APK alongside the old app; preserve the old app and its private queue.
The new package needs fresh Exercise READ consent and private endpoint/key
configuration. Existing Samsung Developer Mode need not be toggled again if
already enabled. Collect one batch covering the new-package READ, durable queue,
authenticated delivery, activity/process restart and uncertain-result recovery
against the existing canonical Fitness row. Do not repeat accepted v0.4 gates
or claim this batch complete before actual device evidence.

The published endpoint currently returns `disabled`. Queueing while OFF must
preserve the export and show a blocked receipt, not Notion success. Do not
perform a real send until the reviewed backend cutover has been recorded.
