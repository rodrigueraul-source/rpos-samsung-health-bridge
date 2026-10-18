'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/BridgeContinuousControl.gs'),'utf8'),context);
const run=context.rposBridgeContinuousControl_;
const uid='00000000-0000-4000-8000-000000000001';
function fixture() {
  const values={BRIDGE_INTAKE_ENABLED:'true',BRIDGE_SCHEDULER_BINDING_REVIEWED:'true',
    BRIDGE_DELIVERY_ENABLED:'true',BRIDGE_AUTOMATIC_ENABLED:'true',BRIDGE_MIGRATION_ENABLED:'false',
    BRIDGE_AUTOMATIC_MODE:'pilot',BRIDGE_AUTOMATIC_MAX_NEW:'3',
    BRIDGE_AUTOMATIC_START_AT:'2026-01-01T00:00:00.000Z',NOTION_TOKEN:'synthetic-secret',
    RPOS_BRIDGE_AUTOMATIC_RETRY_example:'preserve blocked retry evidence'};
  for(let i=1;i<=3;i++) {
    const id=String(i).repeat(64);
    values['RPOS_BRIDGE_DELIVERY_'+id]=JSON.stringify({receipt_id:id,record_hash:'a'.repeat(64),
      state:'confirmed',page_id:uid,mode:'automatic_new_page'});
    values['RPOS_BRIDGE_INTENT_'+id]=JSON.stringify({state:'staged',receipt_id:id});
  }
  // More than 50 properties, including private values, must remain untouched.
  for(let i=0;i<100;i++)values['UNRELATED_'+i]='private-'+i;
  const f={values,writes:[],released:0,reads:0};
  f.deps={props:{getProperties(){f.reads++;if(f.onRead)f.onRead(f.reads);return {...values};},
    getProperty(k){return values[k];},setProperty(k,v){f.writes.push([k,v]);values[k]=v;if(f.onSet)f.onSet(k,v);}},
    lock:{tryLock(){return true;},releaseLock(){f.released++;}},
    now:()=>Date.parse('2026-10-18T00:00:00Z'),bindingOk:()=>true,idValid:id=>id===uid,
    clocks:()=>[{id:'timer1',handler:'rposBridgeRunAutomaticPending',clock:true},
      {id:'legacy',handler:'sendMentalDropAM',clock:true}],
    store:{find:()=>[]},verify:()=>{}};
  return f;
}
test('one-key promotion preserves all properties including >50 keys and blocked evidence',()=>{
  const f=fixture(),before={...f.values},r=run(f.deps,true);
  assert.equal(r.status,'continuous_active');assert.equal(r.cutoff_preserved,true);
  assert.equal(r.unrelated_properties_unchanged,true);assert.equal(r.triggers_unchanged,true);
  assert.deepEqual(f.writes,[['BRIDGE_AUTOMATIC_MODE','continuous']]);
  assert.deepEqual(f.values,{...before,BRIDGE_AUTOMATIC_MODE:'continuous'});
  assert.equal(f.released,1);assert.equal(r.health_writes,false);
  assert.ok(!JSON.stringify(r).includes('synthetic-secret'));
});
test('status is read-only and promotion replay does not write again',()=>{
  const f=fixture();assert.equal(run(f.deps,false).status,'ready_to_promote');assert.equal(f.writes.length,0);
  run(f.deps,true);const count=f.writes.length;const r=run(f.deps,true);
  assert.equal(r.status,'continuous_active');assert.equal(r.activation_changed,false);
  assert.equal(r.read_only,true);assert.equal(f.writes.length,count);
});
for(const [name,key,value] of [['migration','BRIDGE_MIGRATION_ENABLED','true'],
  ['delivery off','BRIDGE_DELIVERY_ENABLED','false'],['intake off','BRIDGE_INTAKE_ENABLED','false'],
  ['automatic off','BRIDGE_AUTOMATIC_ENABLED','false'],['binding off','BRIDGE_SCHEDULER_BINDING_REVIEWED','false'],
  ['wrong mode','BRIDGE_AUTOMATIC_MODE','other'],['wrong quota','BRIDGE_AUTOMATIC_MAX_NEW','4'],
  ['bad cutoff','BRIDGE_AUTOMATIC_START_AT','invalid'],['future cutoff','BRIDGE_AUTOMATIC_START_AT','2100-01-01T00:00:00Z']]) {
  test('fails closed: '+name,()=>{const f=fixture();f.values[key]=value;
    assert.equal(run(f.deps,true).status,'review_required');assert.equal(f.writes.length,0);});
}
test('binding mismatch and lock contention cause no writes',()=>{
  const f=fixture();f.deps.bindingOk=()=>false;assert.equal(run(f.deps,true).status,'review_required');
  f.deps.lock.tryLock=()=>false;assert.equal(run(f.deps,true).status,'busy');assert.equal(f.writes.length,0);
});
test('incomplete, extra, malformed or attempting pilot journals cannot promote',()=>{
  for(const kind of ['missing','extra','malformed','attempting','wrong receipt','wrong hash','wrong page']) {
    const f=fixture(),key='RPOS_BRIDGE_DELIVERY_'+'1'.repeat(64),j=JSON.parse(f.values[key]);
    if(kind==='missing')delete f.values[key];
    else if(kind==='extra'){const id='4'.repeat(64);f.values['RPOS_BRIDGE_DELIVERY_'+id]=JSON.stringify({...j,receipt_id:id});}
    else if(kind==='malformed')f.values[key]='not json';
    else {if(kind==='attempting')j.state='attempting';if(kind==='wrong receipt')j.receipt_id='b'.repeat(64);
      if(kind==='wrong hash')j.record_hash='bad';if(kind==='wrong page')j.page_id='bad';f.values[key]=JSON.stringify(j);}
    assert.equal(run(f.deps,true).status,'review_required',kind);assert.equal(f.writes.length,0,kind);
  }
});
test('future pending blocks promotion; historical staged receipt is retained without delivery',()=>{
  for(const historical of [false,true]) {
    const f=fixture(),id='5'.repeat(64),hash='a'.repeat(64);
    f.values['RPOS_BRIDGE_INTENT_'+id]=JSON.stringify({state:'staged',receipt_id:id,file_id:'file',record_hash:hash});
    f.deps.store.find=()=>[{id:'file',value:{record_hash:hash,export:{record:{start_time:historical?'2025-01-01T00:00:00Z':'2026-10-17T00:00:00Z'}}}}];
    assert.equal(run(f.deps,true).status,historical?'continuous_active':'review_required');
    assert.equal(f.writes.length,historical?1:0);
    assert.equal(JSON.parse(f.values['RPOS_BRIDGE_INTENT_'+id]).state,'staged');
  }
});
test('uncertain storage or invalid receipt verification prevents promotion',()=>{
  for(const fault of ['absent','multiple','bad hash','verify']) {
    const f=fixture(),id='5'.repeat(64),hash='a'.repeat(64);
    f.values['RPOS_BRIDGE_INTENT_'+id]=JSON.stringify({state:'staged',receipt_id:id,file_id:'file',record_hash:hash});
    const entry={id:'file',value:{record_hash:hash,export:{record:{start_time:'2025-01-01T00:00:00Z'}}}};
    f.deps.store.find=()=>fault==='absent'?[]:fault==='multiple'?[entry,entry]:[entry];
    if(fault==='bad hash')entry.value.record_hash='b'.repeat(64);
    if(fault==='verify')f.deps.verify=()=>{throw new Error('private error');};
    assert.equal(run(f.deps,true).status,'review_required');assert.equal(f.writes.length,0);
  }
});
test('duplicate or non-clock retry trigger prevents promotion',()=>{
  for(const clock of [false,true]){const f=fixture();f.deps.clocks=()=>clock?
    [{id:'1',handler:'rposBridgeRunAutomaticPending',clock:true},{id:'2',handler:'rposBridgeRunAutomaticPending',clock:true}]:
    [{id:'1',handler:'rposBridgeRunAutomaticPending',clock:false}];
    assert.equal(run(f.deps,true).status,'review_required');assert.equal(f.writes.length,0);}
});
test('concurrent property change prevents the mode write',()=>{
  const f=fixture();f.onRead=n=>{if(n===2)f.values.UNRELATED_0='changed externally';};
  assert.equal(run(f.deps,true).status,'review_required');assert.equal(f.writes.length,0);
});
test('failed readback rolls back only mode and retains unrelated evidence',()=>{
  const f=fixture();f.onSet=(k,v)=>{if(v==='continuous')f.values.UNRELATED_0='changed externally';};
  const r=run(f.deps,true);assert.equal(r.status,'promotion_rolled_back');
  assert.equal(r.rollback_verified,true);assert.equal(f.values.BRIDGE_AUTOMATIC_MODE,'pilot');
  assert.equal(f.values.UNRELATED_0,'changed externally');assert.equal(f.writes.length,2);
  assert.ok(f.writes.every(([k])=>k==='BRIDGE_AUTOMATIC_MODE'));
});
test('response loss after persisted setting rolls back safely; rollback failure is explicit',()=>{
  for(const failRollback of [false,true]){const f=fixture();f.onSet=(k,v)=>{if(v==='continuous'||failRollback)throw new Error('lost response');};
    const r=run(f.deps,true);assert.equal(r.status,failRollback?'promotion_unresolved':'promotion_rolled_back');
    assert.ok(!JSON.stringify(r).includes('lost response'));}
});
