# Reviewed historical swimming receipts

`BridgeHistoricalReview.gs.txt` is an owner-only operation for a single explicitly
reviewed historical swimming receipt. It reuses the accepted canonical delivery
coordinator; no endpoint or timer invokes it and no deployment update is needed.

Before invocation, independently establish the existing page's correspondence
using the owner report, original evidence, local start, active duration, distance
and heart rate. Preserve the previous properties and source identity in a
snapshot and alias. Attach exactly one complete SDK export at the page root,
then read back the canonical UID and every preserved metric. Do not resolve
calorie discrepancies by overwriting either source or inventing an explanation.

Pass one private `rpos.bridge.historical.selection.v1` manifest with receipt ID,
record hash, UID, target page, expected original cutoff, last-edited timestamp, reviewed aliases
and review basis to `rposBridgeFinalizeReviewedHistoricalReceipt(selection)`.
Do not commit the manifest, original data, access tokens or signing keys.

The operator requires the existing future-only pilot to remain ON, maximum
three new sessions, its cutoff unchanged, and migration OFF. It refuses workouts
on or after the cutoff, non-pool records, multiple segments, stale review,
duplicate identity or a different full export. It creates no page and changes no
metric, date, feedback, automatic journal, pilot configuration or trigger.
Existing source aliases are retained in the canonical evidence. A partial write
remains unresolved; response-loss recovery and replay never append twice.

After the report and independent Notion readback both confirm the receipt,
update the phone without uninstalling or clearing data. Long-press **CHECK
PENDING RECEIPTS**, choose **Reviewed: recheck**, then use ordinary CHECK/polling
to read the signed acknowledgements. This only releases reviewed local blocked
states for an identity-only query when the record hash is already known. It does
not make a receipt confirmed by itself. Never use QUEUE to resend this historical
data, clear journals, move the cutoff, or count an assisted recovery as one of
the three new automatic acceptance cycles. Discarding an unusable record means
excluding it from import while preserving the original; it never means forcing
an ACK or erasing a workout.
