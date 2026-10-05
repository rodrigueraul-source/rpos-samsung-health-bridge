# Delivery runtime boundary

The approved lane is Samsung Health Bridge → existing R-POS evidence path →
Fitness Sessions → Core Fitness / Decision Engine / Coach. Fitness scheduling
remains owned by the existing Apps Script/IFTTT setup.

The v0.4 Android app exports a selected record to the clipboard on user action.
It has no server endpoint, background upload, Notion token or automatic handoff.
The Python `DeliveryWorker` coordinates authenticated writes through `NotionPort`.
`NotionRestPort` and the host CLI now provide a tested REST implementation for
reviewed existing Fitness targets. Neither is an installed unattended service.
See `notion-transport.md` for credential/receipt/reconciliation boundaries.

Before binding/deploying the worker, establish the approved runner's current
executable source, credential ownership, Android handoff, receipt persistence
and serialization boundary. A read-only scheduler PDF snapshot is useful for
review but cannot establish the current deployed source or a Bridge endpoint.
Do not add a second scheduler, notification stream or Fitness database.

Acceptance for the adapter is fully paginated exact UID lookup, explicit
manual-evidence reconciliation by source window/sequence, preservation of
aliases/metrics, source/hash readback and recovery of an actual uncertain write.
For `unresolved` writes, inspect the original remote request; never clear the
receipt and blindly repeat a create. A manual/Drive fallback remains valid.

Initial acquisition, two actual UID assisted deliveries/replays and denied
consent/restoration follow-up are accepted private checkpoints. Synthetic
coordinator/REST tests validate failure behavior under injected conditions.
Other Samsung errors, actual transport outage recovery and unattended delivery
remain separate gates before full Bridge PASS.
