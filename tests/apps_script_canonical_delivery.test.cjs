const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const DS = '11111111-1111-1111-1111-111111111111';
const PAGE = '22222222-2222-2222-2222-222222222222';
const OWNER_BLOCK = '33333333-3333-3333-3333-333333333333';
const MANAGED_BLOCK = '44444444-4444-4444-4444-444444444444';
const rich = s => [{type: 'text', text: {content: s}}];

function fixture() {
  const c = vm.createContext({Date, JSON, Number, encodeURIComponent});
  for (const file of ['BridgeIntake.gs', 'BridgeDelivery.gs', 'BridgeNotion.gs', 'BridgeCanonicalDelivery.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', file), 'utf8'), c);
  }
  const record = {uid: 'synthetic-canonical-001', start_time: '2026-01-03T12:00:00.123Z',
    end_time: '2026-01-03T13:00:00.456Z', exercise_type: 'OTHER', custom_title: 'Synthetic record',
    calories_kcal: null, distance_meters: null, duration_seconds: null, sessions: []};
  const exported = {schema_version: 'rpos.exercise.export.v1', sdk_version: '1.1.0', source: 'samsung_health',
    read_at: '2026-01-03T14:00:00Z', read_record_count: 1, record};
  const stored = {schema_version: 'rpos.exercise.intake.stored.v1', state: 'staged',
    receipt_id: sha(JSON.stringify(['samsung_health', record.uid])),
    record_hash: sha(JSON.stringify(c.rposBridgeCanonical_(record))), export: exported};
  const state = {journal: new Map(), blocks: [{id: OWNER_BLOCK, type: 'code', has_children: false,
    code: {rich_text: rich(JSON.stringify(exported))}}], notes: rich('Owner notes remain'),
    source: 'samsung_health', uid: record.uid, edited: '2026-01-03T14:00:00.000Z', patches: [],
    releases: 0, selected: null, allowed: true, pageCount: 1, requests: [], logs: []};
  const list = results => ({object: 'list', results, has_more: false, next_cursor: null});
  const page = () => ({object: 'page', id: PAGE, url: 'https://www.notion.so/' + PAGE,
    parent: {type: 'data_source_id', data_source_id: DS}, in_trash: false,
    last_edited_time: state.edited, properties: {Session: {type: 'title'},
      Source: {id: 'src', type: 'rich_text'}, 'Source Record ID': {id: 'uid', type: 'rich_text'},
      Notes: {id: 'notes', type: 'rich_text'}, Date: {type: 'date', date: {start: record.start_time}},
      Energy: {type: 'number', number: 4}}});
  const http = {request(method, url, body) {
    state.requests.push({method, url});
    if (method === 'GET' && url === '/data_sources/' + DS) return {id: DS, properties: page().properties};
    if (method === 'POST' && url === '/data_sources/' + DS + '/query') {
      return list(Array.from({length: state.pageCount}, () => page()));
    }
    if (method === 'GET' && url === '/pages/' + PAGE) return page();
    if (method === 'GET' && url.includes('/properties/')) {
      const id = url.split('/properties/')[1].split('?')[0];
      const values = id === 'src' ? rich(state.source) : id === 'uid' ? rich(state.uid) : state.notes;
      return list(values.map(value => ({object: 'property_item', type: 'rich_text', rich_text: value})));
    }
    if (method === 'GET' && url.startsWith('/blocks/' + PAGE + '/children')) return list(clone(state.blocks));
    if (method === 'PATCH' && url === '/pages/' + PAGE) {
      state.patches.push({url, body: clone(body)});
      state.source = c.rposBridgePlain_(body.properties.Source.rich_text);
      state.uid = c.rposBridgePlain_(body.properties['Source Record ID'].rich_text);
      if (body.properties.Notes) state.notes = clone(body.properties.Notes.rich_text);
      state.edited = '2026-01-03T14:01:00.000Z';
      if (state.onPropertyPatch) state.onPropertyPatch();
      return page();
    }
    if (method === 'PATCH' && url === '/blocks/' + PAGE + '/children') {
      state.patches.push({url, body: clone(body)});
      if (state.failAfterProperties) throw new Error('Synthetic evidence transport failure');
      state.blocks.push({id: MANAGED_BLOCK, type: 'code', has_children: false, code: clone(body.children[0].code)});
      return list(state.blocks);
    }
    throw new Error('Unexpected request ' + method + ' ' + url);
  }};
  const remote = c.rposBridgeNotionPort_(http, DS, sha);
  const deps = {flagsOk: () => state.allowed, sha256: sha,
    lock: {tryLock: () => true, releaseLock: () => {state.releases++;}},
    listReceipts: () => [stored.receipt_id],
    store: {find: () => [{id: 'synthetic-file', value: clone(stored)}],
      getIntent: () => ({state: 'staged', receipt_id: stored.receipt_id, file_id: 'synthetic-file', record_hash: stored.record_hash})},
    journal: {get: id => clone(state.journal.get(id) || null), set: (id, value) => state.journal.set(id, clone(value))},
    remote, ownerExportMatches: (id, value) => c.rposBridgeOwnerExportMatches_(http, id, value),
    selectPage: id => {state.selected = id;}};
  const properties = new Map([
    ['BRIDGE_INTAKE_ENABLED', 'true'], ['BRIDGE_DELIVERY_ENABLED', 'false'],
    ['BRIDGE_MIGRATION_ENABLED', 'false'], ['BRIDGE_SCHEDULER_BINDING_REVIEWED', 'true'],
    ['BRIDGE_FITNESS_DATA_SOURCE_ID', DS], ['BRIDGE_RECEIPT_FOLDER_ID', 'synthetic-folder'],
    ['NOTION_TOKEN', 'synthetic-notion-token'], ['RPOS_BRIDGE_INTENT_' + stored.receipt_id, 'synthetic-intent']
  ]);
  const props = {getProperty: key => properties.get(key) ?? null,
    getKeys: () => [...properties.keys()], setProperty: (key, value) => properties.set(key, value)};
  Object.assign(c, {PropertiesService: {getScriptProperties: () => props},
    LockService: {getScriptLock: () => deps.lock}, RPOS: {fitnessDataSourceId: DS},
    Logger: {log: value => state.logs.push(value)}, rposBridgeSha_: sha,
    rposBridgeDriveStore_: () => deps.store, rposBridgeCanonicalHttp_: () => http});
  return {c, state, deps, stored, http, properties,
    run: () => clone(c.rposBridgeCanonicalDelivery_(deps)),
    runNative: () => clone(c.rposBridgeFinalizeCanonicalReceipt())};
}

test('canonical full-export review recovers lost write response with exactly one evidence append', () => {
  const f = fixture(), original = clone(f.state.blocks[0]);
  const result = f.run();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.response_loss_recovered, true);
  assert.equal(result.replay_without_remote_writes, true);
  assert.equal(result.remote_write_calls, 1);
  assert.equal(f.state.patches.length, 2);
  assert.equal(f.state.blocks.length, 2);
  assert.deepEqual(f.state.blocks[0], original);
  assert.equal(f.state.journal.get(f.stored.receipt_id).state, 'confirmed');
  assert.deepEqual(Object.keys(f.state.patches[0].body.properties).sort(), ['Source', 'Source Record ID']);
  assert.equal(f.run().status, 'no_matching_signed_receipt');
  assert.equal(f.state.patches.length, 2);
});

test('same UID with a different full SDK record never authorizes delivery', () => {
  const f = fixture(), value = clone(f.stored.export);
  value.record.custom_title = 'Changed record';
  f.state.blocks[0].code.rich_text = rich(JSON.stringify(value));
  assert.equal(f.run().status, 'no_matching_signed_receipt');
  assert.equal(f.state.patches.length, 0);
  assert.equal(f.state.journal.size, 0);
});

test('duplicate canonical UID blocks all writes rather than using title or date', () => {
  const f = fixture(); f.state.pageCount = 2;
  assert.equal(f.run().status, 'delivery_conflict');
  assert.equal(f.state.patches.length, 0);
  assert.equal(f.state.journal.size, 0);
});

test('partial remote write remains unresolved and is never blindly repeated', () => {
  const f = fixture(); f.state.failAfterProperties = true;
  assert.equal(f.run().status, 'unresolved');
  const writes = f.state.patches.length;
  f.state.failAfterProperties = false;
  assert.equal(f.run().status, 'unresolved');
  assert.equal(f.state.patches.length, writes);
  assert.equal(f.state.journal.get(f.stored.receipt_id).state, 'attempting');
});

test('activation flags and malformed intake block before selecting or writing a page', () => {
  const f = fixture(); f.state.allowed = false;
  assert.equal(f.run().status, 'flags_require_review');
  assert.equal(f.state.patches.length, 0);
  f.state.allowed = true;
  f.deps.store.getIntent = () => ({state: 'staged', file_id: 'wrong-file'});
  assert.equal(f.run().status, 'receipt_requires_review');
  assert.equal(f.state.patches.length, 0);
});

test('more than one owner SDK export is ambiguous even when both are identical', () => {
  const f = fixture(); f.state.blocks.push(clone(f.state.blocks[0]));
  assert.equal(f.run().status, 'no_matching_signed_receipt');
  assert.equal(f.state.patches.length, 0);
});

test('owner entry uses durable property journals, keeps activation OFF and only patches identity and evidence', () => {
  const f = fixture(), before = [...f.properties].filter(([key]) => key.startsWith('BRIDGE_'));
  const result = f.runNative();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.response_loss_recovered, true);
  assert.equal(result.replay_without_remote_writes, true);
  assert.equal(result.activation_flags_unchanged, true);
  assert.equal(result.continuous_delivery_enabled, false);
  assert.equal(result.migration_enabled, false);
  assert.deepEqual([...f.properties].filter(([key]) => key.startsWith('BRIDGE_')), before);
  assert.equal(JSON.parse(f.properties.get('RPOS_BRIDGE_DELIVERY_' + f.stored.receipt_id)).state, 'confirmed');
  assert.equal(f.state.patches.length, 2);
  assert.deepEqual(Object.keys(f.state.patches[0].body.properties).sort(), ['Source', 'Source Record ID']);
  assert.equal(f.state.requests.some(r => r.method === 'POST' && r.url === '/pages'), false);
  assert.equal(f.state.logs.length, 1);
  assert.equal(f.state.logs[0].includes(f.stored.export.record.uid), false);
  assert.equal(f.runNative().status, 'no_matching_signed_receipt');
  assert.equal(f.state.patches.length, 2);
});

test('owner entry blocks unexpected flags and stops a mid-write flag change before evidence append', () => {
  const f = fixture();
  f.properties.set('BRIDGE_MIGRATION_ENABLED', 'true');
  assert.equal(f.runNative().status, 'flags_require_review');
  assert.equal(f.state.requests.length, 0);
  f.properties.set('BRIDGE_MIGRATION_ENABLED', 'false');
  f.state.onPropertyPatch = () => f.properties.set('BRIDGE_DELIVERY_ENABLED', 'true');
  const result = f.runNative();
  assert.equal(result.status, 'flags_require_review');
  assert.equal(result.notion_confirmed, false);
  assert.equal(result.activation_flags_unchanged, false);
  assert.equal(result.continuous_delivery_enabled, true);
  assert.equal(f.state.patches.length, 1);
  assert.equal(f.state.blocks.length, 1);
  assert.equal(JSON.parse(f.properties.get('RPOS_BRIDGE_DELIVERY_' + f.stored.receipt_id)).state, 'attempting');
});

test('owner operation works without legacy adapters and reports a missing worker before services or writes', () => {
  const f = fixture();
  f.c.rposBridgePropertyJournal_ = undefined;
  f.c.rposBridgeNotionHttp_ = undefined;
  assert.equal(f.runNative().status, 'confirmed');
  const g = fixture();
  g.c.rposBridgeDeliver_ = undefined;
  g.c.PropertiesService = {getScriptProperties: () => {throw new Error('Unexpected service access');}};
  const result = g.runNative();
  assert.equal(result.status, 'runtime_incomplete');
  assert.equal(result.runtime_present.deliver, false);
  assert.equal(g.state.requests.length, 0);
});

test('standalone transport rejects foreign paths, redirects, non-objects and HTTP failures', () => {
  const c = vm.createContext({Date, JSON, Number, encodeURIComponent,
    Utilities: {newBlob: value => ({getBytes: () => [...Buffer.from(value, 'utf8')]})}});
  for (const name of ['BridgeIntake.gs', 'BridgeCanonicalDelivery.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8'), c);
  }
  const requests = [];
  let status = 200, raw = '{"object":"page"}';
  c.UrlFetchApp = {fetch: (url, options) => {
    requests.push({url, options});
    return {getResponseCode: () => status, getContentText: () => raw};
  }};
  const http = c.rposBridgeCanonicalHttp_('synthetic-token');
  assert.throws(() => http.request('GET', '//foreign.example/path'));
  assert.equal(requests.length, 0);
  assert.equal(http.request('GET', '/pages/' + PAGE).object, 'page');
  assert.equal(requests[0].url, 'https://api.notion.com/v1/pages/' + PAGE);
  assert.equal(requests[0].options.followRedirects, false);
  for (const code of [302, 401, 429, 500]) {
    status = code; assert.throws(() => http.request('GET', '/pages/' + PAGE));
  }
  status = 200;
  for (const value of ['[]', 'null', '<html>sign in</html>']) {
    raw = value; assert.throws(() => http.request('GET', '/pages/' + PAGE));
  }
});
