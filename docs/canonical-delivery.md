# Finalize one signed receipt against its complete reviewed SDK record

A new signed receipt used to need a separate hardcoded target/review script.
`rposBridgeFinalizeCanonicalReceipt` replaces that per-session setup for an
existing canonical Samsung session whose complete SDK record has already been
supplied and reviewed. It uses the existing intake store, delivery coordinator,
Notion port and durable property journal. Its native HTTP/journal adapters are
self-contained, so optional legacy adapters cannot block this operation. Core
runtime functions are checked before private configuration or remote calls.
It does not publish a web deployment or enable continuous delivery.

## One owner operation

1. In the installed delivery app, queue the selected real SDK session and use
   **SYNC ONE**. Its intake receipt must be staged in the private Drive folder.
   The already confirmed previous receipt remains confirmed.
2. If pending-queue survival across an OS restart still lacks evidence, restart
   with this new item pending; reopen and capture its state before CHECK.
3. In the existing Apps Script project, add one separate script file named
   **BridgeCanonicalDelivery**. Paste the complete
   [BridgeCanonicalDelivery.gs](../apps-script/BridgeCanonicalDelivery.gs), save
   and run **rposBridgeFinalizeCanonicalReceipt** once. Leave the existing
   runtime, endpoint deployment, Script Properties and triggers as configured.
4. After the normal retry becomes due, use **CHECK PENDING RECEIPTS** and save
   the Apps Script JSON and final phone state. This checks the new receipt;
   another receipt's confirmation does not prove delivery of this UID.

Expected first-run output: `status: confirmed`, `notion_confirmed: true`,
`response_loss_recovered: true`, `replay_without_remote_writes: true`,
`remote_write_calls: 1`, `activation_flags_unchanged: true`,
`continuous_delivery_enabled: false`, `migration_enabled: false`.
`remote_write_calls` counts one coordinator write, containing two native PATCH
requests (unchanged canonical identity and one managed evidence append).

## Exact scope

- Intake and reviewed scheduler binding must be ON, continuous delivery and
  migration OFF. Those flags are rechecked before each remote PATCH and are
  never changed by this operator. A Script Lock serializes the operation.
- At most 100 native intake intents are considered; only one eligible receipt
  is finalized per run. Existing confirmed delivery journals are skipped.
- A receipt must have exactly one validated stored export and its matching
  staged intake intent. Its exact source/UID must identify exactly one existing
  canonical session. Titles, dates and routines never establish ownership.
- For a first delivery, exactly one root JSON code block must contain a valid
  `rpos.exercise.export.v1` export whose complete canonical **record** equals the
  signed stored record. Read timestamps/counts may differ between SDK reads.
- Review binds the record hash, page, edit snapshot and canonical identity.
  No page, scheduler alias or migration is created. Date, Notes, metrics,
  subjective feedback and the existing body remain untouched. One v2 evidence
  code block is appended; the original owner-supplied SDK block is retained.
- After an actual successful remote write, its acknowledgement is deliberately
  discarded before journal confirmation. A fresh coordinator invocation must
  recover from full remote evidence without another write. A third invocation
  verifies replay without writes. This is controlled response loss after a
  write, not proof of a natural outage. Confirming it in production requires the
  owner's real signed receipt and the actual execution report.
- An earlier attempting journal is recovered by reads only. If remote evidence
  is incomplete, `unresolved` stays unresolved; the operator never clears an
  intent to permit a blind retry. Duplicate UID/evidence conflicts stop writes.
- `no_matching_signed_receipt` means no eligible receipt was selected. Inspect
  signed ingress, canonical UID and the complete SDK block before another run.
  Do not clear journals or create a second session to force a match.

This completes a bounded real-session handoff when executed. Foreground SDK
selection/upload and reviewed destination reconciliation remain required for
other new UIDs; unattended acquisition and continuous delivery are separate
operational work. The timer refresh remains backlog. Synthetic tests and code
publication do not close device acceptance milestones.
