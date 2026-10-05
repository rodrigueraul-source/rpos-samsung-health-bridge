# Reviewed scheduler binding (prepared; not installed)

Reviewed source: owner-confirmed `R-POS External Scheduler F V0_3.txt`, 05-Oct-2026.
Compare the live editor before applying. This file changes no live source,
trigger, deployment, credentials or Fitness data.

Keep the capture payload and all callers. Rename ONLY its existing declaration:

```javascript
function rposBridgeLegacyCreateGymCapturePage_(cfg, event, plan, now) {
  // Entire original createGymCapturePage_ body, unchanged.
}
```

Add this wrapper once; do not leave another declaration with the original name:

```javascript
function createGymCapturePage_(cfg, event, plan, now) {
  return rposBridgeCreateGymCapture_(cfg, event, plan, now,
    rposBridgeLegacyCreateGymCapturePage_);
}
```

Add the five runtime `.gs` files. The wrapper uses existing cfg.notionToken,
RPOS.fitnessDataSourceId and Script Lock. It reads the full source/ID result AND
exact archived Notes alias, then reuses one active page. Different matching
pages stop as conflict. Python v1 alias tokens are compatible, including
Unicode escaping. Historical aliases archived only as prose need explicit
review/token migration; date or title alone never identifies a target.

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
