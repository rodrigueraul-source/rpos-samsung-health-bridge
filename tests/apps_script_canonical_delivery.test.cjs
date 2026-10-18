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

function fixture({withoutDeliveryModule = true} = {}) {
  const c = vm.createContext({Date, JSON, Number, encodeURIComponent});
  for (const file of ['BridgeIntake.gs', 'BridgeEndpoint.gs',
    withoutDeliveryModule ? 'BridgeRuntimeHelpers.gs.txt' : 'BridgeDelivery.gs',
    'BridgeNotion.gs', 'BridgeCanonicalDelivery.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', file), 'utf8'), c);
  }
  const record = {uid: 'synthetic-canonical-001', start_time: '2026-01-03T12:00:00.123Z',
    end_time: '2026-01-03T13:00:00.456Z', exercise_type: 'OTHER', custom_title: 'Synthetic record',
    calories_kcal: null, distance_meters: null, duration_seconds: null, zone_offset: '-06:00', sessions: [
      {start_time: '2026-01-03T12:10:00.123Z', end_time: '2026-01-03T12:20:00.456Z',
        exercise_type: 'TREADMILL', duration_millis: 599789, calories_kcal: 12.3456789012345,
        distance_meters: 456.7890123456789, mean_heart_rate_bpm: 96, custom_title: null},
      {start_time: '2026-01-03T12:19:59.888Z', end_time: '2026-01-03T12:20:30.742Z',
        exercise_type: 'BREAK', duration_millis: 30000, calories_kcal: 1.23456789012345,
        distance_meters: null, mean_heart_rate_bpm: null, custom_title: null}
    ]};
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
      if (body.filter.and && (body.filter.and[0].rich_text.equals !== state.source ||
          body.filter.and[1].rich_text.equals !== state.uid)) return list([]);
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
    getKeys: () => [...properties.keys()], setProperty: (key, value) => {
      if (state.onJournalSave) state.onJournalSave(key, value);
      properties.set(key, value);
    }};
  Object.assign(c, {PropertiesService: {getScriptProperties: () => props},
    LockService: {getScriptLock: () => deps.lock}, RPOS: {fitnessDataSourceId: DS},
    Logger: {log: value => state.logs.push(value)}, rposBridgeSha_: sha,
    rposBridgeDriveStore_: () => deps.store, rposBridgeCanonicalHttp_: () => http});
  return {c, state, deps, stored, http, properties,
    run: () => clone(c.rposBridgeCanonicalDelivery_(deps)),
    runNative: () => clone(c.rposBridgeFinalizeCanonicalReceipt())};
}

function historicalFixture() {
  const f = fixture();
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    '../apps-script/BridgeHistoricalReview.gs.txt'), 'utf8'), f.c);
  const r = f.stored.export.record;
  r.exercise_type = 'POOL_SWIMMING';
  r.sessions = [Object.assign({}, r.sessions[0], {exercise_type:'POOL_SWIMMING'})];
  f.stored.record_hash = sha(JSON.stringify(f.c.rposBridgeCanonical_(r)));
  f.state.blocks[0].code.rich_text = rich(JSON.stringify(f.stored.export));
  const alias = {source:'samsung_health_screenshot', uid:'synthetic-old-screenshot',
    date:{start:'2026-01-03'}};
  f.state.notes = rich('Original 472 kcal retained\n' +
    f.c.rposBridgeAlias_(alias.source, alias.uid, sha) + '\n' + JSON.stringify(alias));
  const selection = {schema_version:'rpos.bridge.historical.selection.v1',
    receipt_id:f.stored.receipt_id, record_hash:f.stored.record_hash, uid:r.uid,
    target_page_id:PAGE, expected_last_edited_time:f.state.edited, aliases:[alias],
    review_basis:'Owner reviewed original start, distance, active duration, heart rate and retained screenshot discrepancy.'};
  f.deps.cutoff = '2026-01-04T00:00:00Z';
  selection.expected_cutoff = f.deps.cutoff;
  f.properties.set('BRIDGE_DELIVERY_ENABLED','true');
  f.properties.set('BRIDGE_AUTOMATIC_ENABLED','true');
  f.properties.set('BRIDGE_AUTOMATIC_MODE','pilot');
  f.properties.set('BRIDGE_AUTOMATIC_MAX_NEW','3');
  f.properties.set('BRIDGE_AUTOMATIC_START_AT',f.deps.cutoff);
  f.properties.set('BRIDGE_AUTOMATIC_PILOT_CONTROL_VERSION','rpos.bridge.automatic.pilot.control.v1');
  return Object.assign(f, {selection,
    runHistorical:() => clone(f.c.rposBridgeHistoricalReviewed_(selection,f.deps)),
    runHistoricalNative:() => clone(f.c.rposBridgeFinalizeReviewedHistoricalReceipt(selection))});
}

test('reviewed historical swimming retains original/alias, recovers response loss and never consumes automatic quota', () => {
  const f = historicalFixture(), original = clone(f.state.blocks), notes = clone(f.state.notes);
  const result = f.runHistorical();
  assert.equal(result.status,'confirmed');
  assert.equal(result.response_loss_recovered,true);
  assert.equal(result.replay_without_remote_writes,true);
  assert.equal(result.automatic_acceptance_cycle,false);
  assert.equal(result.remote_write_calls,1);
  assert.deepEqual(f.state.blocks.slice(0,1),original);
  assert.deepEqual(f.state.notes,notes);
  const ev = JSON.parse(f.c.rposBridgePlain_(f.state.blocks[1].code.rich_text)
    .slice('rpos.notion.evidence.v2\n'.length));
  assert.deepEqual(ev.record,f.stored.export.record);
  assert.deepEqual(ev.aliases,f.selection.aliases);
  assert.equal(ev.record.duration_seconds,null);
  assert.equal(f.state.journal.get(f.stored.receipt_id).mode,undefined);
  assert.equal(f.runHistorical().status,'no_matching_signed_receipt');
  assert.equal(f.state.patches.length,2);
});

test('historical runtime preserves pilot settings and permits only same-page identity/evidence writes', () => {
  const f = historicalFixture(), before = new Map(f.properties);
  const result = f.runHistoricalNative();
  assert.equal(result.status,'confirmed');
  assert.equal(result.activation_flags_unchanged,true);
  assert.equal(result.pilot_cutoff_unchanged,true);
  assert.equal(result.migration_enabled,false);
  for (const [k,v] of before) assert.equal(f.properties.get(k),v);
  const added = [...f.properties.keys()].filter(k=>!before.has(k));
  assert.deepEqual(added,['RPOS_BRIDGE_DELIVERY_'+f.stored.receipt_id]);
  assert.equal(JSON.parse(f.properties.get(added[0])).mode,undefined);
  assert.deepEqual(Object.keys(f.state.patches[0].body.properties).sort(),['Source','Source Record ID']);
});

for (const change of ['future','different_hash','different_uid','different_page','stale_review','non_pool','multiple_segments']) {
  test('historical review stops '+change+' before any remote write or journal intent', () => {
    const f = historicalFixture();
    if (change === 'future') f.selection.expected_cutoff = f.deps.cutoff = f.stored.export.record.start_time;
    if (change === 'different_hash') f.selection.record_hash = 'a'.repeat(64);
    if (change === 'different_uid') f.selection.uid = 'synthetic-another-uid';
    if (change === 'different_page') f.selection.target_page_id = OWNER_BLOCK;
    if (change === 'stale_review') f.selection.expected_last_edited_time = '2026-01-02T00:00:00Z';
    if (change === 'non_pool') f.stored.export.record.exercise_type = 'WALKING';
    if (change === 'multiple_segments') f.stored.export.record.sessions.push(clone(f.stored.export.record.sessions[0]));
    assert.equal(f.runHistorical().notion_confirmed,false);
    assert.equal(f.state.patches.length,0);
    assert.equal(f.state.journal.size,0);
  });
}

test('historical partial write stays unresolved; a later run never appends a second managed block', () => {
  const f = historicalFixture(); f.state.failAfterProperties = true;
  assert.equal(f.runHistorical().status,'unresolved');
  const writes = f.state.patches.length;
  f.state.failAfterProperties = false;
  assert.equal(f.runHistorical().status,'unresolved');
  assert.equal(f.state.patches.length,writes);
  assert.equal(f.state.journal.get(f.stored.receipt_id).state,'attempting');
});

test('historical duplicate UID or different owner export never permits a write', () => {
  const duplicate = historicalFixture(); duplicate.state.pageCount = 2;
  assert.equal(duplicate.runHistorical().notion_confirmed,false);
  assert.equal(duplicate.state.patches.length,0);
  assert.equal(duplicate.state.journal.size,0);
  const different = historicalFixture(), changed = clone(different.stored.export);
  changed.record.sessions[0].calories_kcal = 999;
  different.state.blocks[0].code.rich_text = rich(JSON.stringify(changed));
  assert.equal(different.runHistorical().notion_confirmed,false);
  assert.equal(different.state.patches.length,0);
  assert.equal(different.state.journal.size,0);
});

test('historical runtime binds the reviewed original cutoff before reading health data', () => {
  const f = historicalFixture();
  f.properties.set('BRIDGE_AUTOMATIC_START_AT','2026-01-05T00:00:00Z');
  assert.equal(f.runHistoricalNative().status,'flags_require_review');
  assert.equal(f.state.requests.length,0);
  assert.equal(f.state.patches.length,0);
});

test('historical runtime refuses migration, a changed cutoff or a mid-write flag change', () => {
  const disabled = historicalFixture(); disabled.properties.set('BRIDGE_MIGRATION_ENABLED','true');
  assert.equal(disabled.runHistoricalNative().status,'flags_require_review');
  assert.equal(disabled.state.patches.length,0);
  const changed = historicalFixture();
  changed.state.onPropertyPatch = () => changed.properties.set('BRIDGE_AUTOMATIC_START_AT','2026-01-05T00:00:00Z');
  assert.equal(changed.runHistoricalNative().notion_confirmed,false);
  assert.equal(changed.state.blocks.length,1);
  assert.equal(changed.state.patches.length,1);
});

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
  const evidence = JSON.parse(f.c.rposBridgePlain_(f.state.blocks[1].code.rich_text)
    .slice('rpos.notion.evidence.v2\n'.length));
  assert.deepEqual(evidence.record, f.stored.export.record);
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

test('observed partial runtime works without global delivery functions, result/save helpers or adapters', () => {
  const f = fixture();
  for (const name of ['rposBridgeReview_', 'rposBridgeDeliver_', 'rposBridgeDeliveryResult_',
    'rposBridgeDeliverySave_', 'rposBridgePropertyJournal_', 'rposBridgeNotionHttp_', 'rposBridgeDeliverReceipt']) {
    assert.equal(typeof f.c[name], 'undefined', name);
  }
  const result = f.runNative();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.operator_version, '2026-10-08.2');
  assert.equal(Object.values(result.runtime_present).every(Boolean), true);
  assert.equal(result.response_loss_recovered, true);
  assert.equal(result.replay_without_remote_writes, true);
  assert.equal(result.remote_write_calls, 1);
  assert.equal(f.state.patches.length, 2);
});

test('remaining transitive dependencies fail before private service access or writes', () => {
  for (const [name, probe] of [['rposBridgeNotionPort_', 'notion'], ['rposBridgeText_', 'text'],
    ['rposBridgeTime_', 'time'], ['rposBridgeMetric_', 'metric'], ['rposBridgeRichText_', 'rich_text'],
    ['rposBridgeWritableText_', 'writable_text'], ['rposBridgeAlias_', 'alias'], ['rposBridgeHex_', 'hex']]) {
    const f = fixture();
    f.c[name] = undefined;
    f.c.PropertiesService = {getScriptProperties: () => {throw new Error('Unexpected service access');}};
    const result = f.runNative();
    assert.equal(result.status, 'runtime_incomplete', name);
    assert.equal(result.runtime_present[probe], false, name);
    assert.equal(f.state.requests.length, 0);
  }
});

test('full runtime conflicts do not replace the lexically packaged delivery core', () => {
  const f = fixture({withoutDeliveryModule: false});
  for (const name of ['rposBridgeReview_', 'rposBridgeDeliver_', 'rposBridgeDeliveryResult_',
    'rposBridgeDeliverySave_', 'rposBridgePropertyJournal_', 'rposBridgeNotionHttp_']) {
    f.c[name] = () => {throw new Error('Optional global must never run: ' + name);};
  }
  assert.equal(f.runNative().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
});

test('packaged core matches accepted shared code and loads with full bundle without duplicate globals or services', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '../apps-script', name), 'utf8');
  const source = read('BridgeDelivery.gs');
  const shared = source.slice(source.indexOf('function rposBridgeDeliveryResult_('),
    source.indexOf('function rposBridgePropertyJournal_(')).trim();
  const embedded = read('BridgeCanonicalDelivery.gs').split('  // BEGIN embedded BridgeDelivery core\n')[1]
    .split('  // END embedded BridgeDelivery core')[0].split('\n')
    .map(line => line.startsWith('  ') ? line.slice(2) : line).join('\n').trim();
  assert.equal(embedded, shared);
  const combined = read('BridgeRuntime.gs.txt') + '\n' + read('BridgeCanonicalDelivery.gs');
  const names = [...combined.matchAll(/^function\s+(\w+)\s*\(/gm)].map(match => match[1]);
  assert.equal(new Set(names).size, names.length);
  const c = vm.createContext({});
  vm.runInContext(combined, c, {timeout: 1000});
  assert.equal(typeof c.rposBridgeFinalizeCanonicalReceipt, 'function');
  assert.equal(typeof c.rposBridgeDeliver_, 'function');
});

test('fresh partial runtime recovers attempting intent after a lost confirmed-journal save without rewriting', () => {
  const f = fixture();
  f.state.onJournalSave = (key, value) => {
    if (key.startsWith('RPOS_BRIDGE_DELIVERY_') && JSON.parse(value).state === 'confirmed') {
      throw new Error('Synthetic process failure before confirmed journal save');
    }
  };
  assert.equal(f.runNative().status, 'delivery_error');
  assert.equal(f.state.patches.length, 2);
  assert.equal(JSON.parse(f.properties.get('RPOS_BRIDGE_DELIVERY_' + f.stored.receipt_id)).state, 'attempting');
  const g = fixture();
  for (const [key, value] of f.properties) g.properties.set(key, value);
  g.state.blocks = clone(f.state.blocks);
  g.state.edited = f.state.edited;
  const result = g.runNative();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.remote_write_calls, 0);
  assert.equal(result.replay_without_remote_writes, true);
  assert.equal(g.state.patches.length, 0);
  assert.equal(JSON.parse(g.properties.get('RPOS_BRIDGE_DELIVERY_' + g.stored.receipt_id)).state, 'confirmed');
});

test('unrelated staged walk stays separate while only the exact matching receipt is finalized', () => {
  const f = fixture(), walk = clone(f.stored);
  walk.export.record.uid = 'synthetic-separate-walk';
  walk.export.record.source_app_id = 'com.google.android.apps.fitness';
  walk.export.record.exercise_type = 'WALKING';
  walk.receipt_id = sha(JSON.stringify(['samsung_health', walk.export.record.uid]));
  walk.record_hash = sha(JSON.stringify(f.c.rposBridgeCanonical_(walk.export.record)));
  const found = new Map([[f.stored.receipt_id, {id: 'synthetic-file', value: f.stored}],
    [walk.receipt_id, {id: 'synthetic-walk-file', value: walk}]]);
  f.deps.store.find = id => [clone(found.get(id))];
  f.deps.store.getIntent = id => ({state: 'staged', receipt_id: id,
    file_id: found.get(id).id, record_hash: found.get(id).value.record_hash});
  f.properties.set('RPOS_BRIDGE_INTENT_' + walk.receipt_id, 'synthetic-walk-intent');
  const before = clone(walk);
  assert.equal(f.runNative().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
  assert.equal(f.properties.has('RPOS_BRIDGE_DELIVERY_' + walk.receipt_id), false);
  assert.deepEqual(walk, before);
  assert.equal(f.runNative().status, 'no_matching_signed_receipt');
  assert.equal(f.state.patches.length, 2);
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


function reviewedPilotFixture() {
  const f=fixture();
  f.properties.set('BRIDGE_DELIVERY_ENABLED','true');
  f.properties.set('BRIDGE_AUTOMATIC_ENABLED','true');
  f.properties.set('BRIDGE_AUTOMATIC_MODE','pilot');
  f.properties.set('BRIDGE_AUTOMATIC_MAX_NEW','3');
  f.properties.set('BRIDGE_MIGRATION_ENABLED','false');
  const target={receipt_id:f.stored.receipt_id,record_hash:f.stored.record_hash,
    uid:f.stored.export.record.uid,page_id:PAGE};
  return Object.assign(f,{target,runReviewed:()=>clone(
    f.c.rposBridgeReviewedPilotExisting_(f.deps,target))});
}

test('reviewed existing pilot receipt recovers canonical ACK without new page or quota change',()=>{
  const f=reviewedPilotFixture(), original=clone(f.state.blocks),
    propertiesBefore=new Map(f.properties);
  const r=f.runReviewed();
  assert.equal(r.status,'confirmed');
  assert.equal(r.notion_confirmed,true);
  assert.equal(r.response_loss_recovered,true);
  assert.equal(r.replay_without_remote_writes,true);
  assert.equal(r.remote_write_calls,1);
  assert.equal(f.state.patches.length,2);
  assert.deepEqual(f.state.blocks[0],original[0]);
  assert.equal(f.state.blocks.length,2);
  assert.equal(f.state.pageCount,1);
  assert.deepEqual(f.properties.get('BRIDGE_AUTOMATIC_MAX_NEW'),'3');
  assert.deepEqual(f.properties.get('BRIDGE_AUTOMATIC_MODE'),'pilot');
  assert.deepEqual(f.properties.get('BRIDGE_MIGRATION_ENABLED'),'false');
  for(const key of ['BRIDGE_DELIVERY_ENABLED','BRIDGE_AUTOMATIC_ENABLED',
    'BRIDGE_AUTOMATIC_MAX_NEW','BRIDGE_AUTOMATIC_MODE']) {
    assert.equal(f.properties.get(key),propertiesBefore.get(key));
  }
  assert.equal(f.state.journal.get(f.stored.receipt_id).state,'confirmed');
  const canonical=JSON.parse(f.c.rposBridgePlain_(f.state.blocks[1].code.rich_text)
    .slice('rpos.notion.evidence.v2\n'.length));
  assert.equal(canonical.receipt_id,f.stored.receipt_id);
  assert.equal(canonical.record_hash,f.stored.record_hash);
  assert.deepEqual(canonical.record,f.stored.export.record);
  assert.equal(f.runReviewed().status,'no_matching_signed_receipt');
  assert.equal(f.state.patches.length,2);
});

test('reviewed existing pilot receipt rejects wrong target, hash, UID or duplicate without writes',()=>{
  for(const field of ['receipt_id','record_hash','uid','page_id']){
    const f=reviewedPilotFixture(),bad=clone(f.target);
    bad[field] = field==='uid'?'foreign-uid':
      field==='page_id'?'55555555-5555-5555-5555-555555555555':'f'.repeat(64);
    const r=f.c.rposBridgeReviewedPilotExisting_(f.deps,bad);
    assert.notEqual(r.status,'confirmed',field);
    assert.equal(f.state.patches.length,0,field);
    assert.equal(f.state.journal.size,0,field);
  }
  const f=reviewedPilotFixture();
  f.state.pageCount=2;
  const r=f.runReviewed();
  assert.notEqual(r.status,'confirmed');
  assert.equal(f.state.patches.length,0);
});

test('reviewed existing pilot receipt blocks missing original export or flag changes',()=>{
  const f=reviewedPilotFixture();
  f.state.blocks=[];
  assert.equal(f.runReviewed().status,'owner_export_requires_review');
  assert.equal(f.state.patches.length,0);
  const g=reviewedPilotFixture();
  g.deps.flagsOk=()=>false;
  assert.equal(g.runReviewed().status,'flags_require_review');
  assert.equal(g.state.patches.length,0);
});

test('reviewed existing pilot receipt preserves attempting journal on uncertain remote write',()=>{
  const f=reviewedPilotFixture();
  f.state.failAfterProperties=true;
  const result=f.runReviewed();
  assert.equal(result.status,'delivery_error');
  assert.equal(f.state.patches.length,2);
  assert.equal(f.state.journal.get(f.stored.receipt_id).state,'attempting');
  f.state.failAfterProperties=false;
  const next=f.runReviewed();
  assert.notEqual(next.status,'confirmed');
  assert.equal(f.state.patches.length,2);
});
