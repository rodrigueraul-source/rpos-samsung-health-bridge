/* Owner-only transition after reviewed pilot, canonical recovery and Android ACK.
 * One property write only. No delivery, queue reset, deployment or trigger edits.
 * Secrets stay inside Script Properties and are never included in the report.
 */
function rposBridgeContinuousControl_(deps, promote) {
  const modeKey = 'BRIDGE_AUTOMATIC_MODE';
  const report = {schema_version:'rpos.bridge.continuous.control.v1',
    status:'review_required', activation_changed:false, health_writes:false};
  let locked=false, changed=false, originalMode=null;
  function stable(all, omitMode) {
    return JSON.stringify(Object.keys(all).sort().filter(function(k) {
      return !omitMode || k!==modeKey;
    }).map(function(k) { return [k,all[k]]; }));
  }
  function clockSnapshot() {
    return deps.clocks().slice().sort(function(a,b) {return a.id.localeCompare(b.id);});
  }
  try {
    locked=deps.lock.tryLock(1000);
    if(!locked) {report.status='busy';return report;}
    const before=deps.props.getProperties(), baseline=stable(before,false);
    const clocks=clockSnapshot(), pendingClocks=clocks.filter(function(t) {
      return t.handler==='rposBridgeRunAutomaticPending';
    });
    originalMode=before[modeKey];
    report.mode=originalMode;
    report.start_at=before.BRIDGE_AUTOMATIC_START_AT || null;
    report.flags={intake:before.BRIDGE_INTAKE_ENABLED==='true',
      binding_reviewed:before.BRIDGE_SCHEDULER_BINDING_REVIEWED==='true',
      delivery:before.BRIDGE_DELIVERY_ENABLED==='true',
      automatic:before.BRIDGE_AUTOMATIC_ENABLED==='true',
      migration:before.BRIDGE_MIGRATION_ENABLED==='true'};
    const cutoff=Date.parse(before.BRIDGE_AUTOMATIC_START_AT || '');
    if(!deps.bindingOk(before) || !report.flags.intake || !report.flags.binding_reviewed ||
      !report.flags.delivery || !report.flags.automatic || before.BRIDGE_MIGRATION_ENABLED!=='false' ||
      ['pilot','continuous'].indexOf(originalMode)<0 || before.BRIDGE_AUTOMATIC_MAX_NEW!=='3' ||
      !Number.isFinite(cutoff) || cutoff>deps.now() ||
      pendingClocks.length!==1 || !pendingClocks[0].clock) return report;
    report.retry_clock_count=1;
    const deliveryKeys=Object.keys(before).filter(function(k) {return /^RPOS_BRIDGE_DELIVERY_[a-f0-9]{64}$/.test(k);});
    if(deliveryKeys.length>1000) return report;
    let automaticConfirmed=0, attempting=0;
    const confirmed={};
    for(let i=0;i<deliveryKeys.length;i++) {
      const key=deliveryKeys[i], id=key.slice('RPOS_BRIDGE_DELIVERY_'.length), j=JSON.parse(before[key]);
      if(!j || j.receipt_id!==id || !/^[a-f0-9]{64}$/.test(j.record_hash || '') ||
        ['attempting','confirmed'].indexOf(j.state)<0 ||
        (j.state==='confirmed' && !deps.idValid(j.page_id))) return report;
      if(j.state==='attempting') attempting++;
      else {confirmed[id]=true;if(j.mode==='automatic_new_page') automaticConfirmed++;}
    }
    report.automatic_confirmed=automaticConfirmed;
    report.attempting=attempting;
    if(attempting || automaticConfirmed<3 || (originalMode==='pilot' && automaticConfirmed!==3)) return report;
    const intents=Object.keys(before).filter(function(k) {return /^RPOS_BRIDGE_INTENT_[a-f0-9]{64}$/.test(k);});
    if(intents.length>1000) return report;
    const unresolved=intents.filter(function(k) {return !confirmed[k.slice('RPOS_BRIDGE_INTENT_'.length)];});
    if(unresolved.length>10) return report;
    let futurePending=0;
    for(let i=0;i<unresolved.length;i++) {
      const key=unresolved[i], id=key.slice('RPOS_BRIDGE_INTENT_'.length), intent=JSON.parse(before[key]);
      const found=deps.store.find(id);
      if(found.length!==1 || intent.state!=='staged' || intent.receipt_id!==id ||
        intent.file_id!==found[0].id || intent.record_hash!==found[0].value.record_hash) return report;
      deps.verify(found[0].value,id,intent.record_hash);
      const start=Date.parse(found[0].value.export.record.start_time);
      if(!Number.isFinite(start)) return report;
      if(start>=cutoff) futurePending++;
    }
    report.unconfirmed_future_receipts=futurePending;
    report.properties_unchanged=baseline===stable(deps.props.getProperties(),false);
    report.triggers_unchanged=JSON.stringify(clocks)===JSON.stringify(clockSnapshot());
    if(!report.properties_unchanged || !report.triggers_unchanged) return report;
    if(futurePending) {report.status=originalMode==='continuous'?'continuous_pending_review':'review_required';return report;}
    if(!promote || originalMode==='continuous') {
      report.status=originalMode==='continuous'?'continuous_active':'ready_to_promote';
      report.read_only=true;return report;
    }
    changed=true;
    deps.props.setProperty(modeKey,'continuous');
    const after=deps.props.getProperties();
    report.unrelated_properties_unchanged=stable(before,true)===stable(after,true);
    report.triggers_unchanged=JSON.stringify(clocks)===JSON.stringify(clockSnapshot());
    report.cutoff_preserved=after.BRIDGE_AUTOMATIC_START_AT===before.BRIDGE_AUTOMATIC_START_AT;
    if(after[modeKey]!=='continuous' || !report.unrelated_properties_unchanged ||
      !report.triggers_unchanged || !report.cutoff_preserved) throw new Error('readback');
    report.mode='continuous';report.status='continuous_active';
    report.activation_changed=true;report.properties_unchanged=false;
    return report;
  } catch(ignore) {
    report.status='review_required';
    if(changed) {
      try {
        deps.props.setProperty(modeKey,originalMode);
        report.rollback_verified=deps.props.getProperty(modeKey)===originalMode;
      } catch(ignored) {report.rollback_verified=false;}
      report.status=report.rollback_verified?'promotion_rolled_back':'promotion_unresolved';
    }
    return report;
  } finally {if(locked) {try {deps.lock.releaseLock();} catch(ignore) {}}}
}

function rposBridgeContinuousOwnerControl_(promote) {
  const props=PropertiesService.getScriptProperties();
  const result=rposBridgeContinuousControl_({props:props,lock:LockService.getScriptLock(),
    now:function() {return Date.now();},
    bindingOk:function(all) {
      return typeof RPOS!=='undefined' && typeof rposBridgeAutomaticReceipt_==='function' &&
        typeof rposBridgeRunAutomaticPending==='function' &&
        rposBridgeUuid_(all.BRIDGE_FITNESS_DATA_SOURCE_ID)===rposBridgeUuid_(RPOS.fitnessDataSourceId) &&
        !!all.BRIDGE_RECEIPT_FOLDER_ID && !!all.NOTION_TOKEN &&
        /^[a-f0-9]{64}$/.test(all.BRIDGE_INTAKE_HMAC_KEY || '');
    },
    idValid:function(id) {try {return rposBridgeUuid_(id)===id;} catch(ignore) {return false;}},
    clocks:function() {return ScriptApp.getProjectTriggers().map(function(t) {
      return {id:t.getUniqueId(),handler:t.getHandlerFunction(),clock:t.getEventType()===ScriptApp.EventType.CLOCK};
    });},
    store:{find:function(id) {return rposBridgeDriveStore_(props.getProperty('BRIDGE_RECEIPT_FOLDER_ID'),props).find(id);}},
    verify:function(stored,id,hash) {rposBridgeVerifyStored_(stored,id,hash,{sha256:rposBridgeSha_});}
  },promote);
  Logger.log(JSON.stringify(result));return result;
}
function rposBridgeContinuousStatus() {return rposBridgeContinuousOwnerControl_(false);}
function rposBridgePromoteReviewedContinuous() {return rposBridgeContinuousOwnerControl_(true);}
