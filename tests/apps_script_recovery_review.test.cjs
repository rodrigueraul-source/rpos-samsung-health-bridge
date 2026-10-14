// Only synthetic credentials/identities; exercise the owner review without services.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(__dirname + '/../apps-script/BridgeRecoveryReview.gs.txt', 'utf8');
const runtime = fs.readFileSync(__dirname + '/../apps-script/BridgeRuntime.gs.txt', 'utf8');
const repair = fs.readFileSync(__dirname + '/../apps-script/BridgeRuntimeHelpers.gs.txt', 'utf8');
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
    rposBridgeCanonical_: v => v,
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
  // Use the shipped UUID helper, rather than the former return-input mock.
  const helper = vm.createContext({}); vm.runInContext(runtime, helper);
  context.rposBridgeUuid_ = helper.rposBridgeUuid_;
  vm.runInContext(source, context);
  function run(endpoint = ENDPOINT) {
    const result = JSON.parse(JSON.stringify(context.rposBridgeRecoveryReviewRuntime_(endpoint)));
    assert.equal(state.writes, 0);
    const raw = JSON.stringify(result);
    for (const secret of [ID, HASH, KEY, 'private-token-canary', 'private-folder-canary',
      'private-uid-canary', 'private-response-canary', 'private-error-canary', DS, ENDPOINT, CONTENT]) {
      assert.equal(raw.includes(secret), false, 'review leaked private value');
    }
    return result;
  }
  return {run, state, values, calls, remoteBody, context};
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
test('source normalization uses actual runtime across separate files and lexical scheduler configuration', () => {
  const id = 'ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF';
  for (const [configured, scheduled] of [[id, id.toLowerCase().replaceAll('-', '')],
    [id.replaceAll('-', ''), id.toLowerCase()]]) {
    const f = fixture();
    f.values.BRIDGE_FITNESS_DATA_SOURCE_ID = configured;
    delete f.values['RPOS_BRIDGE_DELIVERY_' + ID];
    const context = vm.createContext({PropertiesService: f.context.PropertiesService});
    vm.runInContext('const RPOS = {fitnessDataSourceId: ' + JSON.stringify(scheduled) + '};', context);
    vm.runInContext(runtime, context); vm.runInContext(source, context);
    const r = context.rposBridgeRecoveryReviewRuntime_(ENDPOINT);
    assert.equal(r.review_revision, 2); assert.equal(r.configuration.source_matches_scheduler, true);
    assert.equal(r.source_check.status, 'matched'); assert.equal(r.source_check.runtime_uuid_status, 'ok');
    assert.equal(r.status, 'one_confirmed_receipt_required'); assert.equal(r.script_properties_unchanged, true);
    assert.equal(f.calls.length, 0); assert.equal(f.state.writes, 0);
    assert.equal(JSON.stringify(r).toLowerCase().includes('abcdefab'), false);
  }
});
test('missing UUID helper is not reported as a mismatched source', () => {
  const f = fixture(); delete f.context.rposBridgeUuid_;
  const r = f.run();
  assert.equal(r.configuration.source_matches_scheduler, true); assert.equal(r.source_check.status, 'matched');
  assert.equal(r.source_check.runtime_uuid_status, 'missing'); assert.equal(r.status, 'runtime_incomplete');
  assert.equal(r.runtime_present.uuid, false); assert.equal(f.calls.length, 0);
});
test('two-helper repair restores the observed incomplete bundle without changing its other functions', () => {
  const intact = vm.createContext({}); vm.runInContext(runtime, intact);
  const functions = ['rposBridgeSha_', 'rposBridgeUuid_'];
  let broken = runtime;
  for (const name of functions) broken = broken.replace(String(intact[name]), '');
  const f = fixture(); delete f.values['RPOS_BRIDGE_DELIVERY_' + ID];
  const context = vm.createContext({RPOS: {fitnessDataSourceId: DS},
    PropertiesService: f.context.PropertiesService,
    Utilities: {DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (algorithm, text, charset) => [...crypto.createHash(algorithm).update(text, charset).digest()]
        .map(byte => byte > 127 ? byte - 256 : byte)}});
  vm.runInContext(broken, context); vm.runInContext(source, context);
  const failed = context.rposBridgeRecoveryReviewRuntime_(ENDPOINT);
  assert.equal(failed.status, 'runtime_incomplete'); assert.equal(failed.configuration.source_matches_scheduler, true);
  assert.equal(failed.runtime_present.uuid, false); assert.equal(failed.runtime_present.sha256, false);
  const prior = {};
  for (const [name, value] of Object.entries(context)) if (typeof value === 'function') prior[name] = value;
  vm.runInContext(repair, context);
  for (const [name, value] of Object.entries(prior)) assert.equal(context[name], value);
  for (const name of functions) assert.equal(String(context[name]), String(intact[name]));
  const restored = context.rposBridgeRecoveryReviewRuntime_(ENDPOINT);
  assert.equal(restored.status, 'one_confirmed_receipt_required');
  assert.equal(restored.source_check.runtime_uuid_status, 'ok');
  assert.equal(Object.values(restored.runtime_present).every(Boolean), true);
  assert.equal(restored.script_properties_unchanged, true);
  // Known SHA-256 vector also exercises Apps Script's signed digest bytes.
  assert.equal(context.rposBridgeSha_('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(f.calls.length, 0); assert.equal(f.state.writes, 0);
});
test('throwing or incompatible UUID helpers are distinguished without exposing exceptions', () => {
  for (const helper of [() => {throw Error('private-error-canary');}, () => 'private-uid-canary']) {
    const f = fixture(); f.context.rposBridgeUuid_ = helper; const r = f.run();
    assert.equal(r.configuration.source_matches_scheduler, true); assert.equal(r.status, 'runtime_uuid_requires_review');
    assert.ok(['error', 'incompatible'].includes(r.source_check.runtime_uuid_status)); assert.equal(f.calls.length, 0);
  }
});
test('missing acknowledgement core stops before Drive and network', () => {
  const f = fixture(); delete f.context.rposBridgeAcknowledgement_; const r = f.run();
  assert.equal(r.configuration.source_matches_scheduler, true); assert.equal(r.status, 'runtime_incomplete');
  assert.equal(r.runtime_present.acknowledgement, false); assert.equal(f.calls.length, 0);
});
test('genuinely different valid sources are distinguished from helper failures', () => {
  const f = fixture(); f.values.BRIDGE_FITNESS_DATA_SOURCE_ID = '00000000-0000-4000-8000-000000000003';
  const r = f.run(); assert.equal(r.source_check.status, 'source_mismatch');
  assert.equal(r.configuration.source_matches_scheduler, false); assert.equal(r.status, 'configuration_requires_review');
  assert.equal(r.source_check.runtime_uuid_status, 'not_checked'); assert.equal(f.calls.length, 0);
});
test('absent scheduler configuration has its own safe reason', () => {
  const f = fixture(); delete f.context.RPOS; const r = f.run();
  assert.equal(r.source_check.status, 'scheduler_source_missing'); assert.equal(r.runtime_present.uuid, true);
  assert.equal(r.status, 'configuration_requires_review'); assert.equal(f.calls.length, 0);
});
test('malformed source identifiers stop without accepting or revealing supplied values', () => {
  for (const value of ['private-uid-canary', ' ' + DS, null, 123]) {
    const f = fixture(); f.values.BRIDGE_FITNESS_DATA_SOURCE_ID = value;
    const r = f.run(); assert.equal(r.source_check.status, 'configured_source_invalid');
    assert.equal(r.status, 'configuration_requires_review'); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.context.RPOS.fitnessDataSourceId = 'private-uid-canary';
  const r = f.run(); assert.equal(r.source_check.status, 'scheduler_source_invalid'); assert.equal(f.calls.length, 0);
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
