# Exercise metric semantics — BR09

## Sources and units

The pinned Samsung Health Data SDK 1.1.0 acquisition path reads an Exercise
record and its `SESSIONS`. Each `ExerciseSession` reports duration as a
`Duration` (exported as milliseconds), calories in kcal, optional distance in
meters, and optional heart-rate summaries in bpm. These are segment fields.

Samsung's ExerciseType API separately exposes aggregate operations
`TOTAL_DURATION` and `TOTAL_CALORIES`. This adapter does not call those
operations. A sum computed locally from segments must not be labelled as a
Samsung parent total or as the app's displayed total.

Official references checked 06-Oct-2026:

- https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-exercise-type/index.html
- https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.data.entries/-exercise-session/index.html

## Mapping contract

| Input | Export/evidence meaning | Fitness write rule |
| --- | --- | --- |
| Parent duration/calories/distance not supplied by this read adapter | Explicit null; unknown | Preserve the existing metric |
| Segment duration | SDK-reported active duration in milliseconds | Preserve as segment evidence |
| Segment calories, including BREAK | SDK-reported kcal for that segment | Preserve as segment evidence |
| Sum across all segments | Calculated segment sum, including BREAK | Never substitute for a parent or screenshot total |
| Sum across non-BREAK segments | Calculated activity-only segment sum | Never substitute for an app total |
| End minus start | Wall-clock elapsed time | Never substitute for reported active duration |
| Partially populated distances | Sum of observed distances only; not complete total | Preserve unknown contributions |
| Segment mean heart rate | Mean for that segment | Do not derive overall mean from unweighted segment means |
| Existing screenshot/manual metric | Independent existing evidence with its provenance | Do not replace with a calculated sum |

## Verified boundary

`ExerciseReaderProvider` intentionally leaves the three parent totals null.
`ExerciseExport` serializes those nulls and the original segment values.
`BridgeNotion.prepare` changes only canonical Source, Source Record ID, Date
and the required Notes alias. The separate managed evidence block retains
the complete original record. The delivery worker does not write duration,
calories, distance, heart-rate, routine, reps/load or subjective feedback.

The two previously accepted real records were re-read from their existing
Notion v2 evidence on 06-Oct. Both still contain null parent totals. Segment
duration differs from wall-clock elapsed time, and screenshot calories differ
from segment sums. The private numeric comparison is recorded in the
Implementation Log; no health payload or private identifier is committed here.

This establishes the mapping and discrepancy rule. It does not establish why
the Samsung app calculates a different displayed total. That cause remains
unconfirmed and is not inferred from rounding or BREAK classification.
