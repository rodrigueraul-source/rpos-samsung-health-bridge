/* R-POS Bridge intake v1: authenticated staging only; no Notion writes. */
function rposBridgeFailure_(code) {
  const error = new Error(code);
  error.bridgeCode = code;
  throw error;
}

function rposBridgeCanonical_(value, depth) {
  depth = depth || 0;
  if (depth > 40) rposBridgeFailure_('invalid_request');
  if (Array.isArray(value)) {
    return value.map(function(item) { return rposBridgeCanonical_(item, depth + 1); });
  }
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    Object.keys(value).sort().forEach(function(key) {
      result[key] = rposBridgeCanonical_(value[key], depth + 1);
    });
    return result;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    rposBridgeFailure_('invalid_request');
  }
  return value;
}

function rposBridgeText_(value, max) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= max && value === value.trim() && !/[\u0000-\u001f]/.test(value);
}

function rposBridgeTime_(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    rposBridgeFailure_('invalid_request');
  }
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  const date = new Date(0);
  date.setUTCFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (date.getUTCFullYear() !== Number(parts[1]) ||
      date.getUTCMonth() + 1 !== Number(parts[2]) || date.getUTCDate() !== Number(parts[3]) ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) {
    rposBridgeFailure_('invalid_request');
  }
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && (Number(offset[1]) > 14 || Number(offset[2]) > 59 ||
      (Number(offset[1]) === 14 && Number(offset[2]) !== 0))) {
    rposBridgeFailure_('invalid_request');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) rposBridgeFailure_('invalid_request');
  return time;
}

function rposBridgeMetric_(value) {
  return value === null || value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function rposBridgeValidateExport_(value) {
  if (!value || value.schema_version !== 'rpos.exercise.export.v1' ||
      value.source !== 'samsung_health' || value.sdk_version !== '1.1.0' ||
      !Number.isSafeInteger(value.read_record_count) || value.read_record_count < 1) {
    rposBridgeFailure_('invalid_request');
  }
  rposBridgeTime_(value.read_at);
  const record = value.record;
  if (!record || Array.isArray(record) || typeof record !== 'object' ||
      !rposBridgeText_(record.uid, 128) || !rposBridgeText_(record.exercise_type, 128) ||
      (record.source_app_id != null && !rposBridgeText_(record.source_app_id, 256)) ||
      (record.custom_title != null && (typeof record.custom_title !== 'string' || record.custom_title.length > 1000)) ||
      (record.zone_offset != null && (typeof record.zone_offset !== 'string' ||
        !/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(record.zone_offset))) ||
      (record.sessions != null && (!Array.isArray(record.sessions) || record.sessions.length > 500))) {
    rposBridgeFailure_('invalid_request');
  }
  const start = rposBridgeTime_(record.start_time);
  const end = record.end_time == null ? null : rposBridgeTime_(record.end_time);
  if (end !== null && end < start) rposBridgeFailure_('invalid_request');
  if (record.update_time != null) rposBridgeTime_(record.update_time);
  ['duration_seconds', 'calories_kcal', 'distance_meters'].forEach(function(key) {
    if (!rposBridgeMetric_(record[key])) rposBridgeFailure_('invalid_request');
  });
  (record.sessions || []).forEach(function(session) {
    if (!session || Array.isArray(session) || typeof session !== 'object' ||
        !rposBridgeText_(session.exercise_type, 128) ||
        (session.custom_title != null && (typeof session.custom_title !== 'string' || session.custom_title.length > 1000))) {
      rposBridgeFailure_('invalid_request');
    }
    const sessionStart = rposBridgeTime_(session.start_time);
    const sessionEnd = rposBridgeTime_(session.end_time);
    if (sessionEnd < sessionStart || sessionStart < start || (end !== null && sessionEnd > end)) {
      rposBridgeFailure_('invalid_request');
    }
    ['duration_millis', 'calories_kcal', 'distance_meters', 'mean_heart_rate_bpm',
     'max_heart_rate_bpm', 'min_heart_rate_bpm'].forEach(function(key) {
      if (!rposBridgeMetric_(session[key])) rposBridgeFailure_('invalid_request');
    });
  });
  return record;
}

function rposBridgeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function rposBridgeResult_(status, receiptId, recordHash) {
  const result = {
    schema_version: 'rpos.exercise.intake.receipt.v1',
    status: status,
    retryable: ['busy', 'storage_unresolved', 'storage_error'].indexOf(status) >= 0,
    notion_confirmed: false
  };
  if (receiptId) result.receipt_id = receiptId;
  if (recordHash) result.record_hash = recordHash;
  return result;
}

function rposBridgeVerifyStored_(stored, receiptId, recordHash, deps) {
  if (!stored || stored.schema_version !== 'rpos.exercise.intake.stored.v1' ||
      stored.receipt_id !== receiptId || stored.state !== 'staged' ||
      stored.record_hash !== recordHash || !stored.export) {
    rposBridgeFailure_('storage_conflict');
  }
  const record = rposBridgeValidateExport_(stored.export);
  if (deps.sha256(JSON.stringify(['samsung_health', record.uid])) !== receiptId ||
      deps.sha256(JSON.stringify(rposBridgeCanonical_(record))) !== recordHash) {
    rposBridgeFailure_('storage_conflict');
  }
}

function rposBridgeSaveIntent_(deps, receiptId, intent) {
  deps.store.setIntent(receiptId, intent);
  const readback = deps.store.getIntent(receiptId);
  if (!readback || JSON.stringify(rposBridgeCanonical_(readback)) !==
      JSON.stringify(rposBridgeCanonical_(intent))) {
    rposBridgeFailure_('storage_conflict');
  }
}

function rposBridgeHandle_(body, deps) {
  let locked = false;
  try {
    if (!deps.enabled) return rposBridgeResult_('disabled');
    if (typeof deps.key !== 'string' || !/^[a-f0-9]{64}$/.test(deps.key)) {
      return rposBridgeResult_('not_configured');
    }
    if (typeof body !== 'string' || deps.byteLength(body) > 262144) {
      rposBridgeFailure_('invalid_request');
    }
    let request;
    try { request = JSON.parse(body); } catch (ignore) { rposBridgeFailure_('invalid_request'); }
    if (!request || request.schema_version !== 'rpos.exercise.intake.v1' ||
        !Number.isSafeInteger(request.sent_at) ||
        typeof request.payload_json !== 'string' || deps.byteLength(request.payload_json) > 196608 ||
        !/^[a-f0-9]{64}$/.test(request.signature || '')) {
      rposBridgeFailure_('invalid_request');
    }
    if (Math.abs(deps.nowSeconds() - request.sent_at) > 300) {
      rposBridgeFailure_('unauthorized');
    }
    const payloadHash = deps.sha256(request.payload_json);
    const signed = 'rpos.exercise.intake.v1\n' + request.sent_at + '\n' + payloadHash;
    if (!rposBridgeEqual_(request.signature, deps.hmac(signed, deps.key))) {
      rposBridgeFailure_('unauthorized');
    }
    let exported;
    try { exported = JSON.parse(request.payload_json); } catch (ignore) {
      rposBridgeFailure_('invalid_request');
    }
    const record = rposBridgeValidateExport_(exported);
    // Acquisition metadata changes across reads; dedupe hashes the record only.
    const recordHash = deps.sha256(JSON.stringify(rposBridgeCanonical_(record)));
    const receiptId = deps.sha256(JSON.stringify(['samsung_health', record.uid]));
    locked = deps.lock.tryLock(1000);
    if (!locked) return rposBridgeResult_('busy');
    const intent = deps.store.getIntent(receiptId);
    if (intent && (intent.receipt_id !== receiptId ||
        intent.record_hash !== recordHash || ['writing', 'staged'].indexOf(intent.state) < 0)) {
      rposBridgeFailure_('record_changed');
    }
    const found = deps.store.find(receiptId);
    if (found.length > 1) rposBridgeFailure_('storage_conflict');
    if (found.length === 1) {
      rposBridgeVerifyStored_(found[0].value, receiptId, recordHash, deps);
      if (intent && intent.file_id && intent.file_id !== found[0].id) {
        rposBridgeFailure_('storage_conflict');
      }
      rposBridgeSaveIntent_(deps, receiptId, {
        receipt_id: receiptId, record_hash: recordHash, state: 'staged', file_id: found[0].id
      });
      return rposBridgeResult_('staged', receiptId, recordHash);
    }
    // Empty Drive lookup cannot prove that an interrupted create did not apply.
    if (intent) return rposBridgeResult_('storage_unresolved', receiptId, recordHash);
    rposBridgeSaveIntent_(deps, receiptId, {
      receipt_id: receiptId, record_hash: recordHash, state: 'writing'
    });
    const stored = {
      schema_version: 'rpos.exercise.intake.stored.v1',
      receipt_id: receiptId, record_hash: recordHash, state: 'staged',
      received_at: new Date(deps.nowSeconds() * 1000).toISOString(), export: exported
    };
    const created = deps.store.create(receiptId, stored);
    // Read the persisted file and uniqueness before acknowledging receipt.
    const readback = deps.store.find(receiptId);
    if (readback.length !== 1 || readback[0].id !== created.id) {
      return rposBridgeResult_('storage_unresolved', receiptId, recordHash);
    }
    rposBridgeVerifyStored_(readback[0].value, receiptId, recordHash, deps);
    rposBridgeSaveIntent_(deps, receiptId, {
      receipt_id: receiptId, record_hash: recordHash, state: 'staged', file_id: created.id
    });
    return rposBridgeResult_('staged', receiptId, recordHash);
  } catch (error) {
    // Never echo raw payloads, credentials, Drive errors or health data to clients/logs.
    const safe = ['invalid_request', 'unauthorized', 'record_changed', 'storage_conflict'];
    return rposBridgeResult_(safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'storage_error');
  } finally {
    if (locked) {
      try { deps.lock.releaseLock(); } catch (ignore) { /* Platform lock expires; no raw error logs. */ }
    }
  }
}
