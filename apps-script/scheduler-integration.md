# Scheduler integration: staged installation and explicit cutover

## Current recovery checkpoint — 05-Oct-2026 evening

Owner screenshots show only `Código.gs`; exact search for the Bridge scheduler
declaration returned zero matches. This conflicts with earlier installation
reports. Do not treat historical runtime hashes/preflight logs as evidence of
the current live project. Cause of the discrepancy is not established.

The owner restored and confirmed saving this **temporary legacy route**:

```javascript
function createGymCapturePage_(cfg, event, plan, now) {
  return rposBridgeLegacyCreateGymCapturePage_(cfg, event, plan, now);
}
```

Keep the complete original function under its existing renamed declaration
`rposBridgeLegacyCreateGymCapturePage_`. No replacement of its body is needed.
The screenshot validates the wrapper only; it does not validate live Notion
access, execution success or the absence of other project defects.

## Install runtime while retaining the temporary legacy route

1. Take a fresh private project backup and inspect all existing files first.
2. Add the generated `BridgeRuntime.gs.txt` content as one `BridgeRuntime.gs`
   file, only if none of its functions already exist in the project. Do not also
   install the individual modules: that would duplicate global declarations.
3. Save, read back and compare the installed file with the tested bundle.
4. Run `rposBridgePreflight`. This operator is checked into Git and bundled.
   It only reads local configuration and checks global function existence.
   It never calls Drive, Notion, scheduler, delivery, migration or triggers;
   it logs booleans/classified flag states, never keys, IDs or error messages.
   A local pass is **not** approval for activation or proof of live connectivity.
5. Inspect Drive privacy/access, current Fitness schema, historical receipts,
   exact aliases and single-writer ownership separately before cutover.

Build/check the bundle with `node scripts/build_apps_script_bundle.cjs` and
`node scripts/build_apps_script_bundle.cjs --check`. CI checks reproducibility.

Do not change flags simply to obtain a passing diagnostic. An enabled or
malformed flag is a review result and must be reconciled before continuing.

## Later cutover — only after the live review

The protected Bridge function returns `bridge_scheduler_not_configured` when
`BRIDGE_SCHEDULER_BINDING_REVIEWED` is off. Installing the Bridge wrapper while
that flag remains off stops capture creation. Keep the temporary legacy route
until the cutover is fully prepared and perform the wrapper/flag switch in a
reviewed maintenance window with no capture execution in flight. If a Bridge
write may already have happened, reconcile its journal before any rollback;
never automatically fall back to the legacy writer after a Bridge error.

Reviewed source: owner-confirmed `R-POS External Scheduler F V0_3.txt`, 05-Oct-2026.
Compare the live editor before applying. This file changes no live source,
trigger, deployment, credentials or Fitness data.

Keep the capture payload and all callers. If the original function has not
already been renamed, rename only its declaration to
`rposBridgeLegacyCreateGymCapturePage_`; retain its entire body. Never paste
an empty placeholder body in place of working scheduler code.

Add this wrapper once; do not leave another declaration with the original name:

```javascript
function createGymCapturePage_(cfg, event, plan, now) {
  return rposBridgeCreateGymCapture_(cfg, event, plan, now,
    rposBridgeLegacyCreateGymCapturePage_);
}
```

Use the single generated bundle described above. The wrapper uses existing cfg.notionToken,
RPOS.fitnessDataSourceId and Script Lock. It reads the full source/ID result AND
exact archived Notes alias, then reuses one active page. Different matching
pages stop as conflict. Python v1 alias tokens are compatible, including
Unicode escaping. Historical aliases archived only as prose need explicit
review/token migration; date or title alone never identifies a target.
`BridgeMigration.gs` now prepares that explicit reviewed conversion; audit,
review, journal/readback and partial-write rules are in `README.md`. It is not
invoked by an HTTP client or the scheduler. No live migration has been applied.

New capture creation remains owned by the original scheduler. The wrapper
journals intent before invoking it. An interrupted creation cannot silently
create another page on restart. Unique matching-page readback can repair the
journal. Empty lookup after an attempt stays unresolved. Do not clear intents
to make retries work. No additional notifications or triggers are installed.

All capture callers must use this wrapper and not already hold Script Lock.
The reviewed Gym capture callers do not hold it; the separate AM cycle does.
Do not call this wrapper inside the AM lock. Notion has no cross-request
transaction: external writers/manual edits may race after the final read.
One delivery writer plus this same-project wrapper is required. Do not run
Python delivery against the same transferred UID simultaneously.

Leave `BRIDGE_SCHEDULER_BINDING_REVIEWED` off until the binding and historical
alias/token migration have been reviewed. Both wrapper and delivery fail closed
without this guard. Never enable it merely because synthetic tests pass.

Before applying live: compare source; retain private backup; check Fitness
schema and exact aliases on linked pages; review credentials/folder/access;
then perform the agreed existing-session handoff and lost-response UAT.
This preparation does not close BR03 or increase Registry BUILD 35%.
