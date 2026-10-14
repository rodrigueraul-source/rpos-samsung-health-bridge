# Controlled authenticated staging pilot

The 06-Oct phone screenshots show real Exercise selection after consent in the
delivery interface: 89 records and 11 segments in the selected workout. They
show an empty queue and do not expose the package/version header. Installation
and READ are accepted in the context of the delivered new APK, with that
identity limitation; no authenticated send, restart or Notion success is proved.
Do not repeat the accepted older v0.4 gates.

## Concrete next action

Install `apps-script/BridgePilotOperator.gs.txt` as **BridgePilotOperator.gs**
in the existing Apps Script project. This file is deliberately separate from
the unchanged seven-module versioned runtime. Its installation does not activate
anything and does not require replacing the existing deployed endpoint.
After specific approval to enable authenticated staging, run
`rposBridgeEnableIntakePilot`. It checks configuration and a fresh read-only
audit, takes Script Lock, compares journal inventory and verifies the legacy
binding again before changing **only BRIDGE_INTAKE_ENABLED** to true. A failed
or concurrent-change check stops for review. Reports contain no secret values.
Delivery, migration and scheduler binding stay OFF; the existing daily capture
writer continues unchanged. This is a limited pilot, not full Bridge activation.

The existing endpoint remains owner-executed with the approved access setting.
Requests require the existing dedicated HMAC and a fresh signed timestamp;
only authenticated exports are saved in the already-private receipt folder.
No Notion writes or new triggers are performed by this operator. Activating
this capability needs action-time confirmation under the browser policy for
security-sensitive access expansion. Earlier approval of an OFF deployment
does not itself approve switching intake ON.

## One phone batch after staging is enabled

1. CONFIGURE DELIVERY: enter the approved /exec endpoint and existing
   BRIDGE_INTAKE_HMAC_KEY privately on the phone. Obtain that value from the
   same project's Script Properties; never send it in chat or a screenshot.
   Do not use NOTION_TOKEN, IFTTT_KEY or the APK-signing backup password.
2. Select the already-read workout and QUEUE SELECTED + SYNC ONE. Expected
   state is staged: durable backend receipt, **not Notion confirmed**.
3. Close/reopen the app without uninstalling or clearing data. The queued
   receipt must remain. CHECK PENDING RECEIPTS when due; resend must reuse its
   original receipt and leave only one matching private Drive file.
4. Return one screenshot of the non-secret queue/result and report whether
   the receipt survived reopening. No repeated copy/paste export is required.

AI then retrieves the authenticated full record privately, verifies fields,
checks the existing destination and prepares migration/cutover. A screenshot
alone is insufficient to assign a new canonical UID or metrics in Fitness.
Uncertain transport does not justify deleting a queue or backend intent.
Forced-process/OS-restart and true lost-response recovery remain separate from
ordinary activity reopening until actually observed.

## Rollback and boundaries

Setting intake OFF stops acceptance of subsequent requests. Preserve every
receipt and intent and reconcile any in-flight request before further action.
The pilot operator never clears journals, rolls back an uncertain write,
changes credentials, alters the scheduler wrapper or turns delivery ON.
Exact app source and APK hashes remain those of ca91da4; this operator does
not change the supplied Android binary. BUILD35% stays the administrative
baseline until an evidence-based whole-project rebaseline is agreed.
