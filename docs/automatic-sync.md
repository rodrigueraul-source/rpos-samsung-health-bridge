# Automatic acquisition — 18-Oct promotion / 19-Oct limited PASS

The accepted private checkpoint records Android 0.8.3/SDK 1.1.0, pilot 3/3 and
continuous mode active. Intake, reviewed binding, delivery and automatic
acquisition are ON; migration is OFF. Notion remains the System of Record.
This document does not independently verify deployed bytes or installed APK
hashes. See [checkpoint](operations-checkpoint-2026-10-18.md).

Android reuses the existing Samsung Exercise READ grant, original SDK mapping,
private transport, certificate and encrypted queue. The immutable cutoff and
baseline exclude historical/unfinished records. Settling and changed-record
handling retain original queued payloads. Pause/resume preserves the cutoff.
A persisted JobScheduler job requests work every 15 minutes; Android may delay
execution. Reopening may be needed after force-stop. No background consent
popup is introduced. READ/COPY/manual queue and receipt recovery remain.

The server validates signed immutable intake, canonical hash, source UID
uniqueness, cutoff and schema. Date/activity matches only block uncertain
creation; they never choose a destination. Ambiguous/planned matches require
review. Intent is persisted before creation; an uncertain response is recovered
through unique identity, original evidence and readback rather than blind retry.

Pilot activation and continuous promotion are separate controlled operations.
The accepted pilot already reached 3/3. Do not reactivate it for documentation.
PR #11 adds an owner-only promotion guard that changes only the mode key and
rolls back a failed readback. Loading or merging code invokes no operation.
The existing pending-receipt clock and bounded retries are preserved.

The isolated automatic addon carries tested dependencies. Do not duplicate
global modules or replace unrelated scheduler code. The source builders and
current CI check bundle consistency; they do not prove deployed source hashes.

Operational evidence was completed by one genuinely new natural capture on
19-Oct after continuous promotion: new receipt/UID, confirmed journal, exact
unique Notion row/readback and matching Android acknowledgement. The accepted
limited operational PASS does not close milestone 6 technically; the owner
waiver remains and development stays 83.33% (5 of 6). Do not replay accepted
receipts or CI mock as a new physical capture.

Capacity remains 100 queued original exports and 1,000 baseline UIDs. Exhaustion
stops safely for review; no automatic purge, schema expansion, visibility change
or historical migration is introduced by this documentation correction.

Historical preparation: the 0.8.0 candidate introduced automatic acquisition
while 0.7.1 was the accepted receipt-recovery release. Those preparation states
are historical and must not be used as current OFF/ON settings.
