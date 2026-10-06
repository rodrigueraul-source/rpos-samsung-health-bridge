/* Existing-page delivery only. Install manually; no trigger or endpoint calls this. */
function rposBridgeSha_(text) {
  return rposBridgeHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    text, Utilities.Charset.UTF_8));
}

function rposBridgeUuid_(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(value)) {
    rposBridgeFailure_('delivery_conflict');
  }
  const s = value.replace(/-/g, '').toLowerCase();
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
}

function rposBridgeDeliveryResult_(status) {
  return {schema_version: 'rpos.exercise.delivery.receipt.v1', status: status,
    notion_confirmed: status === 'confirmed'};
}

function rposBridgeDeliverySave_(deps, id, value) {
  deps.journal.set(id, value);
  if (JSON.stringify(rposBridgeCanonical_(deps.journal.get(id))) !==
      JSON.stringify(rposBridgeCanonical_(value))) rposBridgeFailure_('delivery_conflict');
}

function rposBridgeReview_(review, stored, page, remote) {
  if (!review || review.schema_version !== 'rpos.bridge.review.v2' ||
      review.source !== 'samsung_health' || review.uid !== stored.export.record.uid ||
      review.record_hash !== stored.record_hash ||
      rposBridgeUuid_(review.target_page_id) !== page.id ||
      review.expected_last_edited_time !== page.edited ||
      review.expected_source !== page.source || review.expected_uid !== page.uid ||
      !rposBridgeText_(review.review_basis, 2000)) rposBridgeFailure_('needs_reconciliation');
  if (review.aliases === undefined) return;
  const currentAlias = page.uid && (page.source !== 'samsung_health' || page.uid !== stored.export.record.uid);
  if (!Array.isArray(review.aliases) || review.aliases.length > (currentAlias ? 19 : 20)) {
    rposBridgeFailure_('needs_reconciliation');
  }
  const seen = Object.create(null);
  review.aliases.forEach(function(alias) {
    // Only explicit, hash/page/edit-bound reviewed provenance; never infer from titles.
    if (!alias || Object.keys(alias).sort().join(',') !== 'date,source,uid' ||
        !rposBridgeText_(alias.source, 256) || !rposBridgeText_(alias.uid, 2000) ||
        !alias.date || typeof alias.date !== 'object' || Array.isArray(alias.date) ||
        !rposBridgeText_(alias.date.start, 64) ||
        Object.keys(alias.date).some(function(k) { return ['start', 'end', 'time_zone'].indexOf(k) < 0; }) ||
        (alias.date.end != null && !rposBridgeText_(alias.date.end, 64)) ||
        (alias.date.time_zone != null && !rposBridgeText_(alias.date.time_zone, 128)) ||
        (alias.source === 'samsung_health' && alias.uid === stored.export.record.uid) ||
        (alias.source === page.source && alias.uid === page.uid)) rposBridgeFailure_('needs_reconciliation');
    const key = JSON.stringify([alias.source, alias.uid]);
    if (seen[key]) rposBridgeFailure_('needs_reconciliation');
    seen[key] = true;
    const matches = remote.findUid(alias.source, alias.uid).concat(remote.findAlias(alias.source, alias.uid));
    if (matches.some(function(id) { return id !== page.id; })) rposBridgeFailure_('delivery_conflict');
  });
}

function rposBridgeDeliver_(receiptId, deps) {
  let locked = false;
  try {
    if (!deps.enabled) return rposBridgeDeliveryResult_('disabled');
    if (!/^[a-f0-9]{64}$/.test(receiptId || '')) rposBridgeFailure_('delivery_conflict');
    locked = deps.lock.tryLock(1000);
    if (!locked) return rposBridgeDeliveryResult_('busy');
    const found = deps.store.find(receiptId);
    if (found.length !== 1) rposBridgeFailure_('storage_unresolved');
    const stored = found[0].value;
    rposBridgeVerifyStored_(stored, receiptId, stored.record_hash, deps);
    const intake = deps.store.getIntent(receiptId);
    if (!intake || intake.receipt_id !== receiptId || intake.state !== 'staged' || intake.file_id !== found[0].id ||
        intake.record_hash !== stored.record_hash) rposBridgeFailure_('storage_unresolved');
    const intent = deps.journal.get(receiptId);
    if (intent && (intent.receipt_id !== receiptId || intent.record_hash !== stored.record_hash ||
        ['attempting', 'confirmed'].indexOf(intent.state) < 0)) rposBridgeFailure_('delivery_conflict');
    const matches = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (matches.length > 1) rposBridgeFailure_('delivery_conflict');
    let page = matches.length ? deps.remote.read(matches[0]) : null;
    if (page && intent && intent.page_id !== page.id) rposBridgeFailure_('delivery_conflict');
    if (page && page.evidence && page.evidence.record_hash === stored.record_hash &&
        page.evidence.receipt_id === receiptId) {
      if (page.evidence.migration) {
        const migration = deps.migrationJournal && deps.migrationJournal.get(receiptId);
        if (!migration || migration.state !== 'confirmed' || migration.receipt_id !== receiptId ||
            migration.record_hash !== stored.record_hash || migration.page_id !== page.id ||
            migration.review_hash !== page.evidence.migration.review_hash ||
            JSON.stringify(rposBridgeCanonical_(migration.aliases)) !==
            JSON.stringify(rposBridgeCanonical_(page.evidence.aliases))) rposBridgeFailure_('needs_migration');
      }
      // Same-hash remote evidence is still checked against original stored record by the port.
      if (JSON.stringify(rposBridgeCanonical_(page.evidence.record)) !==
          JSON.stringify(rposBridgeCanonical_(stored.export.record))) rposBridgeFailure_('delivery_conflict');
      rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
        page_id: page.id, state: 'confirmed'});
      return rposBridgeDeliveryResult_('confirmed');
    }
    // Partial write / timeout / restart: absence of evidence is never permission to write again.
    if (intent) {
      if (intent.state === 'confirmed') rposBridgeFailure_('delivery_conflict');
      return rposBridgeDeliveryResult_('unresolved');
    }
    // Existing v1/Python evidence has a different hash contract; require explicit migration.
    if (page && (page.legacy || page.evidence)) rposBridgeFailure_('needs_migration');
    const review = deps.reviews.get(receiptId);
    if (!page) {
      if (!review) return rposBridgeDeliveryResult_('needs_reconciliation');
      page = deps.remote.read(rposBridgeUuid_(review.target_page_id));
    }
    if (page.source === 'samsung_health' && page.uid !== stored.export.record.uid) {
      rposBridgeFailure_('delivery_conflict');
    }
    if (page.legacy || page.evidence) rposBridgeFailure_('needs_migration');
    // Require a hash-bound reviewed page even when the UID was set manually but has no evidence.
    rposBridgeReview_(review, stored, page, deps.remote);
    const prepared = deps.remote.prepare(page, stored, review.aliases || []);
    const fresh = deps.remote.read(page.id);
    if (fresh.edited !== page.edited || fresh.source !== page.source || fresh.uid !== page.uid ||
        fresh.evidence || fresh.legacy) rposBridgeFailure_('delivery_conflict');
    rposBridgeReview_(review, stored, fresh, deps.remote);
    rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
      page_id: page.id, state: 'attempting'});
    deps.remote.write(page.id, prepared);
    const after = deps.remote.read(page.id);
    const unique = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (unique.length !== 1 || unique[0] !== page.id || after.source !== 'samsung_health' ||
        after.uid !== stored.export.record.uid || !after.evidence ||
        after.evidence.receipt_id !== receiptId || after.evidence.record_hash !== stored.record_hash ||
        JSON.stringify(rposBridgeCanonical_(after.evidence.record)) !==
          JSON.stringify(rposBridgeCanonical_(stored.export.record))) {
      return rposBridgeDeliveryResult_('unresolved');
    }
    rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
      page_id: page.id, state: 'confirmed'});
    return rposBridgeDeliveryResult_('confirmed');
  } catch (error) {
    const safe = ['delivery_conflict', 'storage_unresolved', 'needs_reconciliation', 'needs_migration'];
    return rposBridgeDeliveryResult_(safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'delivery_error');
  } finally {
    if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} }
  }
}

function rposBridgePropertyJournal_(properties, prefix) {
  return {
    get: function(id) { const raw = properties.getProperty(prefix + id); return raw ? JSON.parse(raw) : null; },
    set: function(id, value) { properties.setProperty(prefix + id, JSON.stringify(value)); }
  };
}

function rposBridgeNotionHttp_(token) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) rposBridgeFailure_('not_configured');
  return {request: function(method, path, payload) {
    if (!/^\/(?:data_sources|pages|blocks)\//.test(path) || /\/\/|#/.test(path)) {
      rposBridgeFailure_('delivery_conflict');
    }
    const options = {method: method.toLowerCase(), muteHttpExceptions: true, followRedirects: false,
      headers: {'Authorization': 'Bearer ' + token, 'Notion-Version': '2026-03-11'},
      contentType: 'application/json'};
    if (payload !== undefined) {
      options.payload = JSON.stringify(payload);
      if (Utilities.newBlob(options.payload).getBytes().length > 500000) rposBridgeFailure_('delivery_conflict');
    }
    const response = UrlFetchApp.fetch('https://api.notion.com/v1' + path, options);
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      rposBridgeFailure_('delivery_error');
    }
    const raw = response.getContentText();
    if (Utilities.newBlob(raw).getBytes().length > 8000000) rposBridgeFailure_('delivery_error');
    const result = JSON.parse(raw);
    if (!result || Array.isArray(result) || typeof result !== 'object') rposBridgeFailure_('delivery_error');
    return result;
  }};
}

// Operator runs one opaque staged receipt; never install a trigger automatically.
function rposBridgeDeliverReceipt(receiptId) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('BRIDGE_DELIVERY_ENABLED') !== 'true') return rposBridgeDeliveryResult_('disabled');
    if (props.getProperty('BRIDGE_SCHEDULER_BINDING_REVIEWED') !== 'true') {
      return rposBridgeDeliveryResult_('not_configured');
    }
    const folderId = props.getProperty('BRIDGE_RECEIPT_FOLDER_ID');
    const token = props.getProperty('NOTION_TOKEN');
    // Fitness is explicitly selected; NOTION_DATA_SOURCE_ID belongs to scheduler logs.
    const sourceId = props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    if (!folderId || !token || !sourceId) return rposBridgeDeliveryResult_('not_configured');
    if (typeof RPOS === 'undefined' || rposBridgeUuid_(sourceId) !==
        rposBridgeUuid_(RPOS.fitnessDataSourceId)) return rposBridgeDeliveryResult_('not_configured');
    let store;
    function currentStore() { return store || (store = rposBridgeDriveStore_(folderId, props)); }
    const review = rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_REVIEW_');
    return rposBridgeDeliver_(receiptId, {
      enabled: true, sha256: rposBridgeSha_, lock: LockService.getScriptLock(),
      journal: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_DELIVERY_'), reviews: review,
      migrationJournal: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_MIGRATION_'),
      store: {find: function(id) { return currentStore().find(id); },
        getIntent: function(id) { return currentStore().getIntent(id); }},
      remote: rposBridgeNotionPort_(rposBridgeNotionHttp_(token), sourceId, rposBridgeSha_)
    });
  } catch (ignore) { return rposBridgeDeliveryResult_('delivery_error'); }
}
