const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/BridgePilotOperator.gs.txt'), 'utf8');
function fixture() {
  const flags = ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED', 'BRIDGE_MIGRATION_ENABLED', 'BRIDGE_SCHEDULER_BINDING_REVIEWED'];
  const values = Object.fromEntries(flags.map(k => [k, 'false']));
  values.RPOS_BRIDGE_INTENT_PRIVATE = 'private-health-journal';
  let binding = 'legacy', preflight = 'local_checks_pass_activation_not_approved', audit = 'live_reads_pass_activation_not_approved';
  let acquired = 0, released = 0, busy = false, change = false, configChange = false, loseReadback = false, reads = 0;
  const writes = [], logs = [];
  const props = {getKeys: () => Object.keys(values), getProperty: k => k in values ? values[k] : null,
    setProperty: (k, v) => {writes.push([k, v]); if (!loseReadback) values[k] = v;}};
  const c = vm.createContext({PropertiesService: {getScriptProperties: () => props},
    LockService: {getScriptLock: () => ({tryLock: () => {acquired++; return !busy;}, releaseLock: () => {released++;}})},
    Logger: {log: t => logs.push(t)}, createGymCapturePage_: () => {},
    rposBridgeBindingPath_: () => binding,
    rposBridgePreflight: () => ({status: preflight}),
    rposBridgeReadinessAudit: () => {reads++; if (change) values.RPOS_BRIDGE_INTENT_PRIVATE += 'changed'; if (configChange) values.BRIDGE_RECEIPT_FOLDER_ID = 'changed-private-folder'; return {status: audit, scheduler_binding: binding};}});
  vm.runInContext(source, c);
  function run() { const r = c.rposBridgeEnableIntakePilot(); assert.equal(r.full_bridge_enabled, false); assert.equal(r.notion_delivery_enabled, false); assert.equal(logs.join('').includes('private-health-journal'), false); return r.status; }
  return {values, writes, run, counts: () => ({acquired, released, reads}),
    binding: v => {binding = v;}, preflight: v => {preflight = v;}, audit: v => {audit = v;},
    busy: () => {busy = true;}, change: () => {change = true;}, configChange: () => {configChange = true;}, loseReadback: () => {loseReadback = true;}};
}
test('approved staging operator changes only intake and releases the lock', () => {
  const f = fixture(); assert.equal(f.run(), 'authenticated_staging_enabled');
  assert.deepEqual(f.writes, [['BRIDGE_INTAKE_ENABLED', 'true']]);
  assert.equal(f.values.BRIDGE_DELIVERY_ENABLED, 'false'); assert.equal(f.values.BRIDGE_MIGRATION_ENABLED, 'false');
  assert.equal(f.values.BRIDGE_SCHEDULER_BINDING_REVIEWED, 'false');
  assert.deepEqual(f.counts(), {acquired: 1, released: 1, reads: 1});
  assert.equal(f.run(), 'flags_or_binding_require_review'); assert.equal(f.writes.length, 1);
});
test('enabled, absent and malformed flags or changed binding stop before audit or mutation', () => {
  for (const value of ['true', 'TRUE', null]) {const f = fixture(); f.values.BRIDGE_DELIVERY_ENABLED = value; assert.equal(f.run(), 'flags_or_binding_require_review'); assert.equal(f.writes.length, 0); assert.equal(f.counts().reads, 0);}
  const f = fixture(); f.binding('bridge'); assert.equal(f.run(), 'flags_or_binding_require_review'); assert.equal(f.writes.length, 0);
});
test('configuration and audit failure never enable intake', () => {
  const f = fixture(); f.preflight('configuration_requires_review'); assert.equal(f.run(), 'configuration_requires_review'); assert.equal(f.counts().reads, 0); assert.equal(f.writes.length, 0);
  const g = fixture(); g.audit('journal_requires_review'); assert.equal(g.run(), 'live_audit_requires_review'); assert.equal(g.writes.length, 0);
});
test('busy lock and changed journals stop without mutation', () => {
  const f = fixture(); f.busy(); assert.equal(f.run(), 'busy'); assert.equal(f.writes.length, 0); assert.equal(f.counts().released, 0);
  const g = fixture(); g.change(); assert.equal(g.run(), 'concurrent_change_requires_review'); assert.equal(g.writes.length, 0); assert.equal(g.counts().released, 1);
});
test('uncertain flag write is reported for review rather than a false success', () => {
  const f = fixture(); f.loseReadback(); assert.equal(f.run(), 'activation_readback_requires_review'); assert.equal(f.counts().released, 1);
});
test('configuration changed during the audit cannot activate an unreviewed destination', () => {
  const f = fixture(); f.configChange(); assert.equal(f.run(), 'concurrent_change_requires_review'); assert.equal(f.writes.length, 0); assert.equal(f.counts().released, 1);
});
