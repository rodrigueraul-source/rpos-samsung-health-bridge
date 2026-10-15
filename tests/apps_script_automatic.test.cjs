const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const DS = '11111111-1111-1111-1111-111111111111';
const PAGE = '22222222-2222-2222-2222-222222222222';
function context() {
  const c = vm.createContext({Date, JSON, Number, encodeURIComponent, decodeURIComponent});
  for (const f of ['BridgeIntake.gs', 'BridgeEndpoint.gs', 'BridgeDelivery.gs', 'BridgeNotion.gs', 'BridgeAutomatic.gs'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', f), 'utf8'), c);
  return c;
}
function fixture() {
  const c = context(), writes = [], journals = new Map();
  const exp = {schema_version:'rpos.exercise.export.v1',source:'samsung_health',sdk_version:'1.1.0',
    read_at:'2026-01-02T01:00:00Z',read_record_count:1,record:{uid:'synthetic-original-uid',
      start_time:'2026-01-02T00:01:00Z',end_time:'2026-01-02T00:10:00Z',zone_offset:'-06:00',
      update_time:'2026-01-02T00:10:01Z',exercise_type:'POOL_SWIMMING',custom_title:null,
      duration_seconds:null,calories_kcal:null,distance_meters:null,
      sessions:[{start_time:'2026-01-02T00:01:00Z',end_time:'2026-01-02T00:10:00Z',exercise_type:'POOL_SWIMMING',
        duration_millis:500000,calories_kcal:29.123456789,distance_meters:250.0,mean_heart_rate_bpm:null,
        max_heart_rate_bpm:null,min_heart_rate_bpm:null,custom_title:null}]}};
  const id = sha(JSON.stringify(['samsung_health',exp.record.uid]));
  const stored = {schema_version:'rpos.exercise.intake.stored.v1',receipt_id:id,
    record_hash:sha(JSON.stringify(c.rposBridgeCanonical_(exp.record))),state:'staged',
    received_at:'2026-01-02T01:00:00Z',export:exp};
  const state = {page:null,candidates:[],fail:null,locks:0,unlocks:0};
  const remote = {
    findUid:() => state.page ? [PAGE] : [], findCandidates:() => state.candidates,
    prepare:s => clone(s), create:s => {
      writes.push(clone(s)); state.page={id:PAGE,source:'samsung_health',uid:exp.record.uid,legacy:false,
        evidence:{schema_version:'rpos.notion.evidence.v2',source:'samsung_health',receipt_id:id,
          record_hash:stored.record_hash,record:clone(exp.record),aliases:[]}};
      if(state.fail==='lost-post')throw Error('private transport error'); return PAGE;
    }, read:() => state.page,
    verifyOriginal:() => {if(state.fail==='bad-original')throw Error('private export mismatch');}
  };
  const deps = {enabled:true,startAt:'2026-01-02T00:00:00Z',now:() => Date.parse('2026-01-02T01:00:00Z'),
    sha256:sha,lock:{tryLock:()=>{state.locks++;return true;},releaseLock:()=>{state.unlocks++;}},
    store:{find:()=>[{id:'private-file',value:stored}],getIntent:()=>({receipt_id:id,state:'staged',
      file_id:'private-file',record_hash:stored.record_hash})},
    journal:{get:x=>journals.get(x),set:(x,v)=>{journals.set(x,clone(v));}},remote};
  return {c,deps,state,stored,exp,id,writes,journals,run:()=>clone(c.rposBridgeAutomatic_(id,deps))};
}

test('future automatic record creates once with confirmed journal; replay is zero-write',()=>{
  const f=fixture(),original=clone(f.stored);
  assert.equal(f.run().status,'confirmed'); assert.equal(f.writes.length,1);
  assert.equal(f.journals.get(f.id).state,'confirmed');
  assert.equal(f.run().status,'confirmed'); assert.equal(f.writes.length,1);
  assert.deepEqual(f.stored,original); assert.equal(f.state.locks,f.state.unlocks);
});
test('lost create response is recovered through UID/evidence/original readback without another POST',()=>{
  const f=fixture();f.state.fail='lost-post'; assert.equal(f.run().status,'delivery_error');
  assert.equal(f.journals.get(f.id).state,'attempting'); f.state.fail=null;
  assert.equal(f.run().status,'confirmed');assert.equal(f.writes.length,1);
});
test('empty lookup after uncertain creation never retries creation',()=>{
  const f=fixture();f.deps.remote.create=()=>{f.writes.push('attempt');throw Error('lost before outcome known');};
  assert.equal(f.run().status,'delivery_error');assert.equal(f.run().status,'unresolved');
  assert.equal(f.writes.length,1);
});
test('lost confirmed journal save recovers without second page',()=>{
  const f=fixture(),save=f.deps.journal.set;let lose=true;
  f.deps.journal.set=(id,v)=>{if(v.state==='confirmed'&&lose){lose=false;throw Error('private quota');}save(id,v);};
  assert.equal(f.run().status,'delivery_error');assert.equal(f.run().status,'confirmed');assert.equal(f.writes.length,1);
});
test('duplicate identity, ambiguous existing day and concurrent candidate block before creation',()=>{
  const a=fixture();a.deps.remote.findUid=()=>[PAGE,DS];assert.equal(a.run().status,'delivery_conflict');assert.equal(a.writes.length,0);
  const b=fixture();b.state.candidates=[PAGE];assert.equal(b.run().status,'needs_reconciliation');assert.equal(b.writes.length,0);
  const d=fixture();let reads=0;d.deps.remote.findCandidates=()=>++reads===1?[]:[PAGE];
  assert.equal(d.run().status,'needs_reconciliation');assert.equal(d.writes.length,0);assert.equal(d.journals.size,0);
});
test('old history, open/recent records, malformed cutoff and disabled mode never create',()=>{
  const a=fixture();a.deps.startAt='2026-01-02T00:02:00Z';assert.equal(a.run().status,'needs_reconciliation');assert.equal(a.writes.length,0);
  const b=fixture();b.deps.now=()=>Date.parse('2026-01-02T00:11:00Z');assert.equal(b.run().status,'unresolved');assert.equal(b.writes.length,0);
  const d=fixture();d.deps.startAt='bad';assert.equal(d.run().notion_confirmed,false);assert.equal(d.state.locks,0);
  const e=fixture();e.deps.enabled=false;e.deps.store.find=()=>{throw Error('must not read');};assert.equal(e.run().status,'disabled');assert.equal(e.state.locks,0);
});
test('altered or partial remote evidence and original export never become confirmed',()=>{
  const f=fixture();f.state.fail='bad-original';assert.equal(f.run().status,'delivery_error');
  assert.equal(f.journals.get(f.id).state,'attempting');assert.equal(f.writes.length,1);
  f.state.page.evidence.record.sessions[0].calories_kcal=1;
  assert.equal(f.run().status,'unresolved');assert.equal(f.writes.length,1);
});
test('different intake/hash/intents and existing legacy records require review',()=>{
  const f=fixture();f.journals.set(f.id,{state:'attempting',receipt_id:f.id,record_hash:'0'.repeat(64),mode:'automatic_new_page'});
  assert.equal(f.run().status,'delivery_conflict');assert.equal(f.writes.length,0);
  const g=fixture();g.state.page={id:PAGE,source:'manual',uid:g.exp.record.uid,legacy:true};
  assert.equal(g.run().status,'needs_reconciliation');assert.equal(g.writes.length,0);
});

function schema() {
  const p={}; for(const [name,type] of Object.entries({Session:'title',Source:'rich_text','Source Record ID':'rich_text',Date:'date',Notes:'rich_text','Capture State':'select','Activity Type':'select',
    'Duration (min)':'number','Calories (kcal)':'number','Distance (km)':'number'}))
    p[name]={type,id:name,[type]:{options:[{name:'Completed'},{name:'Swimming'}]}};
  return {id:DS,properties:p};
}
test('prepared Notion body contains exact SDK and evidence; null metrics/feedback stay absent and zeros remain zeros',()=>{
  const f=fixture(),port=f.c.rposBridgeAutomaticPort_({request:()=>schema()},DS,sha);
  const body=clone(port.prepare(f.stored));
  assert.deepEqual(body.parent,{type:'data_source_id',data_source_id:DS});
  for(const n of ['Duration (min)','Calories (kcal)','Distance (km)','Avg HR (bpm)','Energy','RIR Final'])assert.equal(body.properties[n],undefined);
  const texts=body.children.map(b=>b.code.rich_text.map(t=>t.text.content).join(''));
  assert.deepEqual(JSON.parse(texts[0]),f.exp);assert.deepEqual(JSON.parse(texts[1].split('\n').slice(1).join('\n')).record,f.exp.record);
  f.exp.record.calories_kcal=0;assert.equal(port.prepare(f.stored).properties['Calories (kcal)'].number,0);
});
test('date/activity guard includes local date-only rows and UTC midnight span; never uses title to bind',()=>{
  const f=fixture(),requests=[];
  const port=f.c.rposBridgeAutomaticPort_({request:(m,p,b)=>{requests.push({m,p,b:clone(b)});return {object:'list',results:[],has_more:false};}},DS,sha);
  assert.deepEqual(clone(port.findCandidates(f.exp.record)),[]);
  const q=JSON.stringify(requests[0].b);
  assert.ok(q.includes('2026-01-01'));assert.ok(q.includes('2026-01-01T06:00:00.000Z'));assert.ok(q.includes('2026-01-02T06:00:00.000Z'));
  assert.ok(q.includes('Swimming'));assert.ok(q.includes('is_empty'));assert.ok(!q.includes('Session'));
});
test('candidate query obeys Notion depth limit and preserves every date/activity truth combination',()=>{
  const f=fixture();let filter;
  function depth(v){if(v.and||v.or)return 1+Math.max(...(v.and||v.or).map(depth));return 0;}
  const port=f.c.rposBridgeAutomaticPort_({request:(_,__,b)=>{
    assert.ok(depth(b.filter)<=2,'Notion rejects deeper compound filters with 400 validation_error');
    filter=clone(b.filter);return {object:'list',results:[],has_more:false};
  }},DS,sha);
  assert.deepEqual(clone(port.findCandidates(f.exp.record)),[]);
  function evaluate(v,bits){if(v.and)return v.and.every(x=>evaluate(x,bits));if(v.or)return v.or.some(x=>evaluate(x,bits));
    if(v.property==='Date')return bits['equals'in v.date?0:'on_or_after'in v.date?1:2];
    return bits['equals'in v.select?3:4];}
  for(let mask=0;mask<32;mask++){const b=Array.from({length:5},(_,i)=>!!(mask&(1<<i)));
    assert.equal(evaluate(filter,b),(b[0]||(b[1]&&b[2]))&&(b[3]||b[4]),'same blockers for combination '+mask);}
});
test('schema mismatch or missing zone refuses automatic page; no silent selection creation',()=>{
  const f=fixture(),s=schema();s.properties['Capture State'].select.options=[];
  const p=f.c.rposBridgeAutomaticPort_({request:()=>s},DS,sha);
  assert.throws(()=>p.prepare(f.stored));
  const g=fixture();g.exp.record.zone_offset=null;
  assert.throws(()=>g.c.rposBridgeAutomaticPort_({request:()=>({object:'list',results:[],has_more:false})},DS,sha).findCandidates(g.exp.record));
});

test('distinct canonical UID with disjoint SDK times is a separate workout; overlap/manual/planned remains blocked',()=>{
  const f=fixture();let existing={id:PAGE,source:'samsung_health',uid:'another-uid',legacy:false,
    evidence:{record:{uid:'another-uid',start_time:'2026-01-01T21:00:00Z',end_time:'2026-01-01T21:20:00Z'}}};
  f.c.rposBridgeNotionPort_=()=>({read:()=>existing});
  const port=f.c.rposBridgeAutomaticPort_({request:()=>({object:'list',results:[{object:'page',id:PAGE}],has_more:false})},DS,sha);
  assert.deepEqual(clone(port.findCandidates(f.exp.record)),[]);
  existing.evidence.record.end_time='2026-01-02T00:02:00Z';assert.deepEqual(clone(port.findCandidates(f.exp.record)),[PAGE]);
  existing.evidence=null;assert.deepEqual(clone(port.findCandidates(f.exp.record)),[PAGE]);
});
test('optional page-create HTTP capability is bound to exact configured parent; defaults still deny it',()=>{
  const c=context();c.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({object:'page',id:PAGE})})};
  c.Utilities={newBlob:s=>({getBytes:()=>Buffer.from(s)})};
  assert.throws(()=>c.rposBridgeNotionHttp_('synthetic').request('POST','/pages',{parent:{type:'data_source_id',data_source_id:DS}}));
  assert.throws(()=>c.rposBridgeNotionHttp_('synthetic',DS).request('POST','/pages',{parent:{type:'data_source_id',data_source_id:PAGE}}));
  assert.equal(c.rposBridgeNotionHttp_('synthetic',DS).request('POST','/pages',{parent:{type:'data_source_id',data_source_id:DS}}).id,PAGE);
});
test('entry and timer disabled flags never open private Drive or Notion',()=>{
  const c=context(),props={getProperty:()=>null};c.PropertiesService={getScriptProperties:()=>props};
  c.DriveApp={getFolderById:()=>{throw Error('must not access');}};
  assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),props).status,'disabled');
  assert.equal(c.rposBridgeRunAutomaticPending().status,'disabled');
});

test('a bounded creation permit stops before journal or POST while existing confirmed replay still reads',()=>{
  const f=fixture();f.deps.permitNew=()=>false;
  assert.equal(f.run().status,'needs_reconciliation');assert.equal(f.journals.size,0);assert.equal(f.writes.length,0);
  f.deps.permitNew=()=>true;assert.equal(f.run().status,'confirmed');f.deps.permitNew=()=>false;
  assert.equal(f.run().status,'confirmed');assert.equal(f.writes.length,1);
});

test('pilot entry limits total automatic intents to the configured maximum and refuses missing mode',()=>{
  const c=context();c.RPOS={fitnessDataSourceId:DS};c.rposBridgeSha_=sha;c.LockService={getScriptLock:()=>({})};
  const values={BRIDGE_AUTOMATIC_ENABLED:'true',BRIDGE_DELIVERY_ENABLED:'true',BRIDGE_INTAKE_ENABLED:'true',
    BRIDGE_MIGRATION_ENABLED:'false',BRIDGE_SCHEDULER_BINDING_REVIEWED:'true',BRIDGE_FITNESS_DATA_SOURCE_ID:DS,
    BRIDGE_AUTOMATIC_MODE:'pilot',BRIDGE_AUTOMATIC_MAX_NEW:'3',BRIDGE_AUTOMATIC_START_AT:'2026-01-01T00:00:00Z'};
  const props={getProperty:k=>values[k]??null,getProperties:()=>values};
  c.rposBridgeNotionHttp_=()=>({request:()=>{throw Error('not used');}});
  c.rposBridgeAutomaticPort_=()=>({});c.rposBridgeDriveStore_=()=>({});
  c.rposBridgeAutomatic_=(_,deps)=>({permit:deps.permitNew()});
  assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),props).permit,true);
  for(let i=0;i<3;i++)values['RPOS_BRIDGE_DELIVERY_'+String(i).repeat(64)]=JSON.stringify({mode:'automatic_new_page',state:'attempting'});
  assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),props).permit,false);
  values.BRIDGE_AUTOMATIC_MODE=null;assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),props).status,'not_configured');
});

test('changing a flag after preparation rejects remote HTTP before a new page is written',()=>{
  const c=context();c.RPOS={fitnessDataSourceId:DS};c.rposBridgeSha_=sha;c.LockService={getScriptLock:()=>({})};let writes=0,triggered=false;
  const values={BRIDGE_AUTOMATIC_ENABLED:'true',BRIDGE_DELIVERY_ENABLED:'true',BRIDGE_INTAKE_ENABLED:'true',
    BRIDGE_MIGRATION_ENABLED:'false',BRIDGE_SCHEDULER_BINDING_REVIEWED:'true',BRIDGE_FITNESS_DATA_SOURCE_ID:DS,
    BRIDGE_AUTOMATIC_MODE:'pilot',BRIDGE_AUTOMATIC_MAX_NEW:'3',BRIDGE_AUTOMATIC_START_AT:'2026-01-01T00:00:00Z'};
  const props={getProperty:k=>values[k]??null,getProperties:()=>values};
  c.rposBridgeNotionHttp_=()=>({request:()=>{writes++;}});c.rposBridgeDriveStore_=()=>({});
  c.rposBridgeAutomaticPort_=http=>({create:()=>http.request('POST','/pages',{})});
  c.rposBridgeAutomatic_=(_,deps)=>{triggered=true;values.BRIDGE_AUTOMATIC_ENABLED='false';return deps.remote.create();};
  assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),props).status,'delivery_error');assert.equal(writes,0);assert.equal(triggered,true);
});

test('pending worker persists backoff before RPC, skips non-due receipts and quarantines review cases',()=>{
  const f=fixture(),c=f.c;let time=Date.parse('2026-01-02T01:00:00Z'),calls=0;
  c.Date=class extends Date {static now(){return time;}};
  const values={BRIDGE_AUTOMATIC_ENABLED:'true',BRIDGE_DELIVERY_ENABLED:'true',BRIDGE_AUTOMATIC_START_AT:'2026-01-02T00:00:00Z',
    ['RPOS_BRIDGE_INTENT_'+f.id]:JSON.stringify({state:'staged'})};
  const props={getProperty:k=>values[k]??null,getProperties:()=>values,setProperty:(k,v)=>{values[k]=v;}};
  c.PropertiesService={getScriptProperties:()=>props};c.rposBridgeDriveStore_=()=>f.deps.store;
  c.rposBridgeAutomaticReceipt_=()=>{calls++;assert.equal(JSON.parse(values['RPOS_BRIDGE_AUTOMATIC_RETRY_'+f.id]).state,'retry');return {status:'delivery_error'};};
  assert.equal(c.rposBridgeRunAutomaticPending().checked,1);assert.equal(calls,1);
  assert.equal(c.rposBridgeRunAutomaticPending().checked,0);assert.equal(calls,1);
  time+=30001;c.rposBridgeAutomaticReceipt_=()=>{calls++;return {status:'needs_reconciliation'};};
  assert.equal(c.rposBridgeRunAutomaticPending().checked,1);
  time+=900000;assert.equal(c.rposBridgeRunAutomaticPending().checked,0);assert.equal(calls,2);
  assert.equal(JSON.parse(values['RPOS_BRIDGE_AUTOMATIC_RETRY_'+f.id]).state,'blocked');
});

test('partial-runtime addon loads without services or duplicate globals and preserves the disabled boundary',()=>{
  const file=path.join(__dirname,'../apps-script/BridgeAutomaticRuntime.gs.txt');
  const c=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),c);
  assert.equal(c.rposBridgeAutomaticReceipt_('a'.repeat(64),{getProperty:()=>null}).status,'disabled');
  assert.equal(typeof c.rposBridgeRunAutomaticPending,'function');assert.equal(c.doPost,undefined);
  assert.equal(c.rposBridgeDeliver_,undefined);assert.equal(c.rposBridgeNotionHttp_,undefined);
});

test('owner preparation check leaves all properties untouched and reports no secret or health identifier',()=>{
  const c=context();c.RPOS={fitnessDataSourceId:DS};
  const values={BRIDGE_INTAKE_ENABLED:'true',BRIDGE_DELIVERY_ENABLED:'false',BRIDGE_MIGRATION_ENABLED:'false',
    BRIDGE_SCHEDULER_BINDING_REVIEWED:'true',BRIDGE_FITNESS_DATA_SOURCE_ID:DS,
    BRIDGE_RECEIPT_FOLDER_ID:'private-folder-value',NOTION_TOKEN:'private-token-value',BRIDGE_INTAKE_HMAC_KEY:'a'.repeat(64)};
  const original=clone(values);c.PropertiesService={getScriptProperties:()=>({getProperty:k=>values[k]??null,getProperties:()=>values})};
  const r=clone(c.rposBridgeAutomaticPreflight());assert.equal(r.status,'prepared_activation_off');assert.equal(r.activation_flags_unchanged,true);
  assert.deepEqual(values,original);const out=JSON.stringify(r);
  assert.ok(!out.includes(DS));assert.ok(!out.includes('private-'));assert.ok(!out.includes('a'.repeat(64)));
});
