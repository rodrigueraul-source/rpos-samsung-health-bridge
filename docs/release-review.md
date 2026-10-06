# Bridge release review — 06-Oct-2026

WBS V2.0 component: Samsung Health Bridge. The companion pending-work matrix
lists BR01–BR09 (37 effort points). Those points are not total-project weights;
they cannot recalculate the official BUILD35 baseline or establish 80%.

## Autonomous batch and acceptance

| Work | Pending package | Acceptance evidence |
| --- | --- | --- |
| Reconcile WBS, Registry, Log and remote branch | BR08 | Current scope and accepted device checkpoints retained |
| Inspect installed preflight report | BR01/BR02 | Existing local pass; all four flags off |
| Build one redacted read-only operational audit | BR02/BR03 | No mutation port; bounded receipts, lock and journals |
| Verify partial writes and conflicting aliases are rejected | BR02/BR03/BR06 | Meaningful synthetic fault tests |
| Generate a reproducible install bundle | BR01 | Seven modules, duplicate-entry and load checks |
| Verify metrics from the two accepted exports | BR09 | Null totals, segment units and independent screenshot values retained |
| Review Kotlin queue/TLS/response and SDK pin | BR04/BR07 | Host/CI evidence distinguished from physical runtime |
| Verify exact final source through CI | BR01–BR04 | Final branch head and check conclusions |
| Record completed evidence against current state | BR08 | Registry/Log updated without synthetic operational closure |
| Prepare one live handoff | BR05/BR06 | Deployment access, signing and physical UAT identified |

Planning allowance: 140–180 minutes for the independent batch. The work may
finish sooner or stop at a dependency. Token balance is not exposed here;
this is a time estimate, not a promise about token consumption or availability.

## One read-only operator

The generated `apps-script/BridgeRuntime.gs.txt` includes
`rposBridgeReadinessAudit`. Updating only that existing runtime file leaves the
owner's current `createGymCapturePage_` route on its temporary legacy path.
Do not change the wrapper to make the audit pass.

After the installed file is compared with the bundle, run the single operator
from the editor. It reads existing intent keys, up to four staged receipts,
their confirmed migration/delivery journals, exact Notion UID/alias matches,
fresh evidence snapshots and confirmed scheduler journals. It holds the same
Script Lock and refuses to start with activation flags enabled/malformed.

The HTTP boundary permits GET and data-source query POST only. The operator
paces requests at least 350 ms apart and stops new reads after three minutes.
The report contains status, counts and the current wrapper route; no keys, UIDs, records,
page IDs, raw property values or exception messages. The audit does not repair
journals, migrate anything, create a receipt/page, enable a flag, notify anyone,
or install a trigger. Loading the bundle has no service side effects.

An empty inventory, more than four receipts, oversized journal inventory,
time-budget exhaustion, uncertain journal, remote edit, UID conflict, changed
record, missing migration journal or alias conflict does not receive a pass.
All statuses keep `ready_for_activation=false`.

The report intentionally leaves inherited Drive permissions, deployment/access,
physical transport/recovery and writers outside this project unverified.
Exact-wrapper detection recognizes only the reviewed legacy and Bridge
wrappers; other formatting or bodies require source review, never execution.

## Actual release dependencies — current 06-Oct checkpoint

1. **Publication/access complete:** version1 published09:40 under owner approval
   09:33, owner execution/anonymous access. External empty POST HTTP200 JSON
   disabled PASS. Earlier sign-in502 is resolved. All activation flags OFF.
2. **Read-only audit accepted:** owner09:22 live_reads_pass_activation_not_approved;
   two receipts/two confirmed migration journals/fourteen aliases; legacy wrapper.
   Full live source-byte comparison and writers outside this project remain open.
3. **Signing alternative prepared:** old v0.4 certificate identified but its
   private key unavailable. The dedicated signed delivery package coexists with
   the old app, whose data/queue are preserved. New signing recovery retained
   privately; no implicit substitute certificate for the old application ID.
4. **SDK/build complete:** license approved09:47 and installed SDK36/build-tools36;
   matching JDK17.0.20. Both Samsung/delivery release builds and release lint-vital
   PASS; 29 actual Android Gradle unit cases PASS. Signed artifact verification
   and certificate/package/Samsung provider/16 KiB alignment PASS. Details in
   `android-delivery-build-evidence.md`. Device operation remains unproven.
5. **Cutover open:** review live bytes, scheduler binding, effective receipt
   access and single writer before changing flags/wrapper. Six existing owner
   time triggers observed; no new trigger added.
6. **Physical handoff open:** install the new separate Samsung package; grant
   its own Exercise READ consent, configure auth privately, and prove queue,
   authenticated delivery, restart and actual uncertain-write recovery.

BR05/BR06 cannot close from documentation or synthetic tests. BR07's remaining
physical Samsung error cases also remain open. Accepted acquisition, two real
UIDs, denied/restored consent and assisted reconciliation do not need repeating.
BR09's semantic mapping is defined separately in `metric-semantics.md`.

## Local verification evidence

The final bundle passes 119 JavaScript cases (21 new read-only audit cases),
46 Python cases and both structural validators. The host JVM run passes 29
JUnit cases covering export/selection, durable queue and TLS/response handling.
That run uses the existing Gradle 8.13 Kotlin 2.0.21 compiler, JDK 17, JUnit
4.13.2 and the exact production Gson 2.13.2 artifact from Maven Central. It
does not compile AndroidBridgeRuntime/MainActivity or the Samsung provider,
use Android Keystore, build/sign an APK, or establish physical recovery.
The Android project uses Kotlin 2.3.20; final-head CI independently checks its
mock build and tests. The fresh real Samsung/delivery build and signing now pass independently;
physical delivery/recovery still remain separate gates.
