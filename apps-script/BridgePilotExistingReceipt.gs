/* Owner-only reviewed pilot receipt reconciliation. See PR #10. Not installed automatically. */


/*
 * OWNER-REVIEWED ONE-RECEIPT PILOT RECONCILIATION — DRAFT, NOT INSTALLED.
 * No new page, no migration, no flag/quota/cutoff changes, no retry override.
 * Requires independent review + explicit deployment authorization before use.
 * Uses the canonical coordinator's verified attempting -> evidence -> confirmed
 * journal with response-loss recovery. Never manufactures an Android ACK.
 */
function rposBridgeReviewedPilotExisting_(deps, target) {
  const result = {schema_version:'rpos.bridge.reviewed.pilot.v1',
    status:'review_required', notion_confirmed:false, activation_flags_unchanged:false};
  try {
    if (!deps.flagsOk()) { result.status='flags_require_review'; return result; }
    if (!/^[a-f0-9]{64}$/.test(target.receipt_id) ||
        !/^[a-f0-9]{64}$/.test(target.record_hash) ||
        !rposBridgeText_(target.uid, 2000) ||
        rposBridgeUuid_(target.page_id) !== target.page_id) {
      result.status='review_required'; return result;
    }
    const found=deps.store.find(target.receipt_id);
    if (found.length!==1) { result.status='storage_unresolved'; return result; }
    const stored=found[0].value;
    rposBridgeVerifyStored_(stored, target.receipt_id, target.record_hash, deps);
    const intake=deps.store.getIntent(target.receipt_id);
    if (!intake || intake.state!=='staged' ||
        intake.receipt_id!==target.receipt_id ||
        intake.record_hash!==target.record_hash ||
        intake.file_id!==found[0].id ||
        stored.export.record.uid!==target.uid ||
        stored.record_hash!==target.record_hash) {
      result.status='storage_unresolved'; return result;
    }
    const ids=deps.remote.findUid('samsung_health', target.uid);
    if (ids.length!==1 || ids[0]!==target.page_id) {
      result.status='needs_reconciliation'; return result;
    }
    const page=deps.remote.read(target.page_id);
    if (page.source!=='samsung_health' || page.uid!==target.uid ||
        page.legacy ||
        (page.evidence &&
          (page.evidence.receipt_id!==target.receipt_id ||
           page.evidence.record_hash!==target.record_hash))) {
      result.status='delivery_conflict'; return result;
    }
    const prior=deps.journal.get(target.receipt_id);
    if (prior && (prior.receipt_id!==target.receipt_id ||
        prior.record_hash!==target.record_hash ||
        prior.page_id!==target.page_id ||
        ['attempting','confirmed'].indexOf(prior.state)<0)) {
      result.status='delivery_conflict'; return result;
    }
    if (!prior && !deps.ownerExportMatches(page.id, stored)) {
      result.status='owner_export_requires_review'; return result;
    }
    // Fixed receipt only. The existing core uses a lock and only writes
    // to the unique verified page, then recovers an uncertain response.
    const out=rposBridgeCanonicalDelivery_({
      flagsOk:deps.flagsOk,sha256:deps.sha256,lock:deps.lock,store:deps.store,
      journal:deps.journal,migrationJournal:deps.migrationJournal,
      listReceipts:function(){return [target.receipt_id];},
      remote:deps.remote,
      ownerExportMatches:deps.ownerExportMatches,
      selectPage:function(id){
        if(id!==target.page_id)rposBridgeFailure_('delivery_conflict');
        deps.selectPage(id);
      }});
    return Object.assign(result,out,{
      schema_version:'rpos.bridge.reviewed.pilot.v1',
      activation_flags_unchanged:deps.flagsOk()});
  } catch(error) {
    result.status=['flags_require_review','delivery_conflict','storage_unresolved']
      .indexOf(error.bridgeCode)>=0?error.bridgeCode:'review_required';
    return result;
  }
}

/*
 * Fixed owner-approved target; introducing this function in GitHub does not
 * install or run it in the live Apps Script project.
 */
function rposBridgeFinalizeReviewedPilotExisting() {
  const target={
    receipt_id:'3ef302ceb21fac2cc3d70a8ef6c57e042c11a542c355ac6decf682027ad7e42d',
    record_hash:'c97763a811689c609831795faeb7d22b57dd0ffdfb5c0be7c4779c251ceb5f16',
    uid:'7390a0ae-3905-472f-b205-badb3a3eb73e',
    page_id:'3fd06f67-e0fc-8131-b076-d95502cad493'
  };
  let report={schema_version:'rpos.bridge.reviewed.pilot.v1',
    status:'not_configured',notion_confirmed:false};
  try {
    const props=PropertiesService.getScriptProperties();
    const names=['BRIDGE_INTAKE_ENABLED','BRIDGE_SCHEDULER_BINDING_REVIEWED',
      'BRIDGE_DELIVERY_ENABLED','BRIDGE_AUTOMATIC_ENABLED',
      'BRIDGE_MIGRATION_ENABLED','BRIDGE_AUTOMATIC_MODE',
      'BRIDGE_AUTOMATIC_MAX_NEW','BRIDGE_AUTOMATIC_START_AT',
      'BRIDGE_FITNESS_DATA_SOURCE_ID','BRIDGE_RECEIPT_FOLDER_ID'];
    const before=names.map(function(name){return props.getProperty(name);});
    const source=rposBridgeUuid_(before[8]);
    function flagsOk(){
      return before.slice(0,7).join('|')==='true|true|true|true|false|pilot|3' &&
        before[7] && before[9] &&
        typeof RPOS!=='undefined' &&
        source===rposBridgeUuid_(RPOS.fitnessDataSourceId) &&
        names.every(function(name,index){return props.getProperty(name)===before[index];});
    }
    if(!flagsOk()){report.status='flags_require_review';Logger.log(JSON.stringify(report));return report;}
    const originalHttp=rposBridgeCanonicalHttp_(props.getProperty('NOTION_TOKEN'));
    let selectedPage=null;
    const http={request:function(method,path,body){
      if(!flagsOk())rposBridgeFailure_('flags_require_review');
      const readable=method==='GET' && /^\/(data_sources|pages|blocks)\//.test(path);
      const query=method==='POST' && path==='/data_sources/'+source+'/query';
      const pagePatch=method==='PATCH' && selectedPage===target.page_id &&
        path==='/pages/'+target.page_id &&
        body && body.properties &&
        Object.keys(body.properties).every(function(k){
          return k==='Source'||k==='Source Record ID';
        });
      const blockPatch=method==='PATCH' && selectedPage===target.page_id &&
        path==='/blocks/'+target.page_id+'/children' && body &&
        Array.isArray(body.children) && body.children.length===1 &&
        body.children[0].type==='code';
      if(!(readable||query||pagePatch||blockPatch))
        rposBridgeFailure_('delivery_conflict');
      return originalHttp.request(method,path,body);
    }};
    const store=rposBridgeDriveStore_(before[9],props);
    const base=rposBridgeNotionPort_(http,source,rposBridgeSha_);
    const remote=Object.assign({},base,{
      findUid:function(origin,uid){
        if(origin!=='samsung_health'||uid!==target.uid)
          rposBridgeFailure_('delivery_conflict');
        const found=base.findUid(origin,uid);
        if(found.length!==1||found[0]!==target.page_id)
          rposBridgeFailure_('needs_reconciliation');
        return found;
      },
      read:function(id){
        if(rposBridgeUuid_(id)!==target.page_id)
          rposBridgeFailure_('delivery_conflict');
        return base.read(id);
      },
      write:function(id,prepared){
        if(id!==target.page_id||!flagsOk())
          rposBridgeFailure_('delivery_conflict');
        base.write(id,prepared);
      }
    });
    report=rposBridgeReviewedPilotExisting_({
      flagsOk:flagsOk,sha256:rposBridgeSha_,lock:LockService.getScriptLock(),
      store:store,journal:rposBridgeCanonicalJournal_(props,'RPOS_BRIDGE_DELIVERY_'),
      migrationJournal:rposBridgeCanonicalJournal_(props,'RPOS_BRIDGE_MIGRATION_'),
      remote:remote,
      ownerExportMatches:function(id,stored){
        return id===target.page_id && rposBridgeOwnerExportMatches_(http,id,stored);
      },
      selectPage:function(id){selectedPage=id;}
    },target);
  }catch(error) {
    report.status=error.bridgeCode==='flags_require_review'?
      'flags_require_review':'review_required';
  }
  Logger.log(JSON.stringify(report));
  return report;
}
