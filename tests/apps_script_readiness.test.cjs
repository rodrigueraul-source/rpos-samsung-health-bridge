const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const modules = ['Intake', 'Endpoint', 'Delivery', 'Notion', 'Scheduler', 'Migration', 'Diagnostics'];
const source = modules.map(n => fs.readFileSync(path.join(__dirname, '../apps-script/Bridge' + n + '.gs'), 'utf8')).join('\n');
const vector = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/src/test/resources/android_intake_vector.json'), 'utf8'));

function fixture() {
  const c = vm.createContext({});
  vm.runInContext(source, c);
  const exportValue = JSON.parse(vector.payload_json), record = exportValue.record;
  const id = sha(JSON.stringify(['samsung_health', record.uid]));
  const hash = sha(JSON.stringify(c.rposBridgeCanonical_(record)));
  const target = '11111111-1111-1111-1111-111111111111';
  const alias = {source: 'R-POS External Scheduler F', uid: 'synthetic-capture', date: {start: record.start_time}};
  const migration = {schema_version: 'rpos.bridge.migration.v1', review_hash: 'a'.repeat(64), legacy_blocks: []};
  const page = {id: target, source: 'samsung_health', uid: record.uid, edited: '2026-01-01T00:00:00Z',
    date: {start: record.start_time}, notes: [{type: 'text', text: {content: c.rposBridgeAlias_(alias.source, alias.uid, sha)}}],
    legacy: false, legacy_blocks: [], evidence: {schema_version: 'rpos.notion.evidence.v2',
      receipt_id: id, record_hash: hash, record, aliases: [alias], migration}};
  const stored = {schema_version: 'rpos.exercise.intake.stored.v1', receipt_id: id,
    record_hash: hash, state: 'staged', export: exportValue};
  const props = {
    ['RPOS_BRIDGE_INTENT_' + id]: JSON.stringify({receipt_id: id, record_hash: hash, state: 'staged', file_id: 'private-file'}),
    ['RPOS_BRIDGE_MIGRATION_' + id]: JSON.stringify({receipt_id: id, record_hash: hash,
      state: 'confirmed', page_id: target, review_hash: migration.review_hash, aliases: [alias]}),
    // Review entries are NOT migration journals.
    ['RPOS_BRIDGE_MIGRATION_REVIEW_' + id]: 'private-review-content'
  };
  const writes = () => {throw new Error('Forbidden mutation');};
  let time = 0, reads = 0, acquired = 0, released = 0;
  const deps = {flagsOff: true, now: () => time, sha256: sha,
    keys: () => Object.keys(props), get: k => props[k], set: writes,
    lock: {tryLock: () => {acquired++; return true;}, releaseLock: () => {released++;}},
    store: {find: () => [{id: 'private-file', value: stored}], create: writes, setIntent: writes},
    remote: {
      findUid: (source, uid) => source === 'samsung_health' && uid === record.uid ? [target] : [],
      findAlias: () => [target], read: () => {reads++; return structuredClone(page);},
      write: writes, prepare: writes, prepareMigration: writes
    }};
  function run() {
    const before = JSON.stringify(props), report = c.rposBridgeReadinessAudit_(deps);
    assert.equal(report.ready_for_activation, false);
    const raw = JSON.stringify(report);
    for (const secret of [id, hash, target, record.uid, 'private-file', 'private-review-content', alias.uid]) {
      assert.equal(raw.includes(secret), false, 'Report must not expose identifiers or values');
    }
    if (!deps.allowSnapshotChange) assert.equal(JSON.stringify(props), before);
    return report;
  }
  return {c, deps, props, page, stored, id, hash, target, alias, run,
    advance: v => {time = v;}, counts: () => ({reads, acquired, released})};
}

test('read-only batch verifies stored data, confirmed migration and exact alias without writes', () => {
  const f = fixture(), r = f.run();
  assert.equal(r.status, 'live_reads_pass_activation_not_approved');
  assert.deepEqual(JSON.parse(JSON.stringify(r.checked)),
    {receipts: 1, delivery_journals: 0, migration_journals: 1, scheduler_journals: 0, aliases: 1});
  assert.equal(f.counts().released, 1);
});
test('enabled flags stop before lock, Drive or Notion access', () => {
  const f = fixture(); f.deps.flagsOff = false;
  assert.equal(f.run().status, 'activation_flags_require_review');
  assert.deepEqual(f.counts(), {reads: 0, acquired: 0, released: 0});
});
test('busy lock stops audit and is never released by this caller', () => {
  const f = fixture(); f.deps.lock.tryLock = () => false;
  assert.equal(f.run().status, 'busy'); assert.equal(f.counts().released, 0);
});
test('empty inventory cannot claim live pass', () => {
  const f = fixture(); f.deps.keys = () => [];
  assert.equal(f.run().status, 'no_receipts_to_audit');
});
test('oversized inventory and receipt batch stop without remote reads', () => {
  const f = fixture(); f.deps.keys = () => Array.from({length: 101}, (_, i) => 'RPOS_BRIDGE_INTENT_' + sha(String(i)));
  assert.equal(f.run().status, 'audit_incomplete'); assert.equal(f.counts().reads, 0);
  f.deps.keys = () => Array.from({length: 5}, (_, i) => 'RPOS_BRIDGE_INTENT_' + sha(String(i)));
  assert.equal(f.run().status, 'audit_incomplete');
});
test('malformed and orphaned journal keys fail closed', () => {
  for (const key of ['RPOS_BRIDGE_DELIVERY_bad', 'RPOS_BRIDGE_MIGRATION_' + 'b'.repeat(64)]) {
    const f = fixture(); f.props[key] = '{}'; assert.equal(f.run().status, 'journal_requires_review');
  }
});
test('duplicate file and mismatched intake intent cannot pass', () => {
  const f = fixture(); f.deps.store.find = () => [];
  assert.equal(f.run().status, 'storage_requires_review');
  const g = fixture(); g.props['RPOS_BRIDGE_INTENT_' + g.id] = JSON.stringify({state: 'attempting'});
  assert.equal(g.run().status, 'storage_requires_review');
});
test('tampered record content is rejected without disclosing exception details', () => {
  const f = fixture(); f.stored.export.record.custom_title = 'tampered';
  assert.equal(f.run().status, 'audit_error');
});
test('ambiguous UID and legacy-only evidence require review', () => {
  const f = fixture(); f.deps.remote.findUid = () => [f.target, '22222222-2222-2222-2222-222222222222'];
  assert.equal(f.run().status, 'identity_requires_review');
  const g = fixture(); g.page.legacy = true;
  assert.equal(g.run().status, 'evidence_requires_review');
});
test('migration evidence requires matching confirmed durable journal', () => {
  for (const raw of [null, JSON.stringify({state: 'attempting'}), JSON.stringify({state: 'confirmed'})]) {
    const f = fixture();
    if (raw === null) delete f.props['RPOS_BRIDGE_MIGRATION_' + f.id];
    else f.props['RPOS_BRIDGE_MIGRATION_' + f.id] = raw;
    assert.equal(f.run().status, 'journal_requires_review');
  }
});
test('ordinary delivery journal must be confirmed and bound to the same target/hash', () => {
  const f = fixture(); f.props['RPOS_BRIDGE_DELIVERY_' + f.id] = JSON.stringify({state: 'attempting'});
  assert.equal(f.run().status, 'journal_requires_review');
  f.props['RPOS_BRIDGE_DELIVERY_' + f.id] = JSON.stringify({receipt_id: f.id, record_hash: f.hash, state: 'confirmed', page_id: f.target});
  assert.equal(f.run().checked.delivery_journals, 1);
});
test('alias targeting another page blocks confirmation', () => {
  const f = fixture(); f.deps.remote.findAlias = () => ['22222222-2222-2222-2222-222222222222'];
  assert.equal(f.run().status, 'journal_requires_review');
});
test('remote edit during audit is detected by a fresh full snapshot', () => {
  const f = fixture(); let reads = 0;
  f.deps.remote.read = () => structuredClone({...f.page, edited: String(reads++)});
  assert.equal(f.run().status, 'snapshot_changed');
});
test('journal change during remote reads prevents a pass', () => {
  const f = fixture(); f.deps.allowSnapshotChange = true;
  f.deps.remote.read = () => { f.props['RPOS_BRIDGE_DELIVERY_' + f.id] = '{}'; return structuredClone(f.page); };
  assert.equal(f.run().status, 'snapshot_changed');
});
test('time budget returns incomplete, never partial pass', () => {
  const f = fixture(); f.deps.store.find = () => {f.advance(180001); return [{id: 'private-file', value: f.stored}];};
  assert.equal(f.run().status, 'audit_incomplete');
});
test('scheduler confirmed journal checks exact event hash and canonical alias mapping', () => {
  const f = fixture(), key = sha(JSON.stringify([f.alias.source, f.alias.uid]));
  f.props['RPOS_BRIDGE_SCHEDULER_' + key] = JSON.stringify({event_id: f.alias.uid, state: 'confirmed', page_id: f.target});
  assert.equal(f.run().checked.scheduler_journals, 1);
  f.props['RPOS_BRIDGE_SCHEDULER_' + key] = JSON.stringify({event_id: f.alias.uid, state: 'attempting'});
  assert.equal(f.run().status, 'journal_requires_review');
});
test('read-only HTTP boundary permits queries but denies all mutation verbs and page POSTs', () => {
  const f = fixture(); let calls = 0;
  const port = f.c.rposBridgeReadOnlyHttp_({request: () => {calls++; return {};}});
  port.request('GET', '/pages/' + f.target); port.request('POST', '/data_sources/' + f.target + '/query', {filter: {}});
  for (const [method, uri] of [['PATCH', '/pages/' + f.target], ['POST', '/pages'],
    ['POST', '/blocks/' + f.target + '/children'], ['DELETE', '/blocks/' + f.target]]) {
    assert.throws(() => port.request(method, uri), e => e.bridgeCode === 'audit_write_blocked');
  }
  assert.equal(calls, 2);
});
test('binding detector accepts only the two reviewed exact wrappers without invoking them', () => {
  const f = fixture();
  for (const [route, call] of [['legacy', 'rposBridgeLegacyCreateGymCapturePage_(cfg,event,plan,now)'],
    ['bridge', 'rposBridgeCreateGymCapture_(cfg,event,plan,now,rposBridgeLegacyCreateGymCapturePage_)']]) {
    const entry = vm.runInContext('(function createGymCapturePage_(cfg,event,plan,now) { return ' + call + '; })', f.c);
    assert.equal(f.c.rposBridgeBindingPath_(entry), route);
  }
  assert.equal(f.c.rposBridgeBindingPath_(null), 'missing');
  assert.equal(f.c.rposBridgeBindingPath_(function createGymCapturePage_() {}), 'unrecognized');
});

test('live read-only HTTP calls are paced and stop at the shared time budget', () => {
  const f = fixture(), times = []; let clock = 0;
  const port = f.c.rposBridgeReadOnlyHttp_({request: () => {times.push(clock); return {}; }},
    {now: () => clock, wait: ms => {clock += ms;}});
  port.request('GET', '/pages/' + f.target);
  port.request('POST', '/data_sources/' + f.target + '/query');
  port.request('GET', '/pages/' + f.target);
  assert.deepEqual(times, [0, 350, 700]);
  clock = 180001;
  assert.throws(() => port.request('GET', '/pages/' + f.target), e => e.bridgeCode === 'audit_incomplete');
  assert.equal(times.length, 3);
});

test('public operator rejects enabled flags before constructing live service ports', () => {
  const f = fixture(), logs = [];
  f.c.PropertiesService = {getScriptProperties: () => ({getProperty: () => 'true'})};
  f.c.Logger = {log: text => logs.push(text)};
  for (const name of ['rposBridgeDriveStore_', 'rposBridgeNotionHttp_', 'rposBridgeNotionPort_']) {
    f.c[name] = () => {throw new Error('Must not access a live port');};
  }
  assert.equal(f.c.rposBridgeReadinessAudit().status, 'activation_flags_require_review');
  assert.equal(logs.length, 1); assert.equal(f.counts().reads, 0);
});

test('public operator verifies binding and detects flags enabled during the audit', () => {
  for (const changed of [false, true]) {
    const f = fixture(), logs = []; let enabled = false;
    const flags = ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED', 'BRIDGE_MIGRATION_ENABLED', 'BRIDGE_SCHEDULER_BINDING_REVIEWED'];
    const props = {getKeys: f.deps.keys, getProperty: name => flags.includes(name) ?
      (enabled ? 'true' : 'false') : name === 'BRIDGE_FITNESS_DATA_SOURCE_ID' ? f.target :
      name === 'NOTION_TOKEN' ? 'secret-fixture-token' : f.props[name],
      setProperty: () => {throw new Error('Forbidden mutation');}};
    f.c.PropertiesService = {getScriptProperties: () => props};
    f.c.Logger = {log: text => logs.push(text)}; f.c.RPOS = {fitnessDataSourceId: f.target};
    f.c.LockService = {getScriptLock: () => f.deps.lock}; f.c.rposBridgeSha_ = sha;
    f.c.rposBridgeDriveStore_ = () => f.deps.store; f.c.rposBridgeNotionHttp_ = () => ({});
    f.c.rposBridgeNotionPort_ = () => f.deps.remote;
    const read = f.deps.remote.read;
    f.deps.remote.read = id => {if (changed) enabled = true; return read(id);};
    vm.runInContext('function createGymCapturePage_(cfg,event,plan,now) { return rposBridgeLegacyCreateGymCapturePage_(cfg,event,plan,now); }', f.c);
    const result = f.c.rposBridgeReadinessAudit();
    assert.equal(result.scheduler_binding, 'legacy');
    assert.equal(result.status, changed ? 'activation_flags_require_review' : 'live_reads_pass_activation_not_approved');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].includes('secret-fixture-token'), false);
    assert.equal(logs[0].includes(f.target), false);
  }
});
