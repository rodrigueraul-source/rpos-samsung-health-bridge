# Samsung UID → R-POS Source Record ID contract

## Mandatory provenance

For a real Samsung Health Exercise read:

- Samsung `HealthDataPoint.uid` is the source identifier.
- R-POS stores that value unchanged as **Source Record ID**.
- Dedupe key = `(source, source_record_id)`.
- Replaying the same Samsung UID is an idempotent no-op.
- A new Samsung UID may create exactly one normalized record.
- A generic/synthetic `record_id` must never replace a real Samsung UID.

## Current implementation

`rpos/bridge_event.py` contains the reference mapping and in-memory replay guard.
`rpos/exercise_export.py` validates the v1 own-app export and rejects mock
provenance or timestamps without a timezone. `rpos/delivery_store.py` persists
private deliveries in SQLite, unique on `(source, uid)`.

Staging the same event after a restart retains one row. A failed remote write
leaves it pending; an unchanged confirmed replay remains confirmed. Changed
payloads return to pending while retaining their reconciled Notion page ID.
A stale payload hash, mismatched UID/source or different target page cannot
confirm delivery. Read timestamps belong to the export envelope and do not
alter event identity. Tests cover these boundaries using synthetic data.

Private handoff staging (no Notion call):

```bash
python scripts/stage_exercise_export.py data/private/exercise.json
```

The local receipt is not a distributed exactly-once guarantee. A delivery worker
must query Notion by source/UID before writing, reconcile manual/Drive evidence,
update the associated page or create only when no match exists, and read back
the actual page before calling `confirm_readback`. After a write timeout or
crash, query again before retrying. Serialize workers targeting the same UID;
Notion itself has no unique constraint for Source Record ID. The v0.4
coordinator is transport-independent; its authenticated runner is not deployed.
No unattended ingestion proof is claimed.

The existing Notion Fitness Sessions schema uses `Source`, `Source Record ID`
and the expanded `date:Date:start` / `date:Date:is_datetime` fields. It has no
`Recorded At` or `Metric Type` properties. The event keeps its canonical
`recorded_at` and `metric_type`; the connector mapping uses the actual schema.

Before a live write, reconcile any existing manual/Drive workout. Matching its
date or displayed start minute alone does not confirm the Samsung UID belongs
to that workout. Preserve prior evidence identifiers and do not count the same
session again. A screen result is read evidence, not a full SDK payload export
or proof of live Notion idempotency.

## Remaining real gate

Synthetic replay PASS is not the Bridge PASS gate. Closure still requires:

The initial own-app read, assisted existing-session UID mapping/readback and
controlled unchanged replay are evidenced privately. Remaining gates include
another real UID, consent/error device UAT, authenticated unattended transport
and real cross-system timeout/crash recovery. Synthetic fault injection is not
live delivery evidence.

## v0.4 delivery coordinator

`rpos/delivery_worker.py` exposes `DeliveryWorker.deliver(event)` and `resume()`
for the existing evidence runner. Its `NotionPort` must implement fully paginated
exact Source+UID lookup, source-window/sequence reconciliation, preservation of
manual aliases/metrics, writes to the same Fitness database, and actual remote
readback of identity plus an evidence payload hash. The hash is recorded in
versioned page evidence, not a new Fitness database property.

The coordinator commits a SQLite `attempting` intent before a remote write.
An applied write whose response was lost is confirmed after matching remote
identity/hash and unique UID readback. A missing UID after an interrupted create
remains `unresolved`: it is not permission to create again. A stale/different
hash also remains unresolved. This intentionally favors avoiding duplicates
over automatic retries when the outcome is unknown; operator investigation of
the original request is required. No automatic reset of ambiguous writes is
provided. Changed data cannot erase a prior uncertain intent.

An advisory Linux file lock serializes workers sharing this receipt DB. Use
one runner and one canonical absolute DB path for the destination; independent
hosts/DBs and external Notion writers are not covered by this lock. Multiple
UID matches, changed targets, wrong identity/hash and races during readback
cannot confirm a delivery. Existing v0.3 receipts are migrated in place.

Tests inject before/after-write timeouts, a process-exit exception, readback
failure, delayed query visibility and competing worker processes. They use
synthetic data and a fake remote. Manual-alias/metric preservation remains an
adapter obligation, not a proven production behavior from those fake tests.
