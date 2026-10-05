// Synthetic data only. Node's test runner exercises the unchanged Apps Script files.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const files = ['BridgeIntake.gs', 'BridgeEndpoint.gs'].map(name =>
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', name), 'utf8'));
const NOW = 1800000000;
const KEY = 'a'.repeat(64); // Deliberately fake, never a production credential.
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const hmac = (text, key) => crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

test('shared Kotlin signing vector is accepted by the unchanged Apps Script intake core', () => {
  const vector = JSON.parse(fs.readFileSync(path.join(__dirname,
    '../app/src/test/resources/android_intake_vector.json'), 'utf8'));
  assert.equal(vector.synthetic_key, KEY);
  assert.equal(sha(vector.payload_json), vector.payload_sha256);
  const f = fixture();
  const request = {schema_version: 'rpos.exercise.intake.v1', sent_at: vector.sent_at,
    payload_json: vector.payload_json, signature: vector.signature};
  const result = f.handle(request);
  assert.equal(result.status, 'staged');
  assert.equal(result.receipt_id, vector.receipt_id);
  assert.equal(result.notion_confirmed, false);
  assert.deepEqual(f.state.files[0].value.export, JSON.parse(vector.payload_json));
});

function exercise() {
  return {
    schema_version: 'rpos.exercise.export.v1', source: 'samsung_health', sdk_version: '1.1.0',
    read_at: '2026-01-03T15:00:00.123Z', read_record_count: 1,
    record: {
      uid: 'synthetic-intake-001', start_time: '2026-01-03T12:00:00.123Z',
      end_time: '2026-01-03T13:00:00.456Z', zone_offset: '-06:00',
      update_time: '2026-01-03T13:01:00.000Z', source_app_id: 'synthetic.samsung.fixture',
      source_device_id: 'synthetic-device', client_data_id: null, client_version: null,
      exercise_type: 'OTHER', custom_title: 'Prueba sintética', duration_seconds: null,
      calories_kcal: null, distance_meters: null,
      sessions: [{start_time: '2026-01-03T12:00:00.500Z', end_time: '2026-01-03T12:10:00.000Z',
        exercise_type: 'WALKING', duration_millis: 300000, calories_kcal: 20,
        distance_meters: null, mean_heart_rate_bpm: null, max_heart_rate_bpm: null,
        min_heart_rate_bpm: null, custom_title: null}]
    }
  };
}

function envelope(value = exercise(), sentAt = NOW) {
  const payload_json = JSON.stringify(value);
  return {schema_version: 'rpos.exercise.intake.v1', sent_at: sentAt, payload_json,
    signature: hmac('rpos.exercise.intake.v1\n' + sentAt + '\n' + sha(payload_json), KEY)};
}

function fixture() {
  const context = vm.createContext({Date, Number, JSON});
  files.forEach(source => vm.runInContext(source, context));
  const state = {intents: new Map(), files: [], creates: 0, acquired: 0, released: 0};
  const deps = {
    enabled: true, key: KEY, nowSeconds: () => NOW,
    byteLength: text => Buffer.byteLength(text), sha256: sha, hmac,
    lock: {tryLock: () => {state.acquired++; return true;}, releaseLock: () => {state.released++;}},
    store: {
      getIntent: id => state.intents.has(id) ? clone(state.intents.get(id)) : null,
      setIntent: (id, value) => state.intents.set(id, clone(value)),
      find: id => state.files.filter(file => file.value.receipt_id === id).map(clone),
      create: (id, value) => {
        state.creates++;
        const file = {id: 'file-' + state.creates, value: clone(value)};
        state.files.push(file);
        return {id: file.id};
      }
    }
  };
  return {context, state, deps, handle: (request = envelope()) =>
    clone(context.rposBridgeHandle_(typeof request === 'string' ? request : JSON.stringify(request), deps))};
}

test('stages original UID/fields, nulls, milliseconds and UTF-8 without inferring metrics', () => {
  const f = fixture();
  const result = f.handle();
  assert.equal(result.status, 'staged');
  assert.equal(result.notion_confirmed, false);
  assert.equal(result.retryable, false);
  assert.deepEqual(f.state.files[0].value.export, exercise());
  assert.equal(result.receipt_id, sha(JSON.stringify(['samsung_health', exercise().record.uid])));
  assert.equal(f.state.released, 1);
});

test('same UID on another acquisition/reordered record is one durable receipt across invocations', () => {
  const f = fixture();
  const first = f.handle();
  const next = exercise();
  next.read_at = '2026-01-04T10:00:00Z'; next.read_record_count = 89;
  next.record = Object.fromEntries(Object.entries(next.record).reverse());
  const restarted = fixture();
  restarted.state.intents = f.state.intents; restarted.state.files = f.state.files;
  const second = restarted.handle(envelope(next));
  assert.deepEqual(second, first);
  assert.equal(restarted.state.creates, 0);
  assert.equal(f.state.files.length, 1);
});

test('changed record under the same original UID is quarantined, never overwritten', () => {
  const f = fixture(); f.handle();
  const changed = exercise(); changed.record.custom_title = 'Edited';
  assert.equal(f.handle(envelope(changed)).status, 'record_changed');
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.files[0].value.export.record.custom_title, 'Prueba sintética');
});

test('different UID gets a different receipt', () => {
  const f = fixture(); const first = f.handle();
  const other = exercise(); other.record.uid = 'synthetic-intake-002';
  const second = f.handle(envelope(other));
  assert.notEqual(second.receipt_id, first.receipt_id);
  assert.equal(f.state.creates, 2);
});

for (const [name, change, status] of [
  ['wrong signature', value => {value.signature = '0'.repeat(64);}, 'unauthorized'],
  ['tampered payload', value => {value.payload_json += ' ';}, 'unauthorized'],
  ['stale timestamp', value => Object.assign(value, envelope(exercise(), NOW - 301)), 'unauthorized'],
  ['future timestamp', value => Object.assign(value, envelope(exercise(), NOW + 301)), 'unauthorized'],
  ['bad schema', value => {value.schema_version = 'other';}, 'invalid_request'],
  ['bad timestamp type', value => {value.sent_at = String(NOW);}, 'invalid_request']
]) {
  test(name + ' cannot reach storage', () => {
    const f = fixture(); const request = envelope(); change(request);
    f.deps.store.getIntent = () => {throw Error('unauthorized storage access');};
    assert.equal(f.handle(request).status, status);
    assert.equal(f.state.acquired, 0); assert.equal(f.state.creates, 0);
  });
}

for (const [name, change] of [
  ['mock source', value => {value.source = 'mock';}],
  ['wrong SDK', value => {value.sdk_version = 'old';}],
  ['missing UID', value => {delete value.record.uid;}],
  ['whitespace UID', value => {value.record.uid = ' another ';}],
  ['missing timezone', value => {value.record.start_time = '2026-01-03T12:00:00';}],
  ['invalid calendar day', value => {value.record.start_time = '2026-02-30T12:00:00Z';}],
  ['invalid end order', value => {value.record.end_time = '2026-01-03T11:00:00Z';}],
  ['negative metric', value => {value.record.calories_kcal = -1;}],
  ['overflow number', value => {value.record.distance_meters = 1e309;}],
  ['string metric', value => {value.record.sessions[0].duration_millis = '300000';}],
  ['outside record', value => {value.record.sessions[0].end_time = '2026-01-03T14:00:00Z';}],
  ['invalid offset', value => {value.record.zone_offset = '+14:30';}]
]) {
  test(name + ' is rejected before persistence', () => {
    const f = fixture(); const value = exercise(); change(value);
    // JSON cannot encode Infinity; inject its valid JSON exponent representation.
    let request = envelope(value);
    if (name === 'overflow number') {
      request.payload_json = request.payload_json.replace('"distance_meters":null', '"distance_meters":1e309');
      request.signature = hmac('rpos.exercise.intake.v1\n' + NOW + '\n' + sha(request.payload_json), KEY);
    }
    assert.equal(f.handle(request).status, 'invalid_request');
    assert.equal(f.state.creates, 0);
  });
}

test('nullable SDK fields stay nullable; plain workouts need no segment array', () => {
  const f = fixture(); const value = exercise();
  ['end_time', 'zone_offset', 'update_time', 'source_app_id', 'sessions'].forEach(key => {value.record[key] = null;});
  assert.equal(f.handle(envelope(value)).status, 'staged');
  assert.deepEqual(f.state.files[0].value.export, value);
});

test('size limit uses UTF-8 bytes and rejects before parsing/storage', () => {
  const f = fixture();
  assert.equal(f.handle('é'.repeat(140000)).status, 'invalid_request');
  assert.equal(f.state.acquired, 0);
});

test('disabled/unconfigured endpoints cannot write', () => {
  const f = fixture(); f.deps.enabled = false;
  assert.equal(f.handle().status, 'disabled');
  f.deps.enabled = true; f.deps.key = 'short';
  assert.equal(f.handle().status, 'not_configured');
  assert.equal(f.state.creates, 0);
});

test('contention returns busy without releasing another invocation lock', () => {
  const f = fixture(); f.deps.lock.tryLock = () => false;
  assert.equal(f.handle().status, 'busy');
  assert.equal(f.state.creates, 0); assert.equal(f.state.released, 0);
});

test('lost Drive create response is recovered by readback, without another create', () => {
  const f = fixture(); const create = f.deps.store.create;
  f.deps.store.create = (id, value) => {create(id, value); throw Error('response lost');};
  assert.equal(f.handle().status, 'storage_error');
  assert.equal(f.state.intents.values().next().value.state, 'writing');
  assert.equal(f.handle().status, 'staged');
  assert.equal(f.state.creates, 1);
});

test('uncertain create with empty lookup remains unresolved, never retried blindly', () => {
  const f = fixture(); f.deps.store.create = () => {throw Error('unknown outcome');};
  assert.equal(f.handle().status, 'storage_error');
  assert.equal(f.handle().status, 'storage_unresolved');
  assert.equal(f.state.creates, 0); assert.equal(f.state.intents.size, 1);
});

test('temporary visibility gap after create is recovered without duplicating file', () => {
  const f = fixture(); const find = f.deps.store.find; let calls = 0;
  f.deps.store.find = id => ++calls === 2 ? [] : find(id);
  assert.equal(f.handle().status, 'storage_unresolved');
  assert.equal(f.handle().status, 'staged'); assert.equal(f.state.creates, 1);
});

test('missing confirmed-staging file does not produce a replacement', () => {
  const f = fixture(); f.handle(); f.state.files = [];
  assert.equal(f.handle().status, 'storage_unresolved'); assert.equal(f.state.creates, 1);
});

test('duplicate/corrupted receipt files fail closed', () => {
  const f = fixture(); f.handle(); f.state.files.push(clone(f.state.files[0]));
  assert.equal(f.handle().status, 'storage_conflict'); assert.equal(f.state.creates, 1);
  f.state.files.pop(); f.state.files[0].value.export.record.uid = 'tampered';
  assert.equal(f.handle().status, 'storage_conflict');
});

test('journal readback failure forbids Drive create', () => {
  const f = fixture(); f.deps.store.setIntent = () => {};
  assert.equal(f.handle().status, 'storage_conflict'); assert.equal(f.state.creates, 0);
});

test('quota/journal failure is safe before create and can recover after persisted file', () => {
  const f = fixture(); const save = f.deps.store.setIntent; let calls = 0;
  f.deps.store.setIntent = (id, intent) => {
    if (++calls === 2) throw Error('quota');
    return save(id, intent);
  };
  assert.equal(f.handle().status, 'storage_error');
  assert.equal(f.handle().status, 'staged'); assert.equal(f.state.creates, 1);
});

test('raw service exceptions never leak health data, tokens or stack traces', () => {
  const f = fixture(); f.deps.store.find = () => {throw Error('SECRET_TOKEN PRIVATE_HEALTH_PAYLOAD');};
  const text = JSON.stringify(f.handle());
  assert.equal(JSON.parse(text).status, 'storage_error');
  assert(!text.includes('SECRET_TOKEN')); assert(!text.includes('PRIVATE_HEALTH_PAYLOAD'));
  assert.equal(f.state.released, 1);
});

test('endpoint rejects unauthenticated JSON without opening Drive; uses JSON business status', () => {
  const f = fixture(); let accessedDrive = false;
  const values = {BRIDGE_INTAKE_ENABLED: 'true', BRIDGE_INTAKE_HMAC_KEY: KEY,
    BRIDGE_RECEIPT_FOLDER_ID: 'fake-private-folder'};
  Object.assign(f.context, {
    PropertiesService: {getScriptProperties: () => ({getProperty: key => values[key] || null})},
    DriveApp: {getFolderById: () => {accessedDrive = true; throw Error('no Drive for invalid auth');}},
    LockService: {getScriptLock: () => f.deps.lock},
    Utilities: {newBlob: text => ({getBytes: () => [...Buffer.from(text)]})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text =>
      ({text, setMimeType() {return this;}})}
  });
  const response = f.context.doPost({postData: {type: 'text/plain', contents: '{}'}});
  assert.equal(JSON.parse(response.text).status, 'invalid_request');
  const request = envelope(exercise(), Math.floor(Date.now() / 1000));
  request.signature = '0'.repeat(64);
  f.context.Utilities.Charset = {UTF_8: 'UTF-8'};
  f.context.Utilities.DigestAlgorithm = {SHA_256: 'sha256'};
  f.context.Utilities.computeDigest = (_, text) => [...Buffer.from(sha(text), 'hex')];
  f.context.Utilities.computeHmacSha256Signature = (text, key) => [...Buffer.from(hmac(text, key), 'hex')];
  assert.equal(JSON.parse(f.context.doPost({postData: {
    type: 'application/json', contents: JSON.stringify(request)
  }}).text).status, 'unauthorized');
  assert.equal(accessedDrive, false);
});

test('full doPost adapter persists/rediscovers receipt and journal through GAS-shaped services', () => {
  const f = fixture();
  const properties = new Map(Object.entries({BRIDGE_INTAKE_ENABLED: 'true',
    BRIDGE_INTAKE_HMAC_KEY: KEY, BRIDGE_RECEIPT_FOLDER_ID: 'fake-private-folder'}));
  const driveFiles = []; let activeLock = false; let writes = 0;
  const folder = {
    getFilesByName: name => {
      let index = 0; const matching = driveFiles.filter(file => file.name === name);
      return {hasNext: () => index < matching.length, next: () => matching[index++]};
    },
    createFile: (name, content, mime) => {
      assert.equal(mime, 'text/plain'); writes++;
      const file = {name, content, getId: () => 'gas-file-' + writes,
        getBlob: () => ({getDataAsString: () => content})};
      driveFiles.push(file); return file;
    }
  };
  Object.assign(f.context, {
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => {properties.set(key, value);}
    })},
    DriveApp: {getFolderById: id => {assert.equal(id, 'fake-private-folder'); return folder;}},
    MimeType: {PLAIN_TEXT: 'text/plain'},
    LockService: {getScriptLock: () => ({
      tryLock: () => {assert(!activeLock); activeLock = true; return true;},
      releaseLock: () => {assert(activeLock); activeLock = false;}
    })},
    Utilities: {
      newBlob: text => ({getBytes: () => [...Buffer.from(text)]}),
      Charset: {UTF_8: 'UTF-8'}, DigestAlgorithm: {SHA_256: 'sha256'},
      computeDigest: (_, text) => [...Buffer.from(sha(text), 'hex')].map(v => v > 127 ? v - 256 : v),
      computeHmacSha256Signature: (text, key) => [...Buffer.from(hmac(text, key), 'hex')].map(v => v > 127 ? v - 256 : v)
    },
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text =>
      ({text, setMimeType(type) {assert.equal(type, 'json'); return this;}})}
  });
  const request = () => ({postData: {type: 'application/json; charset=utf-8',
    contents: JSON.stringify(envelope(exercise(), Math.floor(Date.now() / 1000)))}});
  const first = JSON.parse(f.context.doPost(request()).text);
  const second = JSON.parse(f.context.doPost(request()).text);
  assert.equal(first.status, 'staged'); assert.deepEqual(second, first);
  assert.equal(first.notion_confirmed, false); assert.equal(writes, 1);
  assert(!activeLock);
  const persisted = JSON.parse(driveFiles[0].content);
  assert.deepEqual(persisted.export, exercise());
  assert(!driveFiles[0].content.includes(KEY)); assert(!('signature' in persisted));
  assert.equal(JSON.parse(properties.get('RPOS_BRIDGE_INTENT_' + first.receipt_id)).state, 'staged');
});
