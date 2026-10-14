# Receipt recovery and foreground polling

The Android queue previously posted the stored workout again for every due
`staged` entry. Its countdown was a static rendering: no lifecycle job refreshed
the summary or checked acknowledgements. An intake receipt is not evidence of
canonical Notion confirmation.

This change polls the existing signed acknowledgement endpoint for a known
receipt/hash. It persists and verifies the attempt before network access,
retains the original payload, and confirms only an acknowledgement with the
same receipt/hash and a valid confirmation flag. A missing canonical journal
stays pending; conflicts, authorization errors and incompatible deployments
require review. Confirmed or blocked entries are not automatically queried.

The foreground job refreshes the display every five seconds. Receipt network
checks honor persisted exponential backoff (up to fifteen minutes) and a
maximum of three requests per polling pass. The job stops when the Activity
stops; it starts no background acquisition, workout uploads or boot service.
Explicit manual sync retains intake for new/unknown-hash entries and counts
acknowledgements against its total request limit.

No Apps Script source, deployment, delivery/migration flag, permission,
Notion schema or repository visibility is changed. Assisted Fitness rows
without the backend canonical journal/evidence cannot be marked confirmed.

## Release boundary

The initial PR targeted the 0.6.0 Android development branch. The 0.7.1
release now restores the installed 0.7.0 R-POS hardening from the verified
owner APK and preserves its established signing identity. The original Git
commit/Kotlin text was not recovered; this is a documented source recovery,
not a claim to reproduce that missing commit. Physical acceptance remains
pending; see `release-v0.7.1.md`.

Unit tests use synthetic receipts and exercise identity-only polling,
three-entry draining, lost local confirmation, restart/backoff, unresolved
results, conflicts, permanent errors, and request limits. They are not real
E2E evidence. Bridge remains BUILD until three consecutive authorized real
cycles have source, durable backend confirmation, Android acknowledgement and
Notion readback, without manual data correction.
