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
Notion itself has no unique constraint for Source Record ID. No automated
network worker or live ingestion proof is claimed in this version.

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

1. one real Exercise record read by the own Android app;
2. original Samsung UID captured;
3. UID written/read back as Notion Source Record ID;
4. replay of that same real UID producing no duplicate.
