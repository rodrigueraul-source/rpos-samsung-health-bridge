# Read-only review of a hidden v0.6 recovery retry

When `recovery: pending` survives a due CHECK without `response discarded`, the
backoff alone does not reveal whether the request failed in transport or the
server returned busy, storage_unresolved or delivery_error. Do not repeat phone
setup, READ, TEST, cutover, property resets or deployment updates from that
symptom. The earlier public negative-authentication probe establishes only the
availability of the new query contract, not positive authentication/readback.

`apps-script/BridgeRecoveryReview.gs.txt` is a separate owner-run review. It is
deliberately excluded from the seven-module HTTP bundle, so adding it does not
replace `doPost` or require another deployment version. A private handoff adds
one zero-argument `rposBridgeReviewRecovery` wrapper with the approved existing
/exec URL. No signing key or receipt ID is hardcoded in the source/handoff.

## One owner block

1. In the existing Apps Script project, replace the existing review Script file
   with the full prepared handoff and save. The owner's file may be named
   `BridgeReviewRecovery`; that name is valid. Add `BridgeRecoveryReview` only if
   no review file exists; do not create a second copy or rename an existing file.
2. Select **rposBridgeReviewRecovery** and execute it once. Send the execution
   log JSON. It reports no secrets or health measurements.
3. Keep the existing app, checkpoint, configuration, deployment URL and flags.
   The next fix depends on that report; another phone retry is not needed first.

If that script file already exists, replace only that diagnostic file; do not
create duplicate functions. Do not run the all-flags-OFF readiness audit: the
accepted pilot intentionally has intake/binding ON and delivery/migration OFF.
Do not manually execute `doPost` or the intake activation operator.

## What the review checks

- URL has the existing HTTPS Apps Script /exec shape before credentials are read.
- Intake/binding are exactly ON, delivery/migration exactly OFF; credentials are
  present/formatted and the configured Fitness source matches the scheduler.
  Revision 2 compares IDs independently of the runtime helper, then checks the
  required runtime functions and helper separately, without network or mutations.
- At most 100 delivery journals are inspected; exactly one confirmed, internally
  consistent receipt must exist. Missing/ambiguous/malformed selection stops.
- The same read-only acknowledgement core reads its unique Drive receipt,
  intake intent, canonical Notion UID/evidence and any required migration journal.
  Its injected Notion port can only GET or POST the configured data-source query.
  Local requests record phase, HTTP status and elapsed milliseconds, capped at
  100 requests with a 60-second soft limit between calls.
- One fresh HMAC request contains only schema, timestamp, receipt ID, record hash
  and signature. It contains no Exercise export. At most one approved ContentService
  redirect is fetched with GET, without forwarding the signed body or credentials.
- Response size/schema, confirmation boolean and identity consistency are checked.
  Raw responses, exception messages, tokens, health data and opaque IDs are omitted.
- All Script Properties are compared before/after. A change during local checks
  stops before the deployed query; any later change invalidates the overall review.

## Reading the result

Revision 1 collapsed missing/throwing UUID helpers and different sources into
`source_matches_scheduler: false`. That flag alone cannot establish a live
configuration mismatch. Revision 2 adds only safe booleans and reason codes:

- `source_check.status: matched` accepts equal valid compact/hyphenated IDs,
  ignoring case. A `runtime_incomplete` result identifies missing functions;
  `runtime_uuid_requires_review` identifies an error/incompatible UUID helper.
- `configured_source_invalid`, `scheduler_source_missing`,
  `scheduler_source_invalid` or `source_mismatch` identify the configuration
  reason. Values and exception messages are never printed. Do not change
  properties or reinstall the runtime from the old false flag alone.

`server_reads_confirmed_android_recovery_not_checked` means both server paths
reported confirmation with unchanged properties. It is not a phone, OS/process,
natural-outage or uncertain-write PASS. Use the deployed elapsed time to assess
the existing Android transport's 30-second read timeout; a long server duration
is an observation, not proof of the phone's hidden exception.

`server_review_required` preserves the separate local/deployed statuses. A local
HTTP 429, 401/403 or 5xx identifies the observed response at that phase; it does
not by itself identify the phone's earlier error. Compare local/deployed results
before deciding whether to change server reads, transport or configuration.

`review_error_details_suppressed` retains the last safe stage and any completed
results. `one_confirmed_receipt_required` refuses to guess a different receipt.
Concurrent change or mismatched identity never counts as confirmation.

The owner log is private operational evidence. Keep it in R-POS, not GitHub.
BUILD progress stays at four of six verified integration milestones until the
next full acceptance gate is satisfied.
