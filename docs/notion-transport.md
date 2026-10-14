# Existing Fitness REST adapter

`rpos/notion_transport.py` implements `NotionPort` for the approved existing
Fitness source. `scripts/deliver_exercise_export.py` binds it to the durable
coordinator. It is prepared code, not an installed server, scheduler or Android
upload path. The Android APK is unchanged.

## Host contract

- Supply `RPOS_NOTION_TOKEN` through the approved host's secret configuration.
  Never paste it into a chat, put it in a CLI argument, commit it, or bundle it
  in Android. The connected ChatGPT Notion session is not a deployable token.
- Supply `RPOS_FITNESS_DATA_SOURCE_ID` for the existing Fitness source.
- All workers use one persistent receipt DB, the same resolved path and local
  lock. Independent machines/DBs and external writers are not coordinated.
- Retain private exports, review manifests and receipt backups outside Git.
  New CLI-created receipt files/directories use private permissions.
- Run the CLI inside the approved evidence runner. No recurring job, new
  notification stream or new Fitness database is installed by this code.

```bash
python scripts/deliver_exercise_export.py check
python scripts/deliver_exercise_export.py deliver \
  --export data/private/selected-exercise.json \
  --database /approved/persistent/path/delivery.sqlite3 \
  --review data/private/review.json
python scripts/deliver_exercise_export.py resume \
  --database /approved/persistent/path/delivery.sqlite3
```

`check` reads schema/access only. `deliver` is an explicit write operation.
`resume` resolves outstanding receipts; uncertain writes are never blindly
repeated. CLI output contains aggregate statuses, not health fields or tokens.
Exit codes: 0 confirmed/check ready, 2 unresolved/reconciliation needed,
1 blocked/failed. Preserve the receipt on any nonzero exit.

## Reviewed target

This adapter only updates existing Fitness pages. It cannot create a new
session. A missing canonical UID requires an explicit private reconciliation
review tied to the complete event hash and target snapshot. There is no
automatic date-only, title-only or routine-only match.

Private manifest format (all example values are synthetic):

```json
{
  "schema_version": "rpos.reconciliation.v1",
  "entries": [{
    "source": "samsung_health",
    "uid": "synthetic-exercise-a",
    "payload_hash": "SHA256 of the canonical normalized event",
    "target_page_id": "00000000-0000-4000-8000-000000000002",
    "expected_last_edited_time": "2026-01-01T01:00:00Z",
    "expected_source": "fixture_scheduler",
    "expected_uid": "fixture-capture-a",
    "review_basis": "Privately reviewed source window and segment sequence"
  }]
}
```

Generate the hash with `event_hash(event_from_export(envelope))` after reviewing
the actual private export. Obtain target identity/edit time through actual
readback, not from a date-based guess. A changed event, duplicate review,
changed target, wrong Fitness source or another Samsung UID blocks the write.
No target/no complete review leaves `needs_reconciliation` with no mutation.

## Preservation and remote verification

- Fully paginate UID queries, property items and page/block children. Detect
  missing/repeated cursors and incomplete list shapes; do not confirm partial
  searches.
- Update only Source, Source Record ID and Date, plus Notes when an old alias
  must be archived. Preserve rich-text links, mentions and annotations.
- Do not overwrite Session, Workout Detail, calories/duration/distance/HR,
  Capture State, subjective feedback, routines or Gym V4. SDK objective data
  is retained in one managed code block, with its canonical event hash.
- Retain prior source/UID/date in evidence and add an exact alias token as a
  separate Notes line. Never truncate long Notes/evidence to fit API limits.
- Re-fetch identity/edit time immediately before writing. This detects edits
  during preparation but is not an atomic compare-and-swap: Notion external
  writers can still race between read and PATCH. Coordinate them operationally.
- Read actual source/UID, recompute versioned evidence hash and verify remote
  uniqueness before confirming the receipt. The legacy `Bridge payload
  SHA256:` marker is supported for earlier assisted checkpoints; it is not
  a new integrity measurement of their full historical page contents.

Notion property PATCH and block PATCH are two separate operations. If only
properties were written, the receipt remains `attempting`/`unresolved`. Stop
and inspect the original attempt privately; do not delete the receipt or
blindly re-run a write. If both applied but the response was lost, a later
actual readback can confirm without sending another mutation.

HTTP uses a fixed api.notion.com origin, Notion-Version 2026-03-11, a bounded
timeout, no authenticated redirects and no automatic retry (including 429
or 5xx). Error output omits request/response bodies and credentials. The
existing runner owns scheduling/rate control and any reviewed recovery.

## Scheduler aliases

`alias_marker(source, old_uid)` creates a deterministic `rpos.alias.v1:<hash>`
token; `find_alias(source, old_uid)` paginates Notes-filtered candidates and
verifies the exact token line before returning targets. Never take the first
of multiple matches. This is a tested Python lookup, not a patch to the
deployed Apps Script scheduler.

The current scheduler must check an archived alias after its original exact
Source Record ID lookup, before creating a new capture. Inspect its current
`Code.gs` and Notion request helper before binding that logic. The 28-Sep PDF
is a review snapshot, not executable SoR. Earlier plain-text alias archives
are not automatically converted to these tokens: backfill only with reviewed
private provenance. Do not run capture-creation tests against canonicalized
historical days until scheduler alias resolution is bound and verified.

## Validation boundary

Synthetic REST-shaped tests cover paginated queries/Notes, duplicate UID,
wrong schema/source, stale reviews, source changes, preservation, evidence
tampering, legacy readback, updated records, lost responses, partial writes,
exact alias lookup and redacted single-attempt HTTP failures. They do not
establish actual Notion outage recovery, a deployed credential, permanent
host persistence or unattended Android upload.

Official references:

- https://developers.notion.com/reference/query-a-data-source
- https://developers.notion.com/reference/retrieve-a-page-property
- https://developers.notion.com/reference/get-block-children
- https://developers.notion.com/reference/patch-page
- https://developers.notion.com/reference/patch-block-children
- https://developers.notion.com/reference/versioning
- https://developers.notion.com/reference/request-limits
