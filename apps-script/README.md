# Apps Script intake and delivery preparation — existing scheduler

This is the JavaScript runtime preparation for the user-selected existing
Apps Script scheduler. The user confirmed on 05-Oct-2026 that the reviewed
`R-POS External Scheduler F V0_3.txt` is the latest saved code. Their screenshot
shows no active or archived deployments. Time-triggered scheduling is distinct
from a deployed HTTP web app; no deployment version is currently available.

## What is implemented

- `BridgeIntake.gs`: bounded, signed Exercise export validation and durable
  staging coordinator, with source/UID identity and a canonical **record** hash.
- `BridgeEndpoint.gs`: Apps Script `doPost`, Script Lock, Script Properties intent
  journal and Drive receipt storage. Disabled unless explicitly configured.
- `BridgeDelivery.gs` / `BridgeNotion.gs`: reviewed existing-page delivery, durable
  write intent and complete remote identity/hash/uniqueness readback.
- `BridgeScheduler.gs`: UID/alias lookup and persistent capture-creation intent.
  Binding instructions: `scheduler-integration.md`.
- Receipt states are `writing` / `staged`. `staged` means the export was persisted
  and read back, **not** delivered to Notion. Every response sets
  `notion_confirmed: false`. Separately enabled delivery adds a nested `delivery`
  receipt; only its `confirmed` status means Notion evidence was read back.
  No Bridge file calls IFTTT.
- Original fields, nulls, titles, segment overlaps and millisecond timestamps
  are retained. No calories, elapsed/active duration or parent totals are inferred.
- A new `read_at` or `read_record_count` on the same unchanged record reuses its
  receipt. Changes to a record under its UID are quarantined for review.

The receipt namespace/hash is separate from the Python delivery database and
`rpos.notion.evidence.v1` event hashes. It is an intake queue in the existing
evidence lane, not a second Fitness database. The prepared delivery writes an explicit `rpos.notion.evidence.v2` record/hash
block and stops on Python v1/legacy evidence as `needs_migration`. Existing
accepted receipts are not rewritten or treated as automatic-flow proof.
Synthetic tests are preparation evidence only, not a real outage/device PASS.

## Integration prerequisites (no deployment in this commit)

Add all five runtime `.gs` files to the existing project after reviewing the change. Do not
replace `Code.gs`, install triggers, run scheduler test handlers or modify its
existing Notion/IFTTT properties. The reviewed snapshot has no `doPost`; recheck
the live project before adding this endpoint to avoid a duplicate handler.

The owner must configure these **new**, dedicated Script Properties:

| Property | Meaning |
| --- | --- |
| `BRIDGE_INTAKE_ENABLED` | Default absent/off; literal `true` enables intake |
| `BRIDGE_INTAKE_HMAC_KEY` | 64 lowercase hex characters generated from 32 cryptographically random bytes; used as a UTF-8 string HMAC key |
| `BRIDGE_RECEIPT_FOLDER_ID` | Explicit existing restricted Drive folder for private exports/receipts |

The intake signing key is distinct from `NOTION_TOKEN` and `IFTTT_KEY`. Provision
it privately to the future personal Android client; never hardcode it in source,
an APK, a URL, a log or chat. Backend Notion credentials remain on the backend.
No credential or folder is created/shared by these files. Drive authorization
and endpoint access settings require review at deployment time.

Script Properties quota exhaustion fails closed before a new Drive create.
Intent keys are retained, never automatically evicted. A future capacity/
retention migration must preserve all write intents and receipt identities.
An `unresolved` receipt requires inspection; do not clear the journal to retry.
One Script Lock serializes intake, delivery and the prepared scheduler wrapper; it does not coordinate external
Drive writers, another project or the Python SQLite worker. Keep one configured
intake writer and protect its receipt folder.

## Signed request contract

POST `application/json` to the future approved web-app endpoint:

```json
{
  "schema_version": "rpos.exercise.intake.v1",
  "sent_at": 1800000000,
  "payload_json": "<exact UTF-8 Exercise export JSON string>",
  "signature": "<64 lowercase hexadecimal characters>"
}
```

`sent_at` is integer Unix seconds, within 300 seconds of the server clock.
Calculate SHA-256 over the exact UTF-8 bytes of `payload_json`. Sign the following
UTF-8 text with HMAC-SHA256, using the configured key string:

```text
rpos.exercise.intake.v1\n<sent_at>\n<lowercase payload SHA-256>
```

Here `\n` means an actual LF byte. Never send the signing key in the request.
Maximum body size is 256 KiB; maximum inner JSON size is 192 KiB. Re-sign retries
with the current time and retain the unchanged export. Stale signatures and
mock-source exports are rejected. A signed source field verifies the client
contract, not an independent attestation of Samsung SDK/device provenance.

The server fingerprints the canonical record only: recursively sort object
keys, preserve array order, then JavaScript `JSON.stringify`. Missing and null
values remain distinct; unknown optional record fields are retained. This hash
is not the existing Python event hash; the Android client need not calculate it.

## Responses and interrupted writes

ContentService returns JSON business statuses; an HTTP success/redirect alone
does not mean acceptance. Clients must parse `schema_version` and `status`.

| Status | Meaning / action |
| --- | --- |
| `staged` | Unique receipt persisted/read back; includes opaque receipt ID/hash; Notion still unconfirmed |
| `disabled` / `not_configured` | Stop and complete reviewed backend setup |
| `invalid_request` / `unauthorized` | Fix contract/signature/time; no receipt write |
| `busy` | Retry later with backoff and a fresh signature |
| `record_changed` / `storage_conflict` | Stop for reconciliation; never overwrite |
| `storage_error` / `storage_unresolved` | Outcome uncertain; same-record retry can read back, but cannot blindly create again |

The coordinator persists and reads back a `writing` intent **before** Drive
creation. A lost create response can be recovered by unique file/hash readback.
An empty lookup after an uncertain attempt remains unresolved. A duplicate,
tampered or missing receipt cannot be acknowledged as a new successful write.
Receipt contents contain no signature or signing key. Raw service exceptions
and health fields are never returned to the client or deliberately logged.

## Local verification

```bash
node --test tests/apps_script_*.test.cjs
```

Tests load the actual `.gs` files in a Node VM using synthetic exports/services.
They cover authentication/limits, null fidelity, repeat acquisition, process
context reset, changed records, lock contention, journal failures, lost create
responses, visibility gaps, duplicates/corruption and error redaction. These
tests do not authorize Drive, create an endpoint or write real evidence.

Android v0.5 now prepares private queue/signing/foreground send/check against
this contract; see `../docs/android-delivery.md`. Remaining operational work:
Samsung build/signing, live reviewed-target/alias binding and migration;
reviewed deployment/auth setup; physical handoff/actual cross-system recovery;
remaining Samsung errors and calorie semantics. Registry stays BUILD 35%.

Official API references:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/reference/utilities/utilities
- https://developers.google.com/apps-script/reference/lock/lock-service
- https://developers.google.com/apps-script/reference/drive/folder
- https://developers.google.com/apps-script/guides/services/quotas

## Delivery configuration and reviewed targets

Additional dedicated Script Properties (absent/off by default):

| Property | Meaning |
| --- | --- |
| `BRIDGE_DELIVERY_ENABLED` | Literal `true` enables delivery after authenticated staging |
| `BRIDGE_FITNESS_DATA_SOURCE_ID` | Existing Fitness source, enforced to match `RPOS.fitnessDataSourceId`; NOT the scheduler log `NOTION_DATA_SOURCE_ID` |
| `BRIDGE_SCHEDULER_BINDING_REVIEWED` | Literal `true` only after the wrapper and historical alias migration have been reviewed; required by delivery and the wrapper |

Backend delivery uses existing `NOTION_TOKEN`, never the Android signing key.
For one receipt, privately set `RPOS_BRIDGE_REVIEW_<receipt_id>` to this JSON;
never version real entries:

```json
{
  "schema_version": "rpos.bridge.review.v2",
  "source": "samsung_health",
  "uid": "<original UID>",
  "record_hash": "<staged record hash>",
  "target_page_id": "<existing Fitness page UUID>",
  "expected_last_edited_time": "<exact current remote edit timestamp>",
  "expected_source": "<current Source>",
  "expected_uid": "<current Source Record ID>",
  "review_basis": "<verified source window/segment sequence and destination>"
}
```

No date-only matching or Fitness creation occurs in delivery. Existing schema,
active Fitness parent and complete pagination are checked. Original Notes
formatting/links/mentions and prior alias/date are preserved. Only Source,
Source Record ID, Date and an archived Notes alias are changed. Metrics,
subjective fields and Capture State are untouched. Original record fields,
nulls and millisecond timestamps remain in v2 evidence.

The hash-bound review is checked before and after preparing both writes. Both
payload limits are preflighted before either write. A durable, readback-verified
`attempting` journal is saved before Notion mutation. Property and evidence
writes are single attempts, not atomic. A lost evidence-write response may
become `confirmed` from source/UID/record/hash/receipt and uniqueness readback.
A partial property write without evidence stays `unresolved`, with zero further
writes. Changed/removed confirmed evidence is a conflict. Never clear the
journal or re-create evidence blindly; investigate the remote state first.
429/5xx and transport errors are redacted, with no automatic HTTP retries.

`rposBridgeDeliverReceipt(receiptId)` is an operator callable function with an
opaque receipt argument. It installs no trigger. Authenticated re-POST of the
same unchanged export can read back nested delivery once enabled; the outer
receipt always means staging only. Missing review: `needs_reconciliation`.
Existing v1/legacy evidence: `needs_migration`, requiring reviewed conversion
before this runtime takes ownership. The old two accepted UID proofs remain
valid, but are not automatic v2 delivery proof.

Keep a single delivery writer and stop the Python relay for transferred UIDs.
Preserve all intake/delivery/scheduler journals across quota/storage migrations.
The same-project lock does not coordinate other projects or manual editors.
Notion lacks a cross-request transaction or conditional compare-and-swap;
an external edit can still race after the final check. Review this boundary
before enabling delivery or applying the wrapper.

Additional official API references:
- https://developers.notion.com/reference/query-a-data-source
- https://developers.notion.com/reference/retrieve-a-page-property
- https://developers.notion.com/reference/patch-page
- https://developers.notion.com/reference/patch-block-children
- https://developers.notion.com/reference/versioning
