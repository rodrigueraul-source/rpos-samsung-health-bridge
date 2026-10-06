# Apps Script intake and delivery preparation — existing scheduler

This is the JavaScript runtime preparation for the user-selected existing
Apps Script scheduler. The user confirmed on 05-Oct-2026 that the reviewed
`R-POS External Scheduler F V0_3.txt` is the latest saved code. Their screenshot
shows no active or archived deployments. Time-triggered scheduling is distinct
from a deployed HTTP web app; no deployment version is currently available.

## What is implemented

The optional ordinary-delivery review v2 `aliases` field preserves explicitly
reviewed historical identities when the current Source was changed by another
evidence flow. Each entry is `{source, uid, date}`; at most 20 total aliases,
including the automatically archived current identity. Duplicate, current or
canonical identities, malformed provenance and aliases owned by another page
stop before write intent or PATCH. Ownership is rechecked after preparation.
Omitted aliases retain the existing review contract. This does not infer history,
activate delivery, change metrics or replace the owner's installed runtime.

- `BridgeIntake.gs`: bounded, signed Exercise export validation and durable
  staging coordinator, with source/UID identity and a canonical **record** hash.
- `BridgeEndpoint.gs`: Apps Script `doPost`, Script Lock, Script Properties intent
  journal and Drive receipt storage. Disabled unless explicitly configured.
- `BridgeDelivery.gs` / `BridgeNotion.gs`: reviewed existing-page delivery, durable
  write intent and complete remote identity/hash/uniqueness readback.
- `BridgeScheduler.gs`: UID/alias lookup and persistent capture-creation intent.
  Binding instructions: `scheduler-integration.md`.
- `BridgeMigration.gs`: operator-only read audit and explicitly reviewed conversion
  of accepted legacy evidence. Retains original blocks, adds v2 plus exact Notes
  aliases, with a separate durable migration journal. Never called by `doPost`.
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

Add all six runtime `.gs` files to the existing project after reviewing the change. Do not
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

## Historical evidence migration (prepared, not applied)

The two accepted real-UID pages currently contain prose hash evidence and archived
aliases, not managed v2 evidence/exact alias tokens. Their identity and existing
metric/feedback states were inspected read-only. Conversion is not inferred from
the fact that those pages already have a Samsung UID.

Early pages headed `Samsung Health Bridge · UID reconciliation · DD-Mmm-YYYY`
may contain reconciliation prose without a v1 hash block. They use the same
explicit operator review and unique canonical UID checks. Their snapshot binds
every retained original block's ID, parent, type and content, including nested
table cells. No hash or delivery receipt is invented for their prior evidence.
Ordinary delivery still stops for reviewed migration; unrelated prose is not
recognized by date, workout title or a partial heading match.
Reviewed legacy alias IDs may contain a composite old Source Record ID up to
2,000 characters; original Samsung UID validation remains at 256. Alias count,
full Notes/evidence UTF-8 limits and exact-token readback still apply.

After private intake staging, `rposBridgeAuditMigrationReceipt(receiptId)` reads
the unique canonical page twice and returns an opaque snapshot hash, target,
record hash and legacy block count. It does not return health fields, write a
review/journal or mutate Notion. A changed snapshot/duplicate target stops it.

Privately review the original export, accepted Python event/hash evidence and
each archived alias. An old Python hash is never compared to or substituted for
the new JS record hash. Set `RPOS_BRIDGE_MIGRATION_REVIEW_<receipt_id>` to:

```json
{
  "schema_version": "rpos.bridge.migration.review.v1",
  "receipt_id": "<opaque staged receipt ID>",
  "record_hash": "<staged JS record hash>",
  "target_page_id": "<existing canonical page UUID>",
  "expected_snapshot_hash": "<fresh read-only audit snapshot>",
  "review_basis": "<original export, old evidence and each exact alias verified>",
  "aliases": [{"source": "<prior source>", "uid": "<prior ID>",
    "date": {"start": "<prior date>"}}]
}
```

Only then privately enable `BRIDGE_MIGRATION_ENABLED=true` and invoke
`rposBridgeMigrateReceipt(receiptId)` as the trusted operator. This is independent
of the scheduler-binding guard so historical conversion can precede enabling
the wrapper. HTTP clients cannot request migration. Do not leave migration
enabled after the reviewed batch.

The coordinator requires unique canonical identity, reviewed snapshot/record/
target, unambiguous aliases and no ordinary-delivery write intent. It preflights
both payloads, rechecks identity/aliases/snapshot, saves and verifies `attempting`
before the first PATCH. It changes only Notes (preserving its rich text) and
appends one v2 block. Source, UID, Date, metrics, Capture State and every legacy
block remain unchanged. The new evidence binds all legacy block IDs/types/text
hashes; removal or alteration later fails closed.

A lost append response can confirm by complete legacy/v2/alias/identity readback;
a Notes-only partial write stays unresolved, without another PATCH. Do not clear
the migration journal or overwrite historical blocks. Ordinary delivery accepts
migrated evidence only after its private migration journal is confirmed. Recheck
scheduler aliases and the single-writer boundary before enabling binding/delivery.
Notion writes are not atomic; manual/external edits may still race the final read.
Synthetic tests do not prove real migration or outage recovery.


## Read-only acknowledgement while continuous delivery remains OFF

After authenticated staging, `doPost` may return nested delivery confirmation
for a prior confirmed ordinary delivery journal. It takes Script Lock, validates
the same unique stored file/hash/intake intent, checks current Notion UID and
original v2 evidence, and rechecks uniqueness/journal before responding.
Migration evidence also requires its matching confirmed migration journal.
No missing journal is inferred from a matching page: ordinary pending intake
stays staged without Notion reads. Attempting remains unresolved.

This route never calls the delivery worker, modifies activation flags or
delivery journals, or PATCHes/creates Notion data. Its HTTP adapter permits only
GET and the selected Fitness data-source POST query. Outer intake remains
staged/notion_confirmed=false; existing Android v0.5 consumes nested
delivery.confirmed. Intake may reaffirm its existing staging intent.

Prepared code is not the published web-app version. Update only the
BridgeEndpoint module in the installed bundle, save, and publish a new version
of the existing deployment to preserve its endpoint URL. Keep intake/binding
ON and delivery/migration OFF. Physical queue acknowledgement and process/OS
recovery remain separate acceptance gates.
