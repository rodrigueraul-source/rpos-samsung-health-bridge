# Android v0.6 — explicit read-only receipt recovery

The ordinary phone queue already has a confirmed real receipt. Ordinary CHECK
correctly skips confirmed entries. Re-uploading its Exercise JSON to create a
test pending state would touch intake and could invoke delivery if flags changed.
v0.6 instead uses a dedicated signed receipt query and a separate checkpoint.

## Wire contract and server boundary

The request has exactly five fields: `schema_version`, `sent_at`, `receipt_id`,
`record_hash`, `signature`. Schema is `rpos.exercise.acknowledgement.v1`;
HMAC-SHA256 uses the existing lowercase-hex key's UTF-8 text bytes and this text:

```text
rpos.exercise.acknowledgement.v1\n<Unix seconds>\n<receipt ID>\n<record hash>
```

The separators are LF bytes. Limit: 4096 UTF-8 bytes; integer timestamp within
300 seconds; identities/signature are 64 lowercase-hex characters. The schema
domain separates query signatures from Exercise intake. No export, UID, key,
Notion token or endpoint is included in the body.

The response schema is `rpos.exercise.acknowledgement.receipt.v1` and contains
status, boolean `notion_confirmed` and authenticated receipt/hash (otherwise
null). Confirmation requires the prior confirmed ordinary journal, unique
unchanged Drive receipt and staged intake intent, matching Fitness source,
unique live UID, complete original evidence and a stable re-read journal.
Migration evidence additionally requires its matching confirmed journal.

The dispatcher handles this path before intake. It never calls intake staging,
the delivery worker, Drive create or property/journal writes, regardless of the
continuous-delivery flag. Its Notion port permits only GET and the configured
data-source POST query. Missing journal/binding is `unresolved`, not success.
An attempted uncertain journal is not repaired or rewritten by this query.

Receipt recognition constructs its own read-only property journals and Notion
HTTP port. It does not call the delivery adapters `rposBridgePropertyJournal_`
or `rposBridgeNotionHttp_`. A partial installation could previously pass a
direct core check but return `delivery_error` from a valid signed query when
one of those delivery adapters was absent. The receipt path now reads the same
properties and remote evidence directly, without acquiring delivery's setters
or general HTTP capabilities. Request/response, authentication, identity and
confirmation criteria are unchanged; HTTP, parse and transport failures still
cannot claim confirmation.

For this repair, replace the existing marked `BridgeEndpoint.gs` section inside
`BridgeRuntime.gs` with all of `BridgeEndpoint-ReceiptRead-Repair.txt`, including
both boundary markers. The builder checks that this replacement matches the
Endpoint source and seven-module bundle. Publish a new version of the existing
deployment, then run the existing `rposBridgeReviewRecovery` once. This is a
module replacement in the existing project; it needs no additional `.gs` file,
phone reinstall or flag change. A synthetic regression removes both delivery
adapters and exercises signed recognition through the actual dispatcher with
fresh evidence, unchanged journals and zero new writes. It does not establish
the specific cause in a remote installation or replace device evidence.

## Durable controlled test

**TEST RECEIPT RECOVERY** requires exactly one ordinary confirmed receipt with
its existing server hash. A separate encrypted `bridge-recovery.enc` envelope
(`rpos.android.recovery.v1`) retains only receipt/hash, hashes of the original
payload/endpoint, phase, state, reason, attempts and next-check time. The ordinary
queue/configuration are unchanged. Keystore/GCM/AtomicFile and readback are the
same private storage mechanism as delivery.

1. Save and read back `pending/outcome_pending` before the first signed query.
2. On receiving and validating a real confirmation, deliberately discard that
   result before committing test confirmation; save `pending/response_discarded`.
3. Reboot the phone while this separate test checkpoint is pending.
4. Open the app, which reads persisted state without sending. After backoff,
   CHECK signs a fresh query for the same receipt/hash and saves confirmation.

This is explicit controlled fault injection after a real read-only response.
It is not a natural outage, an interrupted Notion PATCH, a remotely pending
delivery, or proof of full BR06. The ordinary receipt remains `confirmed: 1`.
No automatic boot/background send or purge/reset is added. A completed probe
does not block queuing later workouts. Original-payload or endpoint changes,
corrupt checkpoints and wrong response identities fail closed.

Initial network errors retain the discard phase until a real confirmation
arrives. Retry delays grow from 30 seconds to 15 minutes. A blocked probe stops
until its backend issue is reviewed, then the existing long-press CHECK action
can schedule the same identity again. No checkpoint deletion is needed.
An old endpoint's intake `invalid_request` response is reported as
`backend_update_required`; HTML/oversized/malformed responses never confirm.

## Handoff and evidence

Update the existing marked Endpoint module and release a new version of the
same approved web deployment. Keep URL/access/credentials/flags unchanged.
Install the same-package, same-certificate delivery APK as an update. Preserve
the existing app's private storage; do not uninstall or clear data.

Collect the pending screen (`response discarded`), reboot report and the final
fresh-check screen (`recovery: confirmed`). Independently check canonical
UID/page/count/evidence preservation in R-POS afterwards. This can establish
controlled phone persistence/recovery; actual uncertain remote-write recovery
and remaining physical Samsung errors remain distinct gates. BUILD stays
66.67%, four of six verified milestones until the complete criteria are met.

Synthetic Kotlin tests use an independent cross-language signing vector,
fresh runtime objects, storage-before-network assertions, failed readbacks,
lost results, backoff, mismatch/corruption and ordinary-queue preservation.
Server tests exercise the actual `.gs` dispatcher with mutation-capable services
instrumented to reject all writes. These do not substitute for device evidence.
