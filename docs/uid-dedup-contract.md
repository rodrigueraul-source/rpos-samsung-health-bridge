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

`rpos/bridge_event.py` contains the reference mapping and replay guard.
Unit tests prove the mapping and synthetic replay behavior.

## Remaining real gate

Synthetic replay PASS is not the Bridge PASS gate. Closure still requires:

1. one real Exercise record read by the own Android app;
2. original Samsung UID captured;
3. UID written/read back as Notion Source Record ID;
4. replay of that same real UID producing no duplicate.
