// Only synthetic credentials/identities; exercise the owner review without services.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(__dirname + '/../apps-script/BridgeRecoveryReview.gs.txt', 'utf8');
const ENDPOINT = 'https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT/exec';
const CONTENT = 'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic';
const ID = '1'.repeat(64), HASH = '2'.repeat(64), KEY = 'b'.repeat(64);
const DS = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const values = {BRIDGE_INTAKE_ENABLED: 'true', BRIDGE_DELIVERY_ENABLED: 'false',
    BRIDGE_MIGRATION_ENABLED: 'false', BRIDGE_SCHEDULER_BINDING_REVIEWED: 'true',
    BRIDGE_INTAKE_HMAC_KEY: KEY, NOTION_TOKEN: 'private-token-canary',
    BRIDGE_RECEIPT_FOLDER_ID: 'private-folder-canary', BRIDGE_FITNESS_DATA_SOURCE_ID: DS};
  values['RPOS_BRIDGE_DELIVERY_' + ID] = JSON.stringify({receipt_id: ID, record_hash: HASH, state: 'confirmed'});
  const calls = [], state = {writes: 0, localStatus: 'confirmed', httpCode: 200,
    remoteCode: 200, redirect: CONTENT, remoteType: 'application/json', localDelay: 0};
  let clock = 1800000000000;
  function response(code, body, headers = {'Content-Type': 'application/json'}) {
    return {getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
      getAllHeaders: () => headers};
  }
  const remoteBody = {schema_version: 'rpos.exercise.acknowledgement.receipt.v1',
    status: 'confirmed', notion_confirmed: true, receipt_id: ID, record_hash: HASH,
    ignored_secret: 'private-response-canary'};
  const fail = code => {const e = new Error('private-error-canary'); e.bridgeCode = code; throw e;};
  const props = {getProperties: () => ({...values}), getProperty: k => values[k] ?? null,
    getKeys: () => Object.keys(values), setProperty: () => {state.writes++; throw Error('mutation');}};
  const context = vm.createContext({Date: {now: () => clock}, JSON, RPOS: {fitnessDataSourceId: DS},
    PropertiesService: {getScriptProperties: () => props},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
    Utilities: {Charset: {UTF_8: 'utf8'}, newBlob: text => ({getBytes: () => Buffer.from(text, 'utf8')}),
      computeHmacSha256Signature: (text, key) => [...crypto.createHmac('sha256', key).update(text).digest()]},
    rposBridgeUuid_: v => {if (typeof v !== 'string') fail('invalid_request'); return v;},
    rposBridgeSha_: text => crypto.createHash('sha256').update(text).digest('hex'),
    rposBridgeHex_: bytes => Buffer.from(bytes).toString('hex'), rposBridgeFailure_: fail,
    rposBridgeDriveStore_: () => ({find: () => [], getIntent: () => null,
      create: () => {state.writes++; throw Error('mutation');}, setIntent: () => {state.writes++; throw Error('mutation');}}),
    rposBridgeNotionPort_: http => ({read: () => {
      const paths = state.localPaths || [['GET', '/data_sources/' + DS],
        ['POST', '/data_sources/' + DS + '/query', {filter: {uid: 'private-uid-canary'}}],
        ['GET', '/blocks/00000000-0000-4000-8000-000000000002/children?page_size=100']];
      for (const args of paths) http.request(...args);
    }}),
    rposBridgeAcknowledgement_: (receipt, deps) => {
      try {deps.remote().read();} catch (e) {
        return {schema_version: 'rpos.exercise.delivery.receipt.v1', status: 'delivery_error', notion_confirmed: false};
      }
      if (state.change) values['RPOS_BRIDGE_DELIVERY_' + ID] += 'changed';
      if (state.localThrow) throw Error('private-error-canary');
      clock += state.localDelay;
      return {schema_version: 'rpos.exercise.delivery.receipt.v1',
        status: state.localStatus, notion_confirmed: state.localStatus === 'confirmed', ignored_secret: KEY};
    },
    UrlFetchApp: {fetch: (url, options) => {
      calls.push({url, options}); clock += 20;
      if (url.startsWith('https://api.notion.com/')) return response(state.httpCode, {private_body: 'private-response-canary'});
      if (state.remoteThrow) throw Error('private-error-canary');
      if (url === ENDPOINT && state.redirect !== false) return response(302, '', {Location: state.redirect});
      return response(state.remoteCode, state.raw ?? remoteBody, {'Content-Type': state.remoteType});
    }}
  });
  vm.runInContext(source, context);
  function run(endpoint = ENDPOINT) {
    const result = JSON.parse(JSON.stringify(context.rposBridgeRecoveryReviewRuntime_(endpoint)));
    assert.equal(state.writes, 0);
    const raw = JSON.stringify(result);
    for (const secret of [ID, HASH, KEY, 'private-token-canary', 'private-folder-canary',
      'private-uid-canary', 'private-response-canary', 'private-error-canary', ENDPOINT, CONTENT]) {
      assert.equal(raw.includes(secret), false, 'review leaked private value');
    }
    return result;
  }
  return {run, state, values, calls, remoteBody};
}
test('review source loads without service calls or automatic execution', () => {
  vm.runInContext(source, vm.createContext({}));
});
test('server confirmations are reported with no Android or Bridge PASS claim and no mutations/secrets', () => {
  const f = fixture(), r = f.run();
  assert.equal(r.status, 'server_reads_confirmed_android_recovery_not_checked');
  assert.equal(r.script_properties_unchanged, true); assert.equal(r.local.notion_confirmed, true);
  assert.equal(r.deployed.authenticated_identity_matches, true);
  assert.deepEqual(r.local_notion_http.map(x => x.stage), ['schema', 'uid_query', 'evidence_children']);
  const post = f.calls.find(x => x.url === ENDPOINT), body = JSON.parse(post.options.payload);
  assert.deepEqual(Object.keys(body).sort(), ['receipt_id','record_hash','schema_version','sent_at','signature']);
  assert.equal(body.signature, crypto.createHmac('sha256', KEY).update(body.schema_version + '\n' +
    body.sent_at + '\n' + ID + '\n' + HASH).digest('hex'));
  const redirect = f.calls.find(x => x.url === CONTENT);
  assert.equal(redirect.options.method, 'get'); assert.equal(redirect.options.payload, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(redirect.options.headers)), {Accept: 'application/json'});
});
test('unsafe URL is rejected before any read or network', () => {
  for (const endpoint of ['http://script.google.com/macros/s/abc/exec', ENDPOINT + '?extra=1',
    'https://example.test/exec', ENDPOINT.replace('/exec', '/dev')]) {
    const f = fixture(); assert.equal(f.run(endpoint).status, 'existing_endpoint_required'); assert.equal(f.calls.length, 0);
  }
});
test('unexpected flags and malformed credential configuration stop before network', () => {
  for (const [key, value] of [['BRIDGE_DELIVERY_ENABLED', 'true'], ['BRIDGE_MIGRATION_ENABLED', 'true'],
    ['BRIDGE_SCHEDULER_BINDING_REVIEWED', 'false'], ['BRIDGE_INTAKE_ENABLED', 'invalid']]) {
    const f = fixture(); f.values[key] = value; assert.equal(f.run().status, 'flags_require_review'); assert.equal(f.calls.length, 0);
  }
  for (const [key, value] of [['BRIDGE_INTAKE_HMAC_KEY', 'wrong'], ['NOTION_TOKEN', 'x\ny'],
    ['BRIDGE_RECEIPT_FOLDER_ID', ''], ['BRIDGE_FITNESS_DATA_SOURCE_ID', 'another']]) {
    const f = fixture(); f.values[key] = value; assert.equal(f.run().status, 'configuration_requires_review'); assert.equal(f.calls.length, 0);
  }
});
test('missing, ambiguous, malformed and excessive journals never select a different receipt', () => {
  const f = fixture(); delete f.values['RPOS_BRIDGE_DELIVERY_' + ID];
  assert.equal(f.run().status, 'one_confirmed_receipt_required'); assert.equal(f.calls.length, 0);
  const g = fixture(), other = '3'.repeat(64);
  g.values['RPOS_BRIDGE_DELIVERY_' + other] = JSON.stringify({receipt_id: other, record_hash: HASH, state: 'confirmed'});
  assert.equal(g.run().status, 'one_confirmed_receipt_required'); assert.equal(g.calls.length, 0);
  const h = fixture(); h.values['RPOS_BRIDGE_DELIVERY_' + ID] = 'private-invalid-json';
  assert.equal(h.run().status, 'journal_requires_review'); assert.equal(h.calls.length, 0);
  const i = fixture(); for (let n=0; n<101; n++) i.values['RPOS_BRIDGE_DELIVERY_EXTRA_' + n] = '{}';
  assert.equal(i.run().status, 'bounded_selection_required'); assert.equal(i.calls.length, 0);
});
test('Notion HTTP failure reports only phase/code/timing and preserves both server outcomes', () => {
  const f = fixture(); f.state.httpCode = 429; const r = f.run();
  assert.equal(r.status, 'server_review_required'); assert.equal(r.local.status, 'delivery_error');
  assert.equal(r.local_notion_http[0].http_status, 429); assert.equal(r.deployed.status, 'confirmed');
});
test('Notion firewall denies mutation methods and POST outside the configured query', () => {
  for (const args of [['PATCH','/pages/private'], ['POST','/pages'], ['POST','/data_sources/another/query'],
    ['DELETE','/blocks/private'], ['GET','/users/private']]) {
    const f = fixture(); f.state.localPaths = [args];
    assert.equal(f.run().local.status, 'delivery_error');
    assert.equal(f.calls.some(x => x.url.startsWith('https://api.notion.com/')), false);
  }
});
test('long server duration is measured rather than declared phone success', () => {
  const f = fixture(); f.state.localDelay = 35000; const r = f.run();
  assert.ok(r.local.elapsed_ms >= 35000); assert.equal(r.scope, 'server_receipt_read_only_not_android_recovery');
});
test('external property change stops before signed deployed query', () => {
  const f = fixture(); f.state.change = true; const r = f.run();
  assert.equal(r.status, 'concurrent_change_requires_review'); assert.equal(r.script_properties_unchanged, false);
  assert.equal(f.calls.some(x => x.url === ENDPOINT), false);
});
test('prior intake deployment format is identified without leaking response', () => {
  const f = fixture(); f.state.raw = JSON.stringify({schema_version:'rpos.exercise.intake.receipt.v1',
    status:'invalid_request', notion_confirmed:false, private_value: KEY});
  assert.equal(f.run().deployed.status, 'backend_update_required');
});
test('confirmation of another identity and contradictory confirmation are rejected', () => {
  const f = fixture(); f.remoteBody.receipt_id = '4'.repeat(64); assert.equal(f.run().deployed.status, 'receipt_conflict');
  const g = fixture(); g.remoteBody.notion_confirmed = false; assert.equal(g.run().deployed.status, 'invalid_response');
});
test('malformed, oversized and private HTML bodies cannot confirm or leak', () => {
  for (const raw of ['<html>private-token-canary</html>', 'private-invalid-json', 'x'.repeat(4097), 'null']) {
    const f = fixture(); f.state.raw = raw; assert.equal(f.run().deployed.status, 'invalid_response');
  }
});
test('foreign or malformed content redirect is never fetched', () => {
  for (const redirect of ['https://example.test/echo?x=1', 'https://script.googleusercontent.com/other?x=1',
    CONTENT + '#fragment', CONTENT + '\nunsafe']) {
    const f = fixture(); f.state.redirect = redirect; assert.equal(f.run().deployed.status, 'endpoint_access');
    assert.equal(f.calls.length, 4); // Three local reads plus the existing endpoint POST.
  }
});
test('remote HTTP retries, access wall and transport failure never become confirmation', () => {
  const f = fixture(); f.state.remoteCode = 503; assert.equal(f.run().deployed.status, 'http_retry');
  const g = fixture(); g.state.remoteType = 'text/html'; assert.equal(g.run().deployed.status, 'endpoint_access');
  const h = fixture(); h.state.remoteThrow = true; const r = h.run();
  assert.equal(r.deployed.status, 'transport_error'); assert.equal(r.status, 'review_error_details_suppressed');
});
