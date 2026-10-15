const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const DS = '11111111-1111-1111-1111-111111111111';
const PAGE = '22222222-2222-2222-2222-222222222222';
const NOW = Date.parse('2030-01-02T03:04:05Z');
const CONTROL = 'rpos.bridge.automatic.pilot.control.v1';
const OP = fs.readFileSync(path.join(__dirname,'../apps-script/BridgeAutomaticPilot.gs.txt'),'utf8');
function fixture() {
  const values = {BRIDGE_INTAKE_ENABLED:'true', BRIDGE_SCHEDULER_BINDING_REVIEWED:'true',
    BRIDGE_DELIVERY_ENABLED:'false', BRIDGE_AUTOMATIC_ENABLED:'false', BRIDGE_MIGRATION_ENABLED:'false',
    BRIDGE_FITNESS_DATA_SOURCE_ID:DS, BRIDGE_RECEIPT_FOLDER_ID:'synthetic-private-folder',
    NOTION_TOKEN:'synthetic-private-token', BRIDGE_INTAKE_HMAC_KEY:'a'.repeat(64), OTHER:'retained',
    ['RPOS_BRIDGE_INTENT_'+'b'.repeat(64)]:'original-intake',
    ['RPOS_BRIDGE_DELIVERY_'+'c'.repeat(64)]:JSON.stringify({mode:'reviewed_existing_page',state:'confirmed'})};
  const timer=(id,handler,event='CLOCK')=>({getUniqueId:()=>id,getHandlerFunction:()=>handler,getEventType:()=>event});
  const originalTimer=timer('synthetic-legacy-timer','existingScheduler');
  const state={writes:[],logs:[],locks:0,releases:0,busy:false,fail:null,interfere:null,
    timers:[originalTimer],timerCreates:0,timerFailure:null};
  function mutation(k,v) {
    state.writes.push([k,v]);
    if(state.fail && state.fail(k,v))throw Error('synthetic-private-transport-error');
    values[k]=v;
    if(state.interfere)state.interfere(k,v,values);
  }
  const props={getProperty:k=>values[k]??null,getProperties:()=>({...values}),
    setProperty:mutation,setProperties:(obj,clear)=>{assert.equal(clear,false);for(const k of Object.keys(obj))mutation(k,obj[k]);}};
  class Clock extends Date { constructor(...a){super(...(a.length?a:[NOW]));}static now(){return NOW;} }
  const c=vm.createContext({Date:Clock,JSON,Number,PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({tryLock:()=>{state.locks++;return !state.busy;},releaseLock:()=>{state.releases++;}})},
    Logger:{log:s=>state.logs.push(s)},RPOS:{fitnessDataSourceId:DS},rposBridgeAutomaticReceipt_:()=>{throw Error('must not deliver');},
    rposBridgeRunAutomaticPending:()=>{throw Error('must not deliver');},
    rposBridgeUuid_:s=>{if(!/^[a-f0-9-]{36}$/.test(s||''))throw Error('uuid');return s.toLowerCase();},
    rposBridgeTime_:s=>{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s||''))throw Error('time');const t=Date.parse(s);if(!Number.isFinite(t))throw Error('time');return t;},
    DriveApp:{getFolderById:()=>{throw Error('must not open Drive');}},UrlFetchApp:{fetch:()=>{throw Error('must not contact Notion');}},
    ScriptApp:{EventType:{CLOCK:'CLOCK'},getProjectTriggers:()=>[...state.timers],newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>{
      assert.equal(handler,'rposBridgeRunAutomaticPending');assert.equal(n,5);state.timerCreates++;
      const t=timer('synthetic-pilot-timer',handler);state.timers.push(t);
      if(state.timerFailure)throw Error('synthetic-lost-create-response');return t;
    }})})})}});
  vm.runInContext(OP,c);
  return {c,values,state,timer,run:()=>JSON.parse(JSON.stringify(c.rposBridgeEnableAutomaticPilot())),
    status:()=>JSON.parse(JSON.stringify(c.rposBridgeAutomaticPilotStatus()))};
}
test('loading the owner operator does not access services or mutate anything',()=>{
  const c=vm.createContext({PropertiesService:{getScriptProperties:()=>{throw Error('load service');}}});
  vm.runInContext(OP,c);assert.equal(typeof c.rposBridgeEnableAutomaticPilot,'function');
});
test('approved first pilot preserves originals and configures future cutoff/quota before activation',()=>{
  const f=fixture(),before={...f.values},r=f.run();
  assert.equal(r.status,'pilot_active');assert.equal(r.max_new,3);assert.equal(r.mode,'pilot');
  assert.equal(r.start_at,new Date(NOW).toISOString());assert.equal(r.flags.migration,false);
  for(const k of Object.keys(before).filter(k=>!['BRIDGE_DELIVERY_ENABLED','BRIDGE_AUTOMATIC_ENABLED','BRIDGE_MIGRATION_ENABLED'].includes(k)))assert.equal(f.values[k],before[k]);
  const activation=f.state.writes.filter(([,v])=>v==='true');
  assert.deepEqual(activation.map(([k])=>k),['BRIDGE_AUTOMATIC_ENABLED','BRIDGE_DELIVERY_ENABLED']);
  assert.equal(r.unrelated_properties_unchanged,true);assert.equal(f.state.releases,1);
  assert.equal(r.retry_clock_created,true);assert.equal(r.retry_clock_count,1);assert.equal(r.legacy_triggers_unchanged,true);
  assert.equal(f.state.timers[0].getHandlerFunction(),'existingScheduler');
});
test('repeated activation is zero-write and does not replace the immutable cutoff',()=>{
  const f=fixture();f.run();const old={...f.values},writes=f.state.writes.length;
  const r=f.run();assert.equal(r.activation_changed,false);assert.deepEqual(f.values,old);assert.equal(f.state.writes.length,writes);
  assert.equal(f.state.timerCreates,1);
});
test('status is read-only, records flags/quota and never exposes tokens, identities or receipts',()=>{
  const f=fixture();f.run();const n=f.state.writes.length,r=f.status(),s=JSON.stringify(r);
  assert.equal(r.read_only,true);assert.equal(r.properties_unchanged,true);assert.equal(r.triggers_unchanged,true);assert.equal(f.state.writes.length,n);
  for(const secret of [DS,f.values.NOTION_TOKEN,f.values.BRIDGE_INTAKE_HMAC_KEY,'original-intake','synthetic-private-folder'])assert.equal(s.includes(secret),false);
});
for(const [name,change] of [
  ['binding mismatch',f=>f.values.BRIDGE_FITNESS_DATA_SOURCE_ID=PAGE],
  ['intake off',f=>f.values.BRIDGE_INTAKE_ENABLED='false'],
  ['binding unreviewed',f=>f.values.BRIDGE_SCHEDULER_BINDING_REVIEWED='false'],
  ['missing token',f=>delete f.values.NOTION_TOKEN],
  ['missing HMAC',f=>delete f.values.BRIDGE_INTAKE_HMAC_KEY],
  ['missing runtime',f=>delete f.c.rposBridgeAutomaticReceipt_],
  ['missing retry worker',f=>delete f.c.rposBridgeRunAutomaticPending],
  ['migration on',f=>f.values.BRIDGE_MIGRATION_ENABLED='true'],
  ['continuous mode',f=>f.values.BRIDGE_AUTOMATIC_MODE='continuous'],
  ['larger quota',f=>f.values.BRIDGE_AUTOMATIC_MAX_NEW='4'],
  ['foreign cutoff',f=>f.values.BRIDGE_AUTOMATIC_START_AT='2029-01-01T00:00:00Z'],
  ['malformed journal',f=>f.values['RPOS_BRIDGE_DELIVERY_'+'d'.repeat(64)]='bad'],
  ['partial foreign activation',f=>f.values.BRIDGE_DELIVERY_ENABLED='true']
])test('unsafe '+name+' stops with zero changes',()=>{
  const f=fixture();change(f);const original={...f.values};
  assert.equal(f.run().status,'review_required');assert.deepEqual(f.values,original);assert.equal(f.state.writes.length,0);
  assert.equal(f.state.timerCreates,0);
});
test('busy lock never reads or changes properties and is not released by non-owner',()=>{
  const f=fixture();f.state.busy=true;assert.equal(f.run().status,'busy');assert.equal(f.state.writes.length,0);assert.equal(f.state.releases,0);
});
test('a partial write error disables both flags, retains originals and resumes the same owned cutoff',()=>{
  const f=fixture();let fail=true;f.state.fail=(k,v)=>k==='BRIDGE_DELIVERY_ENABLED'&&v==='true'&&fail?(fail=false,true):false;
  const r=f.run();assert.equal(r.status,'activation_stopped_review_required');assert.equal(r.delivery_disabled_verified,true);
  assert.equal(f.values.BRIDGE_DELIVERY_ENABLED,'false');assert.equal(f.values.BRIDGE_AUTOMATIC_ENABLED,'false');
  const cut=f.values.BRIDGE_AUTOMATIC_START_AT;
  assert.equal(f.run().status,'pilot_active');assert.equal(f.values.BRIDGE_AUTOMATIC_START_AT,cut);
});
test('changing an unrelated property stops activation without overwriting the concurrent value',()=>{
  const f=fixture();f.state.interfere=(k,v,a)=>{if(k==='BRIDGE_AUTOMATIC_MODE')a.OTHER='concurrent-update';};
  assert.equal(f.run().status,'activation_stopped_review_required');assert.equal(f.values.OTHER,'concurrent-update');
  assert.equal(f.values.BRIDGE_DELIVERY_ENABLED,'false');assert.equal(f.values.BRIDGE_AUTOMATIC_ENABLED,'false');
});
test('an unacknowledged rollback reports unresolved rather than claiming flags are OFF',()=>{
  const f=fixture();f.state.fail=(k,v)=>k==='BRIDGE_DELIVERY_ENABLED'&&v==='false';
  const r=f.run();assert.equal(r.status,'activation_unresolved');assert.equal(r.delivery_disabled_verified,false);
});
test('attempting and confirmed automatic intents both consume quota; operator never resets them',()=>{
  const f=fixture();f.run();
  for(let i=0;i<3;i++){const id=String(i).repeat(64);f.values['RPOS_BRIDGE_DELIVERY_'+id]=JSON.stringify({mode:'automatic_new_page',receipt_id:id,
    record_hash:'e'.repeat(64),state:i===0?'attempting':'confirmed',...(i===0?{}:{page_id:PAGE})});}
  const writes=f.state.writes.length,r=f.run();assert.equal(r.status,'pilot_full_review_required');
  assert.equal(r.automatic_attempting,1);assert.equal(r.automatic_confirmed,2);assert.equal(f.state.writes.length,writes);
});
test('prior automatic intents block a fresh activation and are preserved',()=>{
  const f=fixture(),id='d'.repeat(64);f.values['RPOS_BRIDGE_DELIVERY_'+id]=JSON.stringify({mode:'automatic_new_page',receipt_id:id,
    record_hash:'e'.repeat(64),state:'attempting'});const before={...f.values};
  assert.equal(f.run().status,'review_required');assert.deepEqual(f.values,before);assert.equal(f.state.writes.length,0);
});
test('a lost trigger-create response retains the owned cutoff and reuses the single clock on retry',()=>{
  const f=fixture();f.state.timerFailure=true;
  assert.equal(f.run().status,'activation_stopped_review_required');assert.equal(f.values.BRIDGE_DELIVERY_ENABLED,'false');
  f.state.timerFailure=false;const cut=f.values.BRIDGE_AUTOMATIC_START_AT;
  assert.equal(f.run().status,'pilot_active');assert.equal(f.values.BRIDGE_AUTOMATIC_START_AT,cut);assert.equal(f.state.timerCreates,1);
});
test('duplicate or non-clock retry handlers stop without deleting or replacing existing timers',()=>{
  for(const event of ['CLOCK','ON_EDIT']){
    const f=fixture();f.state.timers.push(f.timer('existing-pending','rposBridgeRunAutomaticPending',event));
    if(event==='CLOCK')f.state.timers.push(f.timer('duplicate','rposBridgeRunAutomaticPending'));
    const before=[...f.state.timers];assert.equal(f.run().status,'review_required');
    assert.deepEqual(f.state.timers,before);assert.equal(f.state.writes.length,0);assert.equal(f.state.timerCreates,0);
  }
});
