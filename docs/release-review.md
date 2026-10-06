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

## Actual release dependencies

1. Inspect the existing web-app deployment and its Execute as / Who has access
   configuration. The current cloud browser redirects to public documentation
   and Google sign-in returns 502; this is not proof about the owner's editor.
2. Run the read-only audit in the existing project; inspect and reconcile any
   missing or uncertain journal against retained evidence before cutover.
3. Recover compatible app signing material privately. Do not uninstall the
   existing app, discard its private queue or substitute a new key implicitly.
4. Accept Android SDK terms only with the owner's explicit agreement, and
   resolve the local Android build dependencies if a fresh Samsung build is
   needed. A mock/host test does not prove a Samsung APK build or signature.
5. Perform the reviewed maintenance cutover/deployment. Public endpoint access
   is a concrete permission decision; payload HMAC does not bypass that review.
6. Install a compatible Samsung APK and run authenticated selected-record
   delivery, persistent queue/restart and actual uncertain-write recovery.

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
mock build and tests. Samsung build/signing remains a separate dependency.
