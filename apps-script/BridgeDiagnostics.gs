/* Read-only local configuration check. No network, Drive, trigger or data writes.
 * This is NOT a connectivity, permissions, delivery or deployment approval.
 * Never log property values, source IDs, keys or exception messages.
 */
function rposBridgePreflight() {
  const result = {
    schema_version: 'rpos.bridge.preflight.v1',
    scope: 'runtime_and_local_configuration_only',
    runtime_present: {
      intake: typeof rposBridgeHandle_ === 'function',
      endpoint: typeof doPost === 'function',
      delivery: typeof rposBridgeDeliverReceipt === 'function',
      notion: typeof rposBridgeNotionPort_ === 'function',
      migration: typeof rposBridgeMigrateReceipt === 'function',
      scheduler: typeof rposBridgeCreateGymCapture_ === 'function'
    },
    scheduler_functions_present: {
      entry: typeof createGymCapturePage_ === 'function',
      legacy: typeof rposBridgeLegacyCreateGymCapturePage_ === 'function'
    },
    not_checked: ['scheduler_binding_body', 'drive_privacy_and_access',
      'notion_connectivity_and_schema', 'historical_receipts_and_aliases',
      'deployment', 'device_delivery_and_recovery'],
    ready_for_activation: false
  };
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('BRIDGE_INTAKE_HMAC_KEY');
    const source = props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    const folder = props.getProperty('BRIDGE_RECEIPT_FOLDER_ID');
    const token = props.getProperty('NOTION_TOKEN');
    result.configuration = {
      hmac_present: typeof key === 'string' && key.length > 0,
      hmac_format_valid: typeof key === 'string' && /^[a-f0-9]{64}$/.test(key),
      receipt_folder_present: typeof folder === 'string' && folder.trim().length > 0,
      notion_token_present: typeof token === 'string' && token.trim().length > 0,
      fitness_source_matches_scheduler: typeof source === 'string' && source.length > 0 &&
        typeof RPOS !== 'undefined' && !!RPOS &&
        typeof RPOS.fitnessDataSourceId === 'string' &&
        source.replace(/-/g, '').toLowerCase() === RPOS.fitnessDataSourceId.replace(/-/g, '').toLowerCase()
    };
    result.activation_flags = {};
    ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED', 'BRIDGE_MIGRATION_ENABLED',
      'BRIDGE_SCHEDULER_BINDING_REVIEWED'].forEach(function(name) {
      const value = props.getProperty(name);
      result.activation_flags[name] = value === 'true' ? 'enabled' :
        value === 'false' ? 'disabled' : value === null ? 'unset' : 'invalid';
    });
    const runtimeOk = Object.keys(result.runtime_present).every(function(k) { return result.runtime_present[k]; });
    const schedulerOk = Object.keys(result.scheduler_functions_present).every(function(k) {
      return result.scheduler_functions_present[k];
    });
    const configOk = Object.keys(result.configuration).every(function(k) { return result.configuration[k]; });
    const disabled = Object.keys(result.activation_flags).every(function(k) {
      return result.activation_flags[k] === 'disabled' || result.activation_flags[k] === 'unset';
    });
    result.status = !runtimeOk || !schedulerOk ? 'runtime_incomplete' :
      !disabled ? 'activation_flags_require_review' :
      !configOk ? 'configuration_requires_review' : 'local_checks_pass_activation_not_approved';
  } catch (ignore) {
    result.status = 'configuration_read_failed';
  }
  Logger.log(JSON.stringify(result));
  return result;
}

/* Read-only operational audit. Runs only with activation flags OFF.
 * It checks existing staged receipts and journals; it never repairs them.
 * The injected HTTP port permits only GET and data-source query POST.
 * IDs, record fields, property values and exceptions never enter the report.
 */
function rposBridgeBindingPath_(entry) {
  if (typeof entry !== 'function') return 'missing';
  const text = Function.prototype.toString.call(entry).replace(/\s+/g, '');
  const head = 'functioncreateGymCapturePage_(cfg,event,plan,now){return';
  if (text === head + 'rposBridgeLegacyCreateGymCapturePage_(cfg,event,plan,now);}' ||
      text === head + 'rposBridgeLegacyCreateGymCapturePage_(cfg,event,plan,now)}') return 'legacy';
  if (text === head + 'rposBridgeCreateGymCapture_(cfg,event,plan,now,rposBridgeLegacyCreateGymCapturePage_);}' ||
      text === head + 'rposBridgeCreateGymCapture_(cfg,event,plan,now,rposBridgeLegacyCreateGymCapturePage_)}') return 'bridge';
  return 'unrecognized';
}

function rposBridgeReadOnlyHttp_(http, pacing) {
  const started = pacing ? pacing.now() : 0;
  let last = null;
  return {request: function(method, path, payload) {
    if (method !== 'GET' && !(method === 'POST' &&
        /^\/data_sources\/[a-f0-9-]+\/query$/.test(path))) {
      rposBridgeFailure_('audit_write_blocked');
    }
    if (pacing) {
      if (pacing.now() - started > 180000) rposBridgeFailure_('audit_incomplete');
      if (last !== null) {
        const wait = 350 - (pacing.now() - last);
        if (wait > 0) pacing.wait(wait);
      }
      if (pacing.now() - started > 180000) rposBridgeFailure_('audit_incomplete');
      last = pacing.now();
    }
    return http.request(method, path, payload);
  }};
}

function rposBridgeReadinessAudit_(deps) {
  const report = {schema_version: 'rpos.bridge.readiness.audit.v1',
    scope: 'existing_receipts_journals_and_notion_read_only',
    ready_for_activation: false, status: 'audit_error',
    checked: {receipts: 0, delivery_journals: 0, migration_journals: 0,
      scheduler_journals: 0, aliases: 0},
    not_checked: ['drive_inherited_permissions', 'deployment_and_access',
      'device_delivery_and_real_recovery', 'single_writer_outside_this_project']};
  const namespaces = ['RPOS_BRIDGE_INTENT_', 'RPOS_BRIDGE_DELIVERY_',
    'RPOS_BRIDGE_MIGRATION_', 'RPOS_BRIDGE_SCHEDULER_'];
  let locked = false;
  function fail(code) { rposBridgeFailure_(code); }
  function budget() { if (deps.now() - started > 180000) fail('audit_incomplete'); }
  function snapshot() {
    const keys = deps.keys().filter(function(k) {
      return namespaces.some(function(prefix) { return k.indexOf(prefix) === 0; }) &&
        k.indexOf('RPOS_BRIDGE_MIGRATION_REVIEW_') !== 0;
    }).sort();
    if (keys.length > 100) fail('audit_incomplete');
    const values = Object.create(null);
    keys.forEach(function(k) { values[k] = deps.get(k); });
    return values;
  }
  function value(raw) {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail('journal_requires_review');
    return v;
  }
  const started = deps.now();
  try {
    if (!deps.flagsOff) { report.status = 'activation_flags_require_review'; return report; }
    locked = deps.lock.tryLock(1000);
    if (!locked) { report.status = 'busy'; return report; }
    const before = snapshot(), keys = Object.keys(before);
    const receipts = keys.filter(function(k) { return k.indexOf(namespaces[0]) === 0; });
    if (!receipts.length) fail('no_receipts_to_audit');
    if (receipts.length > 4) fail('audit_incomplete');
    keys.forEach(function(k) {
      const prefix = namespaces.find(function(p) { return k.indexOf(p) === 0; });
      if (!/^[a-f0-9]{64}$/.test(k.slice(prefix.length))) fail('journal_requires_review');
      if (prefix === namespaces[1] || prefix === namespaces[2]) {
        if (!(namespaces[0] + k.slice(prefix.length) in before)) fail('journal_requires_review');
      }
    });
    receipts.forEach(function(k) {
      budget();
      const id = k.slice(namespaces[0].length), intent = value(before[k]);
      const files = deps.store.find(id);
      if (files.length !== 1) fail('storage_requires_review');
      const stored = files[0].value;
      rposBridgeVerifyStored_(stored, id, stored && stored.record_hash, deps);
      if (intent.state !== 'staged' || intent.receipt_id !== id ||
          intent.record_hash !== stored.record_hash || intent.file_id !== files[0].id) {
        fail('storage_requires_review');
      }
      const ids = deps.remote.findUid('samsung_health', stored.export.record.uid);
      if (ids.length !== 1) fail('identity_requires_review');
      const page = deps.remote.read(ids[0]), ev = page.evidence;
      if (page.legacy || !ev || page.source !== 'samsung_health' ||
          page.uid !== stored.export.record.uid || ev.receipt_id !== id ||
          ev.record_hash !== stored.record_hash ||
          JSON.stringify(rposBridgeCanonical_(ev.record)) !==
          JSON.stringify(rposBridgeCanonical_(stored.export.record))) fail('evidence_requires_review');
      const deliveryRaw = before[namespaces[1] + id];
      if (deliveryRaw) {
        const delivery = value(deliveryRaw);
        if (delivery.state !== 'confirmed' || delivery.receipt_id !== id ||
            delivery.record_hash !== stored.record_hash || delivery.page_id !== page.id) {
          fail('journal_requires_review');
        }
        report.checked.delivery_journals++;
      }
      const migrationRaw = before[namespaces[2] + id];
      if (ev.migration) {
        if (!migrationRaw) fail('journal_requires_review');
        const migration = value(migrationRaw);
        if (migration.state !== 'confirmed' || migration.receipt_id !== id ||
            migration.record_hash !== stored.record_hash || migration.page_id !== page.id ||
            !rposBridgeMigrationConfirmed_(page, stored, migration, deps.remote, deps.sha256)) {
          fail('journal_requires_review');
        }
        report.checked.migration_journals++;
      } else if (migrationRaw) { fail('journal_requires_review'); }
      if (!Array.isArray(ev.aliases) || ev.aliases.length > 20) fail('alias_requires_review');
      ev.aliases.forEach(function(alias) {
        budget();
        const direct = deps.remote.findUid(alias.source, alias.uid);
        const matches = deps.remote.findAlias(alias.source, alias.uid);
        if (matches.length !== 1 || matches[0] !== page.id ||
            direct.some(function(p) { return p !== page.id; })) fail('alias_requires_review');
        report.checked.aliases++;
      });
      const fresh = deps.remote.read(page.id), unique = deps.remote.findUid('samsung_health', page.uid);
      if (unique.length !== 1 || unique[0] !== page.id ||
          rposBridgeMigrationSnapshot_(fresh, deps.sha256) !==
          rposBridgeMigrationSnapshot_(page, deps.sha256)) fail('snapshot_changed');
      report.checked.receipts++;
    });
    keys.filter(function(k) { return k.indexOf(namespaces[3]) === 0; }).forEach(function(k) {
      budget();
      const intent = value(before[k]), source = 'R-POS External Scheduler F';
      if (!rposBridgeText_(intent.event_id, 256) || intent.state !== 'confirmed' ||
          deps.sha256(JSON.stringify([source, intent.event_id])) !== k.slice(namespaces[3].length)) {
        fail('journal_requires_review');
      }
      const ids = deps.remote.findUid(source, intent.event_id).concat(deps.remote.findAlias(source, intent.event_id));
      const unique = ids.filter(function(id, i) { return ids.indexOf(id) === i; });
      if (unique.length !== 1 || unique[0] !== intent.page_id) fail('alias_requires_review');
      deps.remote.read(unique[0]);
      report.checked.scheduler_journals++;
    });
    if (JSON.stringify(before) !== JSON.stringify(snapshot())) fail('snapshot_changed');
    report.status = 'live_reads_pass_activation_not_approved';
  } catch (error) {
    const safe = ['audit_incomplete', 'no_receipts_to_audit', 'journal_requires_review',
      'storage_requires_review', 'identity_requires_review', 'evidence_requires_review',
      'alias_requires_review', 'snapshot_changed'];
    report.status = safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'audit_error';
  } finally { if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} } }
  return report;
}

// Select this one operator for the next existing-project read-only review.
function rposBridgeReadinessAudit() {
  let result = {schema_version: 'rpos.bridge.readiness.audit.v1', status: 'audit_error',
    ready_for_activation: false};
  try {
    const props = PropertiesService.getScriptProperties();
    const flags = ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED',
      'BRIDGE_MIGRATION_ENABLED', 'BRIDGE_SCHEDULER_BINDING_REVIEWED'];
    const off = flags.every(function(k) {
      const v = props.getProperty(k); return v === null || v === 'false';
    });
    const source = props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    if (!off) { result.status = 'activation_flags_require_review'; }
    else if (typeof RPOS === 'undefined' || !RPOS ||
        rposBridgeUuid_(source) !== rposBridgeUuid_(RPOS.fitnessDataSourceId)) {
      result.status = 'configuration_requires_review';
    } else {
      const store = rposBridgeDriveStore_(props.getProperty('BRIDGE_RECEIPT_FOLDER_ID'), props);
      const http = rposBridgeReadOnlyHttp_(rposBridgeNotionHttp_(props.getProperty('NOTION_TOKEN')),
        {now: function() { return Date.now(); }, wait: function(ms) { Utilities.sleep(ms); }});
      result = rposBridgeReadinessAudit_({flagsOff: true, now: function() { return Date.now(); },
        keys: function() { return props.getKeys(); }, get: function(k) { return props.getProperty(k); },
        lock: LockService.getScriptLock(), sha256: rposBridgeSha_,
        store: {find: function(id) { return store.find(id); }},
        remote: rposBridgeNotionPort_(http, source, rposBridgeSha_)});
      if (!flags.every(function(k) {
        const v = props.getProperty(k); return v === null || v === 'false';
      })) result.status = 'activation_flags_require_review';
      result.scheduler_binding = rposBridgeBindingPath_(
        typeof createGymCapturePage_ === 'function' ? createGymCapturePage_ : null);
      if (result.scheduler_binding === 'missing' || result.scheduler_binding === 'unrecognized') {
        result.status = 'scheduler_binding_requires_review';
      }
    }
  } catch (ignore) { result.status = 'audit_error'; }
  Logger.log(JSON.stringify(result));
  return result;
}
