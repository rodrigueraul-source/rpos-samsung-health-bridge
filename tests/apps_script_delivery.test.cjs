// Synthetic service only: exercises the real .gs files without credentials/network.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const DS = '11111111-1111-1111-1111-111111111111';
const PAGE = '22222222-2222-2222-2222-222222222222';
const BLOCK = '33333333-3333-3333-3333-333333333333';
const SCHED = 'R-POS External Scheduler F';
const EVENT = 'rpos-gym-capture-synthetic';
const rt = text => [{type: 'text', text: {content: text}, annotations: {bold: true}, plain_text: text}];
const LEGACY = '44444444-4444-4444-4444-444444444444';
function context() {
  const c = vm.createContext({Date, JSON, Number, encodeURIComponent, decodeURIComponent});
  for (const file of ['BridgeIntake.gs', 'BridgeEndpoint.gs', 'BridgeDelivery.gs', 'BridgeNotion.gs', 'BridgeScheduler.gs', 'BridgeMigration.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', file), 'utf8'), c);
  }
  return c;
}

function migrationFixture() {
  const f = fixture();
  f.state.identity = {source: 'samsung_health', uid: f.stored.export.record.uid};
  f.state.blocks = [{id: LEGACY, type: 'paragraph', has_children: false,
    paragraph: {rich_text: rt('Bridge payload SHA256: `' + 'a'.repeat(64) + '`')}}];
  f.state.migrations = new Map();
  f.deps.migrationJournal = f.journal(f.state.migrations);
  f.migrationReview = {schema_version: 'rpos.bridge.migration.review.v1',
    receipt_id: f.stored.receipt_id, record_hash: f.stored.record_hash, target_page_id: PAGE,
    expected_snapshot_hash: f.c.rposBridgeMigrationSnapshot_(f.remote.read(PAGE), sha),
    review_basis: 'Synthetic original export/accepted v1 evidence and archived alias reviewed',
    aliases: [{source: SCHED, uid: EVENT, date: {start: '2026-01-03'}}]};
  f.migrationDeps = {...f.deps, journal: f.journal(f.state.migrations),
    deliveryJournal: f.deps.journal, reviews: {get: () => f.migrationReview}};
  f.migrate = () => clone(f.c.rposBridgeMigrate_(f.stored.receipt_id, f.migrationDeps));
  return f;
}

test('reviewed migration retains exact legacy blocks, appends v2 and alias; changes only Notes; repeat is zero-write', () => {
  const f = migrationFixture(), legacy = clone(f.state.blocks);
  assert.equal(f.migrate().status, 'confirmed');
  assert.deepEqual(f.state.blocks.slice(0, 1), legacy);
  assert.equal(f.state.blocks.length, 2);
  assert.deepEqual(Object.keys(f.state.patches[0].body.properties), ['Notes']);
  assert.equal(f.state.notes[0].annotations.bold, true);
  assert.equal(f.remote.read(PAGE).legacy, false);
  assert.equal(f.migrate().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
  assert.equal(f.deliver().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
  let creates = 0;
  assert.equal(f.scheduler(() => {creates++;}).reused, true);
  assert.equal(creates, 0);
});

for (const [fault, expected] of [['properties', 'unresolved'], ['evidence', 'confirmed']]) {
  test('migration restart after lost ' + fault + ' response never repeats writes', () => {
    const f = migrationFixture(); f.state.fail = fault;
    assert.equal(f.migrate().status, 'delivery_error');
    assert.equal(f.state.migrations.get(f.stored.receipt_id).state, 'attempting');
    delete f.state.fail; const writes = f.state.patches.length;
    assert.equal(f.migrate().status, expected);
    assert.equal(f.state.patches.length, writes);
  });
}

for (const change of [r => {r.expected_snapshot_hash = '0'.repeat(64);}, r => {r.record_hash = '0'.repeat(64);},
  r => {r.target_page_id = DS;}, r => {r.receipt_id = '0'.repeat(64);}, r => {r.review_basis = '';},
  r => {r.aliases.push(clone(r.aliases[0]));}, r => {r.aliases[0].uid = '';},
  r => {r.aliases[0].extra = true;}]) {
  test('migration refuses stale/wrong/ambiguous reviewed provenance before writes', () => {
    const f = migrationFixture(); change(f.migrationReview);
    assert.equal(f.migrate().notion_confirmed, false); assert.equal(f.state.patches.length, 0);
  });
}

test('migration absent review or disabled gate makes no writes', () => {
  const f = migrationFixture(); f.migrationDeps.enabled = false;
  assert.equal(f.migrate().status, 'disabled');
  f.migrationDeps.enabled = true; f.migrationReview = null;
  assert.equal(f.migrate().status, 'needs_reconciliation'); assert.equal(f.state.patches.length, 0);
});

test('migration cannot override existing ordinary delivery journal or duplicate alias target', () => {
  const f = migrationFixture(); f.state.intents.set(f.stored.receipt_id, {state: 'attempting'});
  assert.equal(f.migrate().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
  f.state.intents.clear(); f.remote.findAlias = () => [DS];
  assert.equal(f.migrate().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
});

test('migration journal save failure and concurrent page edit stop before remote writes', () => {
  const f = migrationFixture(); f.migrationDeps.journal.set = () => {throw Error('private quota failure');};
  assert.equal(f.migrate().status, 'delivery_error'); assert.equal(f.state.patches.length, 0);
  const g = migrationFixture(), read = g.remote.read; let reads = 0;
  g.remote.read = id => {if (++reads === 2) g.state.edited = 'concurrent'; return read(id);};
  assert.equal(g.migrate().status, 'delivery_conflict'); assert.equal(g.state.patches.length, 0);
});

test('migrated legacy removal/tamper or archived alias removal fails closed without rewrite', () => {
  for (const change of [f => {f.state.blocks.shift();},
    f => {f.state.blocks[0].paragraph.rich_text = rt('Bridge payload SHA256: `' + 'b'.repeat(64) + '`');},
    f => {f.state.notes = f.state.notes.slice(0, 1);}]) {
    const f = migrationFixture(); assert.equal(f.migrate().status, 'confirmed'); change(f);
    assert.equal(f.migrate().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 2);
    assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 2);
  }
});

test('read-only migration audit returns stable opaque plan without writes/health fields', () => {
  const f = migrationFixture();
  const result = clone(f.c.rposBridgeMigrationAudit_(f.stored.receipt_id, f.migrationDeps));
  assert.equal(result.status, 'ready_for_review');
  assert.equal(result.expected_snapshot_hash, f.migrationReview.expected_snapshot_hash);
  assert.equal(result.legacy_block_count, 1);
  assert.equal(JSON.stringify(result).includes(f.stored.export.record.uid), false);
  assert.equal(f.state.patches.length, 0); assert.equal(f.state.migrations.size, 0);
  f.remote.findUid = () => [PAGE, DS];
  assert.equal(f.c.rposBridgeMigrationAudit_(f.stored.receipt_id, f.migrationDeps).status, 'delivery_conflict');
});

test('ordinary delivery cannot accept a migrated block without its confirmed private migration journal', () => {
  const f = migrationFixture(); assert.equal(f.migrate().status, 'confirmed');
  f.state.migrations.clear();
  assert.equal(f.deliver().status, 'needs_migration'); assert.equal(f.state.patches.length, 2);
});
function fixture(previous) {
  const c = context();
  const record = {uid: 'synthetic-delivery-001', start_time: '2026-01-03T12:00:00.123Z',
    end_time: '2026-01-03T13:00:00.456Z', exercise_type: 'OTHER', custom_title: 'Prueba 😀',
    calories_kcal: null, distance_meters: null, duration_seconds: null, sessions: []};
  const stored = {schema_version: 'rpos.exercise.intake.stored.v1', state: 'staged',
    receipt_id: sha(JSON.stringify(['samsung_health', record.uid])),
    record_hash: sha(JSON.stringify(c.rposBridgeCanonical_(record))), export: {
      schema_version: 'rpos.exercise.export.v1', sdk_version: '1.1.0', source: 'samsung_health',
      read_at: '2026-01-03T14:00:00Z', read_record_count: 1, record}};
  const state = previous || {intents: new Map(), scheduler: new Map(), patches: [], releases: 0,
    identity: {source: SCHED, uid: EVENT}, edited: '2026-01-03T11:00:00.000Z', blocks: [],
    notes: rt('Manual note: preserve links/formatting'), hidden: false};
  function list(results, rest = {}) {return {object: 'list', results, has_more: false, next_cursor: null, ...rest};}
  function page() {
    return {object: 'page', id: PAGE, url: 'https://www.notion.so/' + PAGE.replace(/-/g, ''),
      parent: {type: 'data_source_id', data_source_id: DS}, in_trash: false,
      last_edited_time: state.edited, properties: {
        Session: {type: 'title'}, Source: {id: 'src', type: 'rich_text'},
        'Source Record ID': {id: 'uid', type: 'rich_text'}, Notes: {id: 'notes', type: 'rich_text'},
        Date: {type: 'date', date: {start: '2026-01-03'}},
        'Capture State': {type: 'select', select: {name: 'Pending'}},
        Calories: {type: 'number', number: 999}}};
  }
  const http = {request(method, url, body) {
    if (method === 'GET' && url === '/data_sources/' + DS) return {id: DS, properties: page().properties};
    if (url === '/data_sources/' + DS + '/query') {
      if (state.hidden) return list([]);
      const f = body.filter;
      if (f.and) return list(f.and[0].rich_text.equals === state.identity.source &&
        f.and[1].rich_text.equals === state.identity.uid ? [page()] : []);
      return list(state.notes.some(t => t.text && t.text.content.includes(f.rich_text.contains)) ? [page()] : []);
    }
    if (method === 'GET' && url === '/pages/' + PAGE) return page();
    if (url.includes('/properties/')) {
      const prop = url.split('/properties/')[1].split('?')[0];
      const items = prop === 'src' ? rt(state.identity.source) : prop === 'uid' ? rt(state.identity.uid) : state.notes;
      return list(items.map(rich_text => ({type: 'rich_text', rich_text})));
    }
    if (method === 'GET' && url.startsWith('/blocks/')) return list(state.blocks);
    if (method === 'PATCH') {
      state.patches.push(clone({url, body}));
      if (url === '/pages/' + PAGE) {
        if (body.properties.Source) state.identity = {source: c.rposBridgePlain_(body.properties.Source.rich_text),
          uid: c.rposBridgePlain_(body.properties['Source Record ID'].rich_text)};
        if (body.properties.Notes) state.notes = clone(body.properties.Notes.rich_text);
        state.edited = '2026-01-03T14:00:00.000Z';
        if (state.fail === 'properties') throw Error('lost property response SECRET');
        return {id: PAGE};
      }
      state.blocks.push({id: BLOCK, type: 'code', has_children: false, code: clone(body.children[0].code)});
      if (state.fail === 'evidence') throw Error('lost evidence response SECRET');
      return list(state.blocks);
    }
    throw Error('Unexpected request ' + method + url);
  }};
  const remote = c.rposBridgeNotionPort_(http, DS, sha);
  const journal = map => ({get: id => map.has(id) ? clone(map.get(id)) : null,
    set: (id, value) => map.set(id, clone(value))});
  const review = {schema_version: 'rpos.bridge.review.v2', source: 'samsung_health', uid: record.uid,
    record_hash: stored.record_hash, target_page_id: PAGE, expected_last_edited_time: state.edited,
    expected_source: state.identity.source, expected_uid: state.identity.uid, review_basis: 'Synthetic sequence/window reviewed'};
  const deps = {enabled: true, sha256: sha,
    lock: {tryLock: () => true, releaseLock: () => {state.releases++;}},
    store: {find: () => [{id: 'synthetic-file', value: clone(stored)}],
      getIntent: () => ({receipt_id: stored.receipt_id, state: 'staged', file_id: 'synthetic-file', record_hash: stored.record_hash})},
    journal: journal(state.intents), reviews: {get: () => review}, remote};
  return {c, state, stored, deps, review, http, remote, journal,
    deliver: () => clone(c.rposBridgeDeliver_(stored.receipt_id, deps)),
    scheduler: create => clone(c.rposBridgeScheduler_(EVENT, {...deps, journal: journal(state.scheduler)}, create))};
}

function proseMigrationFixture() {
  const f = migrationFixture();
  f.state.blocks = [
    {id: LEGACY, type: 'heading_2', has_children: false,
      heading_2: {rich_text: rt('Samsung Health Bridge · UID reconciliation · 03-Jan-2026')}},
    {id: '55555555-5555-5555-5555-555555555555', type: 'paragraph', has_children: false,
      paragraph: {rich_text: rt('Previously accepted export and provenance retained')}},
    {id: '66666666-6666-6666-6666-666666666666', type: 'table_row', has_children: false,
      table_row: {cells: [rt('Original metric'), rt('12.5')]}}
  ];
  f.migrationReview.expected_snapshot_hash = f.c.rposBridgeMigrationSnapshot_(f.remote.read(PAGE), sha);
  return f;
}

test('accepted prose reconciliation audits all originals without inventing a v1 hash', () => {
  const f = proseMigrationFixture();
  const audit = clone(f.c.rposBridgeMigrationAudit_(f.stored.receipt_id, f.migrationDeps));
  assert.equal(audit.status, 'ready_for_review');
  assert.equal(audit.legacy_block_count, 3);
  assert.equal(f.state.patches.length, 0);
  assert.equal(f.deliver().status, 'needs_migration');
  const before = clone(f.state.blocks);
  assert.equal(f.migrate().status, 'confirmed');
  assert.deepEqual(f.state.blocks.slice(0, 3), before);
  assert.equal(f.state.patches.length, 2);
  assert.equal(f.migrate().status, 'confirmed');
  assert.equal(f.deliver().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
});

test('prose migration rejects changed table cells or formatting before any write', () => {
  for (const change of [f => {f.state.blocks[2].table_row.cells[1] = rt('99');},
    f => {f.state.blocks[1].paragraph.rich_text[0].annotations.bold = false;}]) {
    const f = proseMigrationFixture(); change(f);
    assert.equal(f.migrate().status, 'needs_reconciliation');
    assert.equal(f.state.patches.length, 0);
  }
});

test('migrated prose removal or table-cell tamper fails closed without rewriting', () => {
  for (const change of [f => {f.state.blocks.splice(1, 1);},
    f => {f.state.blocks[2].table_row.cells[1] = rt('99');}]) {
    const f = proseMigrationFixture(); assert.equal(f.migrate().status, 'confirmed'); change(f);
    assert.equal(f.migrate().status, 'delivery_conflict');
    assert.equal(f.deliver().status, 'delivery_conflict');
    assert.equal(f.state.patches.length, 2);
  }
});

test('unrelated or partial prose heading cannot authorize migration', () => {
  for (const title of ['A workout on 03-Jan-2026', 'Samsung Health Bridge · UID reconciliation']) {
    const f = proseMigrationFixture(); f.state.blocks[0].heading_2.rich_text = rt(title);
    f.migrationReview.expected_snapshot_hash = f.c.rposBridgeMigrationSnapshot_(f.remote.read(PAGE), sha);
    assert.equal(f.c.rposBridgeMigrationAudit_(f.stored.receipt_id, f.migrationDeps).status, 'needs_reconciliation');
    assert.equal(f.migrate().status, 'needs_reconciliation');
    assert.equal(f.state.patches.length, 0);
  }
});

test('reviewed existing page delivered/read back; preserves metrics, Notes, alias, and repeated receipt is zero-write', () => {
  const f = fixture();
  assert.equal(f.deliver().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
  const patch = f.state.patches[0].body.properties;
  assert.deepEqual(Object.keys(patch).sort(), ['Date', 'Notes', 'Source', 'Source Record ID']);
  assert.equal(patch.Notes.rich_text[0].annotations.bold, true);
  assert.equal(patch.Date.date.start, f.stored.export.record.start_time);
  assert.deepEqual(clone(f.remote.read(PAGE).evidence.record), f.stored.export.record);
  assert.equal(f.remote.findAlias(SCHED, EVENT)[0], PAGE);
  assert.equal(fixture(f.state).deliver().status, 'confirmed');
  assert.equal(f.state.patches.length, 2);
});

test('scheduler reuses archived alias after canonical Samsung UID replacement; zero creates', () => {
  const f = fixture(); f.deliver(); let creates = 0;
  const result = f.scheduler(() => {creates++;});
  assert.equal(result.ok, true); assert.equal(result.reused, true); assert.equal(result.page_id, PAGE);
  assert.equal(creates, 0);
});

for (const [fault, expected] of [['properties', 'unresolved'], ['evidence', 'confirmed']]) {
  test('restart after lost ' + fault + ' response reads evidence without rewriting', () => {
    const f = fixture(); f.state.fail = fault;
    assert.equal(f.deliver().status, 'delivery_error');
    assert.equal(f.state.intents.get(f.stored.receipt_id).state, 'attempting');
    const writes = f.state.patches.length; delete f.state.fail;
    assert.equal(fixture(f.state).deliver().status, expected);
    assert.equal(f.state.patches.length, writes);
  });
}

test('visibility gap after uncertain write remains unresolved and cannot create/write', () => {
  const f = fixture(); f.state.fail = 'evidence'; f.deliver(); f.state.hidden = true;
  const writes = f.state.patches.length;
  assert.equal(fixture(f.state).deliver().status, 'unresolved');
  assert.equal(f.state.patches.length, writes);
});

test('confirmed evidence disappearing is a conflict, never a rewrite', () => {
  const f = fixture(); f.deliver(); f.state.blocks = [];
  assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 2);
});

test('missing review never writes/creates even if a UID has already been set manually', () => {
  const f = fixture(); f.state.identity = {source: 'samsung_health', uid: f.stored.export.record.uid};
  f.deps.reviews.get = () => null;
  assert.equal(f.deliver().status, 'needs_reconciliation'); assert.equal(f.state.patches.length, 0);
});

for (const change of [r => {r.record_hash = '0'.repeat(64);}, r => {r.expected_last_edited_time = 'stale';},
  r => {r.expected_uid = 'another';}, r => {r.review_basis = '';}, r => {r.target_page_id = DS;}]) {
  test('hash/identity/time/target-bound review precondition blocks stale or wrong target', () => {
    const f = fixture(); change(f.review);
    assert.equal(f.deliver().notion_confirmed, false); assert.equal(f.state.patches.length, 0);
  });
}

test('existing Python v1/legacy evidence is stopped for explicit migration without overwriting', () => {
  const f = fixture(); f.state.blocks = [{type: 'code', code: {rich_text: rt('rpos.notion.evidence.v1\n{}')}}];
  assert.equal(f.deliver().status, 'needs_migration'); assert.equal(f.state.patches.length, 0);
});

test('cannot replace another Samsung UID even with an erroneous review', () => {
  const f = fixture(); f.state.identity = {source: 'samsung_health', uid: 'other-samsung-uid'};
  Object.assign(f.review, {expected_source: 'samsung_health', expected_uid: 'other-samsung-uid'});
  assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
});

test('journal quota failure or corrupt readback occurs before any remote write', () => {
  for (const broken of ['throw', 'readback']) {
    const f = fixture();
    f.deps.journal.set = () => {if (broken === 'throw') throw Error('quota SECRET');};
    assert.equal(f.deliver().notion_confirmed, false); assert.equal(f.state.patches.length, 0);
  }
});

test('duplicate UID query remains conflict including a match on later page', () => {
  const f = fixture(), original = f.http.request;
  f.http.request = (method, url, body) => {
    if (method === 'POST') return {object: 'list', results: [{object: 'page', id: PAGE}],
      has_more: !body.start_cursor, next_cursor: body.start_cursor ? null : 'second'};
    return original(method, url, body);
  };
  assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
});

test('repeated pagination cursor cannot be treated as complete/unique', () => {
  const f = fixture(), original = f.http.request;
  f.http.request = (method, url, body) => method === 'POST' ?
    {object: 'list', results: [], has_more: true, next_cursor: 'loop'} : original(method, url, body);
  assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
});

test('rich text pagination retains late Notes formatting and rejects substring alias false positives', () => {
  const f = fixture(); const marker = f.c.rposBridgeAlias_(SCHED, EVENT, sha);
  f.state.notes = rt('prefix ' + marker + ' suffix');
  assert.equal(f.remote.findAlias(SCHED, EVENT).length, 0);
  const original = f.http.request;
  f.http.request = (method, url, body) => {
    if (url.includes('/properties/notes')) return {object: 'list', results: [
      {type: 'rich_text', rich_text: rt(url.includes('start_cursor') ? '\n' + marker + '\n' : 'manual')[0]}],
      has_more: !url.includes('start_cursor'), next_cursor: url.includes('start_cursor') ? null : 'tail'};
    return original(method, url, body);
  };
  assert.equal(f.remote.findAlias(SCHED, EVENT)[0], PAGE);
  assert.equal(f.remote.read(PAGE).notes.length, 2);
});

test('wrong source parent/trash/schema blocks all writes', () => {
  for (const kind of ['parent', 'trash', 'schema']) {
    const f = fixture(), original = f.http.request;
    f.http.request = (method, url, body) => {
      const r = original(method, url, body);
      if (kind === 'schema' && url === '/data_sources/' + DS) r.properties.Notes.type = 'number';
      if (url === '/pages/' + PAGE) {
        if (kind === 'parent') r.parent.data_source_id = BLOCK;
        if (kind === 'trash') r.in_trash = true;
      }
      return r;
    };
    assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
  }
});

test('tampered and duplicate v2 evidence cannot confirm', () => {
  for (const kind of ['tamper', 'duplicate']) {
    const f = fixture(); f.deliver();
    if (kind === 'duplicate') f.state.blocks.push(clone(f.state.blocks[0]));
    else {
      const code = f.state.blocks[0].code;
      code.rich_text[0].text.content = code.rich_text[0].text.content.replace('Prueba', 'Cambio');
    }
    assert.equal(f.deliver().notion_confirmed, false); assert.equal(f.state.patches.length, 2);
  }
});

test('another editor changing page during preparation blocks the first PATCH', () => {
  const f = fixture(), prepare = f.remote.prepare;
  f.remote.prepare = (...args) => {const p = prepare(...args); f.state.edited = 'changed'; return p;};
  assert.equal(f.deliver().status, 'delivery_conflict'); assert.equal(f.state.patches.length, 0);
});

test('lock contention and disabled coordinator do not read or write', () => {
  const f = fixture(); f.deps.lock.tryLock = () => false;
  f.deps.store.find = () => {throw Error('should not read');};
  assert.equal(f.deliver().status, 'busy'); assert.equal(f.state.releases, 0);
  f.deps.enabled = false; assert.equal(f.deliver().status, 'disabled');
});

test('scheduler create response lost: restart finds direct page, zero extra creates', () => {
  const f = fixture(); f.state.hidden = true; let creates = 0;
  assert.equal(f.scheduler(() => {creates++; f.state.hidden = false; throw Error('lost');}).ok, false);
  assert.equal(fixture(f.state).scheduler(() => {creates++;}).reused, true);
  assert.equal(creates, 1);
});

test('scheduler empty lookup after attempted create remains unresolved', () => {
  const f = fixture(); f.state.hidden = true; let creates = 0;
  f.scheduler(() => {creates++; throw Error('lost');});
  assert.equal(fixture(f.state).scheduler(() => {creates++;}).stage, 'bridge_scheduler_unresolved');
  assert.equal(creates, 1);
});

test('scheduler direct identity plus different aliased target is conflict', () => {
  const f = fixture(); f.remote.findAlias = () => [BLOCK]; let creates = 0;
  assert.equal(f.scheduler(() => {creates++;}).ok, false); assert.equal(creates, 0);
});

test('alias format matches Python ensure_ascii v1 including Unicode and DEL', () => {
  const c = context();
  assert.equal(c.rposBridgeAlias_('a😀', 'é\u007f', sha),
    'rpos.alias.v1:' + sha('["a\\ud83d\\ude00","\\u00e9\\u007f"]'));
});

test('Notes/evidence UTF-8 and item limits are preflighted before either write', () => {
  for (const text of ['x'.repeat(205000), '😀'.repeat(130000)]) {
    const f = fixture(); f.stored.export.record.custom_title = 'short';
    f.stored.export.record.extra_original = text;
    f.stored.record_hash = sha(JSON.stringify(f.c.rposBridgeCanonical_(f.stored.export.record)));
    f.review.record_hash = f.stored.record_hash;
    assert.equal(f.deliver().notion_confirmed, false); assert.equal(f.state.patches.length, 0);
  }
});

test('single-attempt fixed-origin HTTP redacts errors and does not follow redirects', () => {
  const c = context(); let calls = 0;
  c.Utilities = {newBlob: s => ({getBytes: () => Buffer.from(s)})};
  c.UrlFetchApp = {fetch(url, options) {
    calls++; assert.equal(url, 'https://api.notion.com/v1/pages/' + PAGE);
    assert.equal(options.followRedirects, false); assert.equal(options.headers['Notion-Version'], '2026-03-11');
    return {getResponseCode: () => 429, getContentText: () => 'SECRET'};
  }};
  assert.throws(() => c.rposBridgeNotionHttp_('synthetic-token').request('PATCH', '/pages/' + PAGE, {}), /delivery_error/);
  assert.equal(calls, 1);
  assert.throws(() => c.rposBridgeNotionHttp_('synthetic-token').request('GET', '//evil.test'), /delivery_conflict/);
  assert.equal(calls, 1);
});

test('operator runtime adapter uses dedicated Fitness source and persistent property journal', () => {
  const f = fixture(), props = new Map([
    ['BRIDGE_DELIVERY_ENABLED', 'true'], ['BRIDGE_SCHEDULER_BINDING_REVIEWED', 'true'],
    ['BRIDGE_RECEIPT_FOLDER_ID', 'synthetic-folder'],
    ['NOTION_TOKEN', 'synthetic-token'], ['BRIDGE_FITNESS_DATA_SOURCE_ID', DS],
    ['NOTION_DATA_SOURCE_ID', BLOCK],
    ['RPOS_BRIDGE_REVIEW_' + f.stored.receipt_id, JSON.stringify(f.review)]]);
  const propertyStore = {getProperty: k => props.get(k), setProperty: (k, v) => props.set(k, v)};
  f.c.PropertiesService = {getScriptProperties: () => propertyStore};
  f.c.LockService = {getScriptLock: () => f.deps.lock};
  f.c.RPOS = {fitnessDataSourceId: DS};
  f.c.rposBridgeDriveStore_ = () => f.deps.store;
  f.c.rposBridgeSha_ = sha;
  f.c.rposBridgeNotionHttp_ = token => {assert.equal(token, 'synthetic-token'); return f.http;};
  assert.equal(f.c.rposBridgeDeliverReceipt(f.stored.receipt_id).status, 'confirmed');
  assert.equal(JSON.parse(props.get('RPOS_BRIDGE_DELIVERY_' + f.stored.receipt_id)).state, 'confirmed');
  props.set('BRIDGE_FITNESS_DATA_SOURCE_ID', BLOCK);
  assert.equal(f.c.rposBridgeDeliverReceipt(f.stored.receipt_id).status, 'not_configured');
  props.set('BRIDGE_FITNESS_DATA_SOURCE_ID', DS);
  props.delete('BRIDGE_SCHEDULER_BINDING_REVIEWED');
  assert.equal(f.c.rposBridgeDeliverReceipt(f.stored.receipt_id).status, 'not_configured');
  props.set('BRIDGE_SCHEDULER_BINDING_REVIEWED', 'true');
  props.delete('BRIDGE_DELIVERY_ENABLED');
  assert.equal(f.c.rposBridgeDeliverReceipt(f.stored.receipt_id).status, 'disabled');
  props.set('BRIDGE_DELIVERY_ENABLED', 'true'); props.delete('BRIDGE_FITNESS_DATA_SOURCE_ID');
  assert.equal(f.c.rposBridgeDeliverReceipt(f.stored.receipt_id).status, 'not_configured');
});

test('doPost dispatches optional delivery only after authenticated staging; outer receipt stays unconfirmed', () => {
  const c = context(); let deliveryCalls = 0, staged = false;
  c.PropertiesService = {getScriptProperties: () => ({getProperty: key => ({
    BRIDGE_INTAKE_ENABLED: 'true', BRIDGE_INTAKE_HMAC_KEY: 'a'.repeat(64),
    BRIDGE_RECEIPT_FOLDER_ID: 'synthetic-folder', BRIDGE_DELIVERY_ENABLED: 'true'})[key]})};
  c.LockService = {getScriptLock: () => ({})};
  c.ContentService = {MimeType: {JSON: 'json'}, createTextOutput: text => ({text, setMimeType() {return this;}})};
  c.rposBridgeHandle_ = () => c.rposBridgeResult_(staged ? 'staged' : 'unauthorized', '0'.repeat(64), '1'.repeat(64));
  c.rposBridgeDeliverReceipt = () => {deliveryCalls++; return c.rposBridgeDeliveryResult_('confirmed');};
  const event = {postData: {type: 'application/json', contents: '{}'}};
  assert.equal(JSON.parse(c.doPost(event).text).status, 'unauthorized'); assert.equal(deliveryCalls, 0);
  staged = true;
  const result = JSON.parse(c.doPost(event).text);
  assert.equal(result.notion_confirmed, false); assert.equal(result.delivery.notion_confirmed, true);
  assert.equal(deliveryCalls, 1);
});
