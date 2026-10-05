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
      // Off by default; the outer staged receipt never claims Notion confirmation.
      if (result.status === 'staged' && properties.getProperty('BRIDGE_DELIVERY_ENABLED') === 'true') {
        result.delivery = rposBridgeDeliverReceipt(result.receipt_id);
      }
    }
  } catch (ignore) {
    result = rposBridgeResult_('storage_error');
  }
  // ContentService has no custom HTTP status API: clients must inspect JSON status.
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
