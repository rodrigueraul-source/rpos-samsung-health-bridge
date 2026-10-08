const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/BridgeDiagnostics.gs'), 'utf8');
const fakeKey = 'a'.repeat(64);
function fixture(overrides = {}, options = {}) {
  const properties = {BRIDGE_INTAKE_HMAC_KEY: fakeKey, BRIDGE_RECEIPT_FOLDER_ID: 'private-folder-fixture',
    NOTION_TOKEN: 'secret-test-token', BRIDGE_FITNESS_DATA_SOURCE_ID: 'abc-123', ...overrides};
  const before = JSON.stringify(properties);
  const logs = [];
  const forbidden = new Proxy({}, {get() {throw new Error('Forbidden service access');}});
  const context = {Logger: {log: text => logs.push(text)}, RPOS: {fitnessDataSourceId: 'abc123'},
    PropertiesService: {getScriptProperties: () => ({getProperty(name) {
      if (options.failRead) throw new Error('secret-test-token');
      return properties[name] ?? null;
    }})}, DriveApp: forbidden, UrlFetchApp: forbidden, ScriptApp: forbidden, LockService: forbidden};
  for (const name of ['rposBridgeHandle_', 'doPost', 'rposBridgeDeliverReceipt', 'rposBridgeNotionPort_',
    'rposBridgeMigrateReceipt', 'rposBridgeCreateGymCapture_', 'createGymCapturePage_',
    'rposBridgeLegacyCreateGymCapturePage_']) context[name] = () => {throw new Error('Must not invoke runtime');};
  if (options.missing) delete context[options.missing];
  vm.createContext(context);
  vm.runInContext(source, context);
  const result = context.rposBridgePreflight();
  assert.equal(JSON.stringify(properties), before);
  assert.equal(logs.length, 1);
  for (const secret of [fakeKey, 'secret-test-token', 'private-folder-fixture', 'abc-123']) {
    assert.equal(logs[0].includes(secret), false);
  }
  assert.equal(result.ready_for_activation, false);
  return result;
}
test('diagnostic reads only configuration, invokes no runtime and emits no values', () => {
  assert.equal(fixture().status, 'local_checks_pass_activation_not_approved');
});
test('missing runtime is distinguished from successful syntax/helper checks', () => {
  assert.equal(fixture({}, {missing: 'rposBridgeCreateGymCapture_'}).status, 'runtime_incomplete');
});
test('missing legacy scheduler is identified', () => {
  assert.equal(fixture({}, {missing: 'rposBridgeLegacyCreateGymCapturePage_'}).status, 'runtime_incomplete');
});
test('absent or malformed keys fail local checks without leaking supplied values', () => {
  for (const key of [null, '', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + ' ']) {
    assert.equal(fixture({BRIDGE_INTAKE_HMAC_KEY: key}).status, 'configuration_requires_review');
  }
});
test('different Fitness source blocks local pass', () => {
  assert.equal(fixture({BRIDGE_FITNESS_DATA_SOURCE_ID: 'different'}).status, 'configuration_requires_review');
});
test('each activation flag enabled or malformed requires review, with no reset', () => {
  for (const flag of ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED', 'BRIDGE_MIGRATION_ENABLED',
    'BRIDGE_SCHEDULER_BINDING_REVIEWED']) {
    for (const value of ['true', 'TRUE', ' false ']) {
      assert.equal(fixture({[flag]: value}).status, 'activation_flags_require_review');
    }
  }
});
test('read failure is redacted and never represented as pass', () => {
  assert.equal(fixture({}, {failRead: true}).status, 'configuration_read_failed');
});
test('full bundled runtime loads with no services and has one preflight entry', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../apps-script/BridgeRuntime.gs.txt'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(bundle, context, {timeout: 1000});
  assert.equal(typeof context.rposBridgePreflight, 'function');
  assert.equal(typeof context.rposBridgeCreateGymCapture_, 'function');
  assert.equal((bundle.match(/^function rposBridgePreflight\(/gm) || []).length, 1);
});
