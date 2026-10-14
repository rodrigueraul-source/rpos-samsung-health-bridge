# Automatic acquisition candidate 0.8.0

The installed 0.7.1 receipt-recovery release remains accepted. This candidate
adds automatic acquisition; it is OFF by default and has not passed physical
automatic-operation acceptance. Notion remains the System of Record.

Android uses the existing Samsung Exercise READ grant, original SDK mapping,
private endpoint, certificate and encrypted queue. Enabling takes an immutable
cutover and a baseline of existing UIDs. Historical, unfinished and recently
updated records are excluded. Pausing/resuming retains the original cutoff.
A persisted JobScheduler job requests network work every 15 minutes; Android
can delay it under battery, quota, standby or force-stop rules. Reopening is
required after Android force-stop. No permission popup runs in the background.
READ/COPY/manual queue and the existing acknowledgement-recovery path remain.

The server coordinator verifies the signed immutable intake, canonical hash,
UID uniqueness, cutoff, schema and potential existing date/activity records.
Date/activity only block creation; they never select a destination. Ambiguous
or planned sessions require review. A new page carries the exact SDK export
and one v2 receipt. Parent nulls and subjective feedback remain absent.
Verified write intent precedes creation. An uncertain creation is never blindly
retried; fresh unique identity/evidence/original readback can recover it.

Activation requires explicit configuration: intake and reviewed binding ON,
delivery/automatic ON, migration OFF, immutable start timestamp, and mode
`pilot` with `BRIDGE_AUTOMATIC_MAX_NEW` from 1 to 3. Attempting as well as
confirmed automatic intents consume this limit. Continuous mode is a separate
decision after the real pilot. No flags or triggers are changed by installing
the code. The optional pending timer is separately authorized, bounded to
three due receipts and persists backoff before each retry. Review cases stop.

The isolated `BridgeAutomaticRuntime.gs.txt` addon contains lexical copies of
tested dependencies so a partial legacy runtime cannot cause another missing
helper failure. It exposes only delivery/pending entry points and performs no
service calls at load. Install the addon and update the existing Endpoint;
do not add duplicate global copies or replace unrelated scheduler code.

Closure requires three real automatic cycles with source, receipt/hash, unique
Notion readback and Android ack, including recovery/replay. Synthetic tests and
the three prior bounded 0.7.1 cases are separate evidence. Faster read/replay of
existing records does not prove automatic first writes. Historical migration
remains OFF until its explicit scope, aliases, conflicts and reviews are ready.

Capacity is explicit: the existing queue retains at most 100 original exports;
the cutover baseline accepts at most 1,000 UIDs. Exhaustion stops safely and
requires review; no automatic purge, loss of originals or visibility change.
