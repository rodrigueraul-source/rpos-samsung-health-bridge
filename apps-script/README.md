# Apps Script intake preparation — existing scheduler

This is the first JavaScript runtime block for the user-selected existing
Apps Script scheduler. The user confirmed on 05-Oct-2026 that the reviewed
`R-POS External Scheduler F V0_3.txt` is the latest saved code. Their screenshot
shows no active or archived deployments. Time-triggered scheduling is distinct
from a deployed HTTP web app; no deployment version is currently available.

## What is implemented

- `BridgeIntake.gs`: bounded, signed Exercise export validation and durable
  staging coordinator, with source/UID identity and a canonical **record** hash.
- `BridgeEndpoint.gs`: Apps Script `doPost`, Script Lock, Script Properties intent
  journal and Drive receipt storage. Disabled unless explicitly configured.
- Receipt states are `writing` / `staged`. `staged` means the export was persisted
  and read back, **not** delivered to Notion. Every response sets
  `notion_confirmed: false`. No Notion or IFTTT call is made.
- Original fields, nulls, titles, segment overlaps and millisecond timestamps
  are retained. No calories, elapsed/active duration or parent totals are inferred.
- A new `read_at` or `read_record_count` on the same unchanged record reuses its
  receipt. Changes to a record under its UID are quarantined for review.

The receipt namespace/hash is separate from the Python delivery database and
`rpos.notion.evidence.v1` event hashes. It is an intake queue in the existing
evidence lane, not a second Fitness database. A future Apps Script delivery
worker must bridge these contracts explicitly before it can confirm Notion.
Synthetic tests are preparation evidence only, not a real outage/device PASS.

## Integration prerequisites (no deployment in this commit)

Add both `.gs` files to the existing project after reviewing the change. Do not
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
One Script Lock serializes this intake only; it does not coordinate external
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
node --test tests/apps_script_intake.test.cjs
```

Tests load the actual `.gs` files in a Node VM using synthetic exports/services.
They cover authentication/limits, null fidelity, repeat acquisition, process
context reset, changed records, lock contention, journal failures, lost create
responses, visibility gaps, duplicates/corruption and error redaction. These
tests do not authorize Drive, create an endpoint or write real evidence.

Remaining implementation: Apps Script Notion delivery coordinator, reviewed
target reconciliation and scheduler alias binding; Android queue/signing/send;
reviewed deployment/auth setup; physical handoff/actual cross-system recovery;
remaining Samsung errors and calorie semantics. Registry stays BUILD 35%.

Official API references:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/reference/utilities/utilities
- https://developers.google.com/apps-script/reference/lock/lock-service
- https://developers.google.com/apps-script/reference/drive/folder
- https://developers.google.com/apps-script/guides/services/quotas
