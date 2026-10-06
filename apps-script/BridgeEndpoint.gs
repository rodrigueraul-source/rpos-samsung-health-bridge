/* Add runtime .gs files to the existing scheduler only after reviewing setup. */
function rposBridgeHex_(bytes) {
  return bytes.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function rposBridgeDriveStore_(folderId, properties) {
  // Configure a restricted receipt folder explicitly; never create/share one here.
  const folder = DriveApp.getFolderById(folderId);
  const prefix = 'RPOS_BRIDGE_INTENT_';
  function name(id) { return 'rpos-bridge-' + id + '.json'; }
  return {
    getIntent: function(id) {
      const value = properties.getProperty(prefix + id);
      return value ? JSON.parse(value) : null;
    },
    setIntent: function(id, value) {
      properties.setProperty(prefix + id, JSON.stringify(value));
    },
    find: function(id) {
      const files = folder.getFilesByName(name(id));
      const found = [];
      while (files.hasNext()) {
        const file = files.next();
        const content = file.getBlob().getDataAsString('UTF-8');
        if (Utilities.newBlob(content).getBytes().length > 262144) {
          rposBridgeFailure_('storage_conflict');
        }
        found.push({id: file.getId(), value: JSON.parse(content)});
        if (found.length > 1) break;
      }
      return found;
    },
    create: function(id, value) {
      const file = folder.createFile(name(id), JSON.stringify(value), MimeType.PLAIN_TEXT);
      return {id: file.getId()};
    }
  };
}

function doPost(e) {
  let result;
  try {
    const properties = PropertiesService.getScriptProperties();
    const enabled = properties.getProperty('BRIDGE_INTAKE_ENABLED') === 'true';
    const key = properties.getProperty('BRIDGE_INTAKE_HMAC_KEY');
    const folderId = properties.getProperty('BRIDGE_RECEIPT_FOLDER_ID');
    if (!enabled) {
      result = rposBridgeResult_('disabled');
    } else if (!folderId || !key) {
      result = rposBridgeResult_('not_configured');
    } else if (!e || !e.postData ||
        !/^application\/json(?:;|$)/i.test(e.postData.type || '')) {
      result = rposBridgeResult_('invalid_request');
    } else {
      // Drive is opened lazily, after the request authenticates and takes the lock.
      let store;
      function currentStore() {
        if (!store) store = rposBridgeDriveStore_(folderId, properties);
        return store;
      }
      result = rposBridgeHandle_(e.postData.contents, {
        enabled: enabled, key: key,
        nowSeconds: function() { return Math.floor(Date.now() / 1000); },
        byteLength: function(text) { return Utilities.newBlob(text).getBytes().length; },
        sha256: function(text) {
          return rposBridgeHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
            text, Utilities.Charset.UTF_8));
        },
        hmac: function(text, secret) {
          return rposBridgeHex_(Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8));
        },
        lock: LockService.getScriptLock(),
        store: {
          getIntent: function(id) { return currentStore().getIntent(id); },
          setIntent: function(id, value) { currentStore().setIntent(id, value); },
          find: function(id) { return currentStore().find(id); },
          create: function(id, value) { return currentStore().create(id, value); }
        }
      });
      // Intake releases its lock before optional delivery takes the same Script Lock.
      // The outer staged receipt never claims Notion confirmation. With delivery OFF,
      // only acknowledge a prior confirmed journal after fresh read-only evidence checks.
      if (result.status === 'staged' && properties.getProperty('BRIDGE_DELIVERY_ENABLED') === 'true') {
        result.delivery = rposBridgeDeliverReceipt(result.receipt_id);
      } else if (result.status === 'staged') {
        const acknowledgement = rposBridgeAcknowledgeReceipt_(result, properties);
        if (acknowledgement) result.delivery = acknowledgement;
      }
    }
  } catch (ignore) {
    result = rposBridgeResult_('storage_error');
  }
  // ContentService has no custom HTTP status API: clients must inspect JSON status.
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// Called only after authenticated intake. Never writes a journal or remote page.
function rposBridgeAcknowledgement_(receipt, deps) {
  let locked = false;
  function response(status) {
    return {schema_version: 'rpos.exercise.delivery.receipt.v1', status: status,
      notion_confirmed: status === 'confirmed'};
  }
  try {
    if (!receipt || receipt.status !== 'staged') return null;
    const id = receipt.receipt_id;
    if (!/^[a-f0-9]{64}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(receipt.record_hash || '')) {
      rposBridgeFailure_('delivery_conflict');
    }
    locked = deps.lock.tryLock(1000);
    if (!locked) return response('busy');
    const intent = deps.journal.get(id);
    if (!intent) return null; // A stored receipt alone is not a delivery confirmation.
    if (intent.receipt_id !== id || intent.record_hash !== receipt.record_hash ||
        ['attempting', 'confirmed'].indexOf(intent.state) < 0) rposBridgeFailure_('delivery_conflict');
    if (intent.state === 'attempting') return response('unresolved');
    const pageId = deps.uuid(intent.page_id);
    const found = deps.store.find(id);
    if (found.length !== 1) rposBridgeFailure_('storage_unresolved');
    const stored = found[0].value;
    rposBridgeVerifyStored_(stored, id, receipt.record_hash, deps);
    const intake = deps.store.getIntent(id);
    if (!intake || intake.state !== 'staged' || intake.receipt_id !== id ||
        intake.record_hash !== receipt.record_hash || intake.file_id !== found[0].id) {
      rposBridgeFailure_('storage_unresolved');
    }
    const uid = stored.export.record.uid;
    const remote = deps.remote(); // Lazy: no Notion access for ordinary pending intake.
    const matches = remote.findUid('samsung_health', uid);
    if (matches.length !== 1 || matches[0] !== pageId) rposBridgeFailure_('delivery_conflict');
    const page = remote.read(pageId);
    const evidence = page.evidence;
    if (page.id !== pageId || page.source !== 'samsung_health' || page.uid !== uid ||
        !evidence || evidence.receipt_id !== id || evidence.record_hash !== receipt.record_hash ||
        JSON.stringify(rposBridgeCanonical_(evidence.record)) !==
          JSON.stringify(rposBridgeCanonical_(stored.export.record))) rposBridgeFailure_('delivery_conflict');
    if (evidence.migration) {
      const migration = deps.migrationJournal.get(id);
      if (!migration || migration.state !== 'confirmed' || migration.receipt_id !== id ||
          migration.record_hash !== receipt.record_hash || migration.page_id !== pageId ||
          migration.review_hash !== evidence.migration.review_hash ||
          JSON.stringify(rposBridgeCanonical_(migration.aliases)) !==
            JSON.stringify(rposBridgeCanonical_(evidence.aliases))) rposBridgeFailure_('needs_migration');
    }
    const unique = remote.findUid('samsung_health', uid);
    if (unique.length !== 1 || unique[0] !== pageId) rposBridgeFailure_('delivery_conflict');
    if (JSON.stringify(rposBridgeCanonical_(deps.journal.get(id))) !==
        JSON.stringify(rposBridgeCanonical_(intent))) rposBridgeFailure_('delivery_conflict');
    return response('confirmed');
  } catch (error) {
    const safe = ['busy', 'storage_unresolved', 'delivery_conflict', 'needs_migration'];
    return response(safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode :
      error.bridgeCode === 'storage_conflict' || error.bridgeCode === 'invalid_request' ?
        'delivery_conflict' : 'delivery_error');
  } finally {
    if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} }
  }
}

function rposBridgeAcknowledgeReceipt_(receipt, properties) {
  try {
    if (!properties.getProperty('RPOS_BRIDGE_DELIVERY_' + receipt.receipt_id)) return null;
    if (properties.getProperty('BRIDGE_SCHEDULER_BINDING_REVIEWED') !== 'true') return null;
    const folderId = properties.getProperty('BRIDGE_RECEIPT_FOLDER_ID');
    const token = properties.getProperty('NOTION_TOKEN');
    const sourceId = properties.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    if (!folderId || !token || !sourceId || typeof RPOS === 'undefined' ||
        rposBridgeUuid_(sourceId) !== rposBridgeUuid_(RPOS.fitnessDataSourceId)) {
      return {schema_version: 'rpos.exercise.delivery.receipt.v1',
        status: 'not_configured', notion_confirmed: false};
    }
    const normalizedSourceId = rposBridgeUuid_(sourceId);
    let store;
    function currentStore() { return store || (store = rposBridgeDriveStore_(folderId, properties)); }
    return rposBridgeAcknowledgement_(receipt, {
      lock: LockService.getScriptLock(), sha256: rposBridgeSha_, uuid: rposBridgeUuid_,
      journal: rposBridgePropertyJournal_(properties, 'RPOS_BRIDGE_DELIVERY_'),
      migrationJournal: rposBridgePropertyJournal_(properties, 'RPOS_BRIDGE_MIGRATION_'),
      store: {find: function(id) { return currentStore().find(id); },
        getIntent: function(id) { return currentStore().getIntent(id); }},
      remote: function() {
        const http = rposBridgeNotionHttp_(token);
        const readOnly = {request: function(method, path, payload) {
          if (method !== 'GET' && !(method === 'POST' &&
              path === '/data_sources/' + normalizedSourceId + '/query')) rposBridgeFailure_('delivery_conflict');
          return http.request(method, path, payload);
        }};
        return rposBridgeNotionPort_(readOnly, normalizedSourceId, rposBridgeSha_);
      }
    });
  } catch (ignore) {
    return {schema_version: 'rpos.exercise.delivery.receipt.v1',
      status: 'delivery_error', notion_confirmed: false};
  }
}
