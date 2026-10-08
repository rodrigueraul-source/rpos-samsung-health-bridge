/* Explicit reviewed conversion only. No endpoint or trigger invokes migration. */
function rposBridgeMigrationSnapshot_(page, sha) {
  return sha(JSON.stringify(rposBridgeCanonical_({id: page.id, source: page.source, uid: page.uid,
    edited: page.edited, notes: rposBridgeWritableText_(page.notes),
    legacy_blocks: page.legacy_blocks, evidence: page.evidence})));
}

function rposBridgeMigrationReview_(review, stored, page, deps) {
  if (!review || review.schema_version !== 'rpos.bridge.migration.review.v1' ||
      review.receipt_id !== stored.receipt_id || review.record_hash !== stored.record_hash ||
      rposBridgeUuid_(review.target_page_id) !== page.id ||
      review.expected_snapshot_hash !== rposBridgeMigrationSnapshot_(page, deps.sha256) ||
      !rposBridgeText_(review.review_basis, 2000) || !Array.isArray(review.aliases) ||
      review.aliases.length > 20 || !page.legacy || page.evidence ||
      !Array.isArray(page.legacy_blocks) || !page.legacy_blocks.length ||
      page.legacy_blocks.some(function(b) { return !b.id; })) rposBridgeFailure_('needs_reconciliation');
  const seen = Object.create(null);
  page.legacy_blocks.forEach(function(block) {
    if (seen[block.id]) rposBridgeFailure_('delivery_conflict');
    seen[block.id] = true;
  });
  review.aliases.forEach(function(alias) {
    // Explicit reviewed provenance; never derive an alias from dates/titles/prose.
    if (!alias || Object.keys(alias).sort().join(',') !== 'date,source,uid' ||
        !rposBridgeText_(alias.source, 256) || !rposBridgeText_(alias.uid, 2000) ||
        !alias.date || typeof alias.date !== 'object' || Array.isArray(alias.date) ||
        typeof alias.date.start !== 'string' || !alias.date.start ||
        Object.keys(alias.date).some(function(k) { return ['start', 'end', 'time_zone'].indexOf(k) < 0; }) ||
        (alias.source === 'samsung_health' && alias.uid === page.uid)) rposBridgeFailure_('needs_reconciliation');
    const key = JSON.stringify([alias.source, alias.uid]);
    if (seen[key]) rposBridgeFailure_('needs_reconciliation');
    seen[key] = true;
    const matches = deps.remote.findUid(alias.source, alias.uid).concat(deps.remote.findAlias(alias.source, alias.uid));
    if (matches.some(function(id) { return id !== page.id; })) rposBridgeFailure_('delivery_conflict');
  });
}

// Read-only plan input. It never guesses/archives aliases or returns health fields.
function rposBridgeMigrationAudit_(receiptId, deps) {
  let locked = false;
  try {
    if (!/^[a-f0-9]{64}$/.test(receiptId || '')) rposBridgeFailure_('delivery_conflict');
    locked = deps.lock.tryLock(1000);
    if (!locked) return {schema_version: 'rpos.bridge.migration.audit.v1', status: 'busy'};
    const files = deps.store.find(receiptId);
    if (files.length !== 1) rposBridgeFailure_('storage_unresolved');
    const stored = files[0].value;
    rposBridgeVerifyStored_(stored, receiptId, stored.record_hash, deps);
    const staged = deps.store.getIntent(receiptId);
    if (!staged || staged.state !== 'staged' || staged.receipt_id !== receiptId ||
        staged.file_id !== files[0].id || staged.record_hash !== stored.record_hash) rposBridgeFailure_('storage_unresolved');
    const ids = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (ids.length !== 1) rposBridgeFailure_('delivery_conflict');
    const page = deps.remote.read(ids[0]), snapshot = rposBridgeMigrationSnapshot_(page, deps.sha256);
    if (page.source !== 'samsung_health' || page.uid !== stored.export.record.uid || !page.legacy || page.evidence) {
      rposBridgeFailure_('needs_reconciliation');
    }
    const fresh = deps.remote.read(page.id), unique = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (unique.length !== 1 || unique[0] !== page.id ||
        rposBridgeMigrationSnapshot_(fresh, deps.sha256) !== snapshot) rposBridgeFailure_('delivery_conflict');
    return {schema_version: 'rpos.bridge.migration.audit.v1', status: 'ready_for_review',
      receipt_id: receiptId, record_hash: stored.record_hash, target_page_id: page.id,
      expected_snapshot_hash: snapshot, legacy_block_count: page.legacy_blocks.length};
  } catch (error) {
    const safe = ['delivery_conflict', 'storage_unresolved', 'needs_reconciliation'];
    return {schema_version: 'rpos.bridge.migration.audit.v1',
      status: safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'audit_error'};
  } finally { if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} } }
}

function rposBridgeMigrationConfirmed_(page, stored, intent, remote, sha) {
  const ev = page.evidence;
  if (!ev || !ev.migration || ev.migration.review_hash !== intent.review_hash ||
      ev.receipt_id !== stored.receipt_id || ev.record_hash !== stored.record_hash ||
      JSON.stringify(rposBridgeCanonical_(ev.record)) !== JSON.stringify(rposBridgeCanonical_(stored.export.record)) ||
      JSON.stringify(rposBridgeCanonical_(ev.aliases)) !== JSON.stringify(rposBridgeCanonical_(intent.aliases))) return false;
  const notes = rposBridgePlain_(page.notes).split(/\r?\n/);
  return intent.aliases.every(function(alias) {
    const marker = rposBridgeAlias_(alias.source, alias.uid, sha);
    const ids = remote.findAlias(alias.source, alias.uid);
    return notes.indexOf(marker) >= 0 && ids.length === 1 && ids[0] === page.id;
  });
}

function rposBridgeMigrate_(receiptId, deps) {
  let locked = false;
  try {
    if (!deps.enabled) return rposBridgeDeliveryResult_('disabled');
    if (!/^[a-f0-9]{64}$/.test(receiptId || '')) rposBridgeFailure_('delivery_conflict');
    locked = deps.lock.tryLock(1000);
    if (!locked) return rposBridgeDeliveryResult_('busy');
    const files = deps.store.find(receiptId);
    if (files.length !== 1) rposBridgeFailure_('storage_unresolved');
    const stored = files[0].value;
    rposBridgeVerifyStored_(stored, receiptId, stored.record_hash, deps);
    const staged = deps.store.getIntent(receiptId);
    if (!staged || staged.state !== 'staged' || staged.receipt_id !== receiptId ||
        staged.file_id !== files[0].id || staged.record_hash !== stored.record_hash) rposBridgeFailure_('storage_unresolved');
    // Never override an uncertain/confirmed ordinary-delivery write intent.
    if (deps.deliveryJournal.get(receiptId)) rposBridgeFailure_('delivery_conflict');
    const ids = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (ids.length !== 1) rposBridgeFailure_('delivery_conflict');
    const page = deps.remote.read(ids[0]);
    if (page.source !== 'samsung_health' || page.uid !== stored.export.record.uid) rposBridgeFailure_('delivery_conflict');
    let intent = deps.journal.get(receiptId);
    if (intent && (intent.receipt_id !== receiptId || intent.record_hash !== stored.record_hash ||
        intent.page_id !== page.id || !Array.isArray(intent.aliases) ||
        !/^[a-f0-9]{64}$/.test(intent.review_hash || '') ||
        ['attempting', 'confirmed'].indexOf(intent.state) < 0)) rposBridgeFailure_('delivery_conflict');
    if (intent) {
      if (rposBridgeMigrationConfirmed_(page, stored, intent, deps.remote, deps.sha256)) {
        intent.state = 'confirmed'; rposBridgeDeliverySave_(deps, receiptId, intent);
        return rposBridgeDeliveryResult_('confirmed');
      }
      return rposBridgeDeliveryResult_(intent.state === 'confirmed' ? 'delivery_conflict' : 'unresolved');
    }
    const review = deps.reviews.get(receiptId);
    rposBridgeMigrationReview_(review, stored, page, deps);
    const reviewHash = deps.sha256(JSON.stringify(rposBridgeCanonical_(review)));
    const prepared = deps.remote.prepareMigration(page, stored, review, reviewHash);
    const fresh = deps.remote.read(page.id);
    if (rposBridgeMigrationSnapshot_(fresh, deps.sha256) !== review.expected_snapshot_hash) rposBridgeFailure_('delivery_conflict');
    // Check UID and each archived alias again immediately before intent/write.
    const unique = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (unique.length !== 1 || unique[0] !== page.id) rposBridgeFailure_('delivery_conflict');
    rposBridgeMigrationReview_(review, stored, fresh, deps);
    intent = {receipt_id: receiptId, record_hash: stored.record_hash, page_id: page.id,
      review_hash: reviewHash, aliases: review.aliases, state: 'attempting'};
    rposBridgeDeliverySave_(deps, receiptId, intent);
    deps.remote.write(page.id, prepared);
    const after = deps.remote.read(page.id), matched = deps.remote.findUid('samsung_health', stored.export.record.uid);
    if (matched.length !== 1 || matched[0] !== page.id || after.source !== 'samsung_health' ||
        after.uid !== stored.export.record.uid || !rposBridgeMigrationConfirmed_(after, stored, intent, deps.remote, deps.sha256)) {
      return rposBridgeDeliveryResult_('unresolved');
    }
    intent.state = 'confirmed'; rposBridgeDeliverySave_(deps, receiptId, intent);
    return rposBridgeDeliveryResult_('confirmed');
  } catch (error) {
    const safe = ['delivery_conflict', 'storage_unresolved', 'needs_reconciliation'];
    return rposBridgeDeliveryResult_(safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'delivery_error');
  } finally { if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} } }
}

// Trusted operator only; credential/configuration entry remains private.
function rposBridgeMigrationRuntime_(props) {
    const source = props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    const folder = props.getProperty('BRIDGE_RECEIPT_FOLDER_ID');
    const token = props.getProperty('NOTION_TOKEN');
    if (!source || !folder || !token || typeof RPOS === 'undefined' ||
        rposBridgeUuid_(source) !== rposBridgeUuid_(RPOS.fitnessDataSourceId)) return null;
    return {enabled: true, sha256: rposBridgeSha_,
      lock: LockService.getScriptLock(), store: rposBridgeDriveStore_(folder, props),
      journal: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_MIGRATION_'),
      deliveryJournal: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_DELIVERY_'),
      reviews: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_MIGRATION_REVIEW_'),
      remote: rposBridgeNotionPort_(rposBridgeNotionHttp_(token), source, rposBridgeSha_)};
}

function rposBridgeMigrateReceipt(receiptId) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('BRIDGE_MIGRATION_ENABLED') !== 'true') return rposBridgeDeliveryResult_('disabled');
    const deps = rposBridgeMigrationRuntime_(props);
    return deps ? rposBridgeMigrate_(receiptId, deps) : rposBridgeDeliveryResult_('not_configured');
  } catch (ignore) { return rposBridgeDeliveryResult_('delivery_error'); }
}

function rposBridgeAuditMigrationReceipt(receiptId) {
  try {
    const deps = rposBridgeMigrationRuntime_(PropertiesService.getScriptProperties());
    return deps ? rposBridgeMigrationAudit_(receiptId, deps) :
      {schema_version: 'rpos.bridge.migration.audit.v1', status: 'not_configured'};
  } catch (ignore) { return {schema_version: 'rpos.bridge.migration.audit.v1', status: 'audit_error'}; }
}
