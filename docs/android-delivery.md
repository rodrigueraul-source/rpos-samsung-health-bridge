# Android v0.5 delivery preparation

This changes the own app, not the live Apps Script project. No endpoint/key is
embedded in source, BuildConfig, APK or links. No real export is a test fixture.
The mock flavor cannot upload; shared synthetic unit tests validate the protocol.
No installed phone update or actual network/outage recovery is claimed here.

## Controls and private setup

1. After backend deployment/configuration review, open **CONFIGURE DELIVERY**.
   Enter the approved `https://script.google.com/macros/s/<deployment>/exec` URL
   and dedicated 64-lowercase-hex Bridge signing key **privately on the device**.
   Do not paste Notion/IFTTT credentials or the signing key into chat. Credential
   entry is masked, excluded from saved view state/autofill/keyboard learning,
   and protected from screenshots/recents during the dialog. Key text is cleared.
2. **READ EXERCISE** and choose a record. **QUEUE SELECTED + SYNC ONE** saves its
   original JSON and then processes at most one oldest due receipt. If setup or
   network is missing, the queued export remains private and durable. COPY is
   retained as the existing assisted fallback; it is not required for delivery.
3. **CHECK PENDING RECEIPTS** processes one due queued/retry/staged receipt.
   UI shows state counts, bounded review reason and backoff. Checks before the
   due time do not send. Retry delays grow from 30 seconds to at most 15 minutes;
   each attempt signs the exact retained export with the current timestamp.
4. `blocked` requires backend/configuration review. Only after that review,
   long-press **CHECK PENDING RECEIPTS**, then choose **Reviewed: recheck**. This
   schedules the original blocked receipts for a later check; it never clears
   a backend write intent or replaces the export. Confirmed receipts are retained
   and not automatically resent. No automatic purge/reset is provided.

Endpoint changes after any send attempt are blocked: transferring a pending
UID to another backend could bypass its original durable intent. Key rotation
for the same approved endpoint is possible privately after operator review.
The editor project URL is NOT the deployed endpoint. The deployment is still
pending; do not invent a URL/version or repeat earlier SDK/phone evidence.

## Persistence and receipt semantics

One application-process runtime serializes queue operations. Original JSON is
stored under its source/UID receipt ID in `rpos.android.queue.v1`. Re-acquisition
metadata does not replace queued data; changed record fields under the same
UID stop for review. Capacity is 100 entries / 5 MiB of serialized queue; full
or corrupt storage stops before upload rather than deleting evidence.

Queue and configuration are AES-256-GCM encrypted with a non-exportable Android
Keystore wrapping key, in the app's no-backup directory using AtomicFile and
readback. Fresh cipher IVs and filename-associated data protect each write.
The configured HMAC key is only decrypted in the app process when used; this
is not a hardware attestation or protection against an already-compromised
process/keyboard. Android Keystore/AtomicFile behavior still needs physical UAT.
Missing key/corruption fails closed without recreating an empty queue. Uninstall,
device loss or data clearing can destroy these local-only receipts/configuration;
do not use those actions for recovery. Backend Drive receipts remain separate.

Before each POST, a readback-verified local `outcome_pending` attempt is saved.
A lost response/restart keeps that original payload for safe backend readback.
A local post-response save failure also retains the pre-send intent. No successful
HTTP/redirect alone confirms anything. Exact schema, opaque receipt ID, stable
server record hash and nested delivery receipt are required. `staged` means
backend persistence only; **only nested delivery `confirmed`** is Notion success.
`unresolved`, reconciliation, migration and conflict states stop for review.
Backend enforcement remains authoritative for duplicate/uncertain writes.

The server record hash is deliberately not recomputed from Kotlin/Gson floats:
it is the versioned JS canonical-record contract, separate from Python v1 event
hashes. The local receipt ID uses the exact JS source/UID string convention.
The shared Unicode/nullable synthetic vector is tested by Kotlin and the actual
Apps Script intake core, including exact UTF-8 payload hash/HMAC compatibility.

## Network and execution boundaries

TLS only, cleartext disabled, exact approved Google host/path, bounded UTF-8
payload/response and 15s connect/30s read timeouts. Redirects are not followed
automatically. Only one 302/303 ContentService result redirect to the exact
`script.googleusercontent.com/macros/echo` origin/path is GET-fetched, without
the signed POST body or credentials. Login/foreign/further redirects, wrong
MIME and permanent access failures are blocked. 429/5xx/transport failures keep
the receipt with backoff. Errors do not echo bodies, keys, health data or URLs.

This is **user-initiated foreground delivery**, not unattended background
acquisition/scheduling. Reopening the activity only shows the persisted queue;
it does not silently transmit. No boot receiver/service/WorkManager scheduler,
new notification path or backend trigger is installed. One queue item is processed
per user sync to keep the result bounded. Android READ consent and upload of a
previously queued export are separate explicit actions.

## Verification and remaining operational gates

New synthetic JVM tests cover signing, storage-before-send, replay, fresh-signature
backoff, changed UID record, lost-response/restart, post-response local failure,
incorrect/HTML receipts, staging versus confirmation, conflicts, private-string
redaction, approved redirects, single HTTP attempts, byte limits and mock rejection.
Existing acquisition/selection tests remain intact. Node loads the same shared
vector into the actual `.gs` intake; Python/structural checks remain independent.

Next: compare the live scheduler source; review historical v1 receipts/alias
migration and binding; privately configure auth/receipt folder/access; deploy
the reviewed endpoint; build/sign the Samsung v0.5 APK with the retained private
certificate; then prove queue/restart/TLS handoff and real uncertain-write
recovery against one existing Fitness page. Missing reviews must not create new
sessions. Remaining Samsung error UAT, metric semantics and background-operation
scope are separate. Synthetic preparation does not close BR04/BR05/BR06 or raise
Registry BUILD 35%.

Official references:
- https://developer.android.com/privacy-and-security/keystore
- https://developer.android.com/privacy-and-security/cryptography
- https://developer.android.com/reference/android/util/AtomicFile
- https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()
- https://developers.google.com/apps-script/guides/content
