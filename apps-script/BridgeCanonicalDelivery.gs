/* Owner-run, one-receipt finalization for an exact UID and matching full SDK export.
 * Add as a separate file in the existing project; no web deployment update is needed.
 * Continuous delivery/migration remain OFF. Does not create pages or scheduler aliases. */
function rposBridgeCanonicalDelivery_(deps) {
  const out = {schema_version: 'rpos.bridge.canonical.delivery.v1', status: 'delivery_error',
    notion_confirmed: false, response_loss_recovered: false, replay_without_remote_writes: false};
  let locked = false;
  try {
    if (!deps.flagsOk()) rposBridgeFailure_('flags_require_review');
    locked = deps.lock.tryLock(1000);
    if (!locked) return Object.assign(out, {status: 'busy'});
    const ids = deps.listReceipts();
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(function(id) { return !/^[a-f0-9]{64}$/.test(id); })) {
      rposBridgeFailure_('receipt_requires_review');
    }
    let selected = null, review = null;
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index], prior = deps.journal.get(id);
      if (prior && prior.state === 'confirmed') continue;
      const files = deps.store.find(id);
      if (files.length !== 1) rposBridgeFailure_('receipt_requires_review');
      const stored = files[0].value;
      rposBridgeVerifyStored_(stored, id, stored.record_hash, deps);
      const intake = deps.store.getIntent(id);
      if (!intake || intake.state !== 'staged' || intake.receipt_id !== id ||
          intake.record_hash !== stored.record_hash || intake.file_id !== files[0].id) {
        rposBridgeFailure_('receipt_requires_review');
      }
      const matches = deps.remote.findUid('samsung_health', stored.export.record.uid);
      if (matches.length > 1) rposBridgeFailure_('delivery_conflict');
      if (matches.length !== 1) continue; // Never match by title, date or routine.
      const page = deps.remote.read(matches[0]);
      if (page.source !== 'samsung_health' || page.uid !== stored.export.record.uid || page.legacy) continue;
      if (prior) {
        if (prior.state !== 'attempting' || prior.receipt_id !== id || prior.record_hash !== stored.record_hash ||
            prior.page_id !== page.id) rposBridgeFailure_('delivery_conflict');
      } else {
        if (page.evidence || !deps.ownerExportMatches(page.id, stored)) continue;
        review = {schema_version: 'rpos.bridge.review.v2', source: 'samsung_health',
          uid: stored.export.record.uid, record_hash: stored.record_hash,
          target_page_id: page.id, expected_last_edited_time: page.edited,
          expected_source: page.source, expected_uid: page.uid, aliases: [],
          review_basis: 'Owner-run bounded finalization. Exact unique canonical UID and full owner-supplied SDK record match the authenticated staged receipt. No date/title inference, alias migration, new page or metric/feedback change.'};
        rposBridgeReview_(review, stored, page, deps.remote);
      }
      selected = {id: id, page: page.id};
      break;
    }
    if (!selected) return Object.assign(out, {status: 'no_matching_signed_receipt'});
    deps.selectPage(selected.page);
    let loseResponse = !deps.journal.get(selected.id), writes = 0, discarded = false;
    const remote = Object.assign({}, deps.remote, {prepare: function(page, stored, aliases) {
      const prepared = deps.remote.prepare(page, stored, aliases);
      // This page already has the canonical identity. Preserve its reviewed date.
      delete prepared.properties.Date;
      return prepared;
    }, write: function(id, prepared) {
      if (id !== selected.page || !deps.flagsOk()) rposBridgeFailure_('delivery_conflict');
      deps.remote.write(id, prepared);
      writes++;
      // Actual remote write succeeds; deliberately lose its acknowledgement before the
      // coordinator can commit. A fresh read must recover the attempting journal.
      if (loseResponse) { loseResponse = false; discarded = true; rposBridgeFailure_('delivery_error'); }
    }});
    const delivery = {enabled: true, sha256: deps.sha256,
      lock: {tryLock: function() { return true; }, releaseLock: function() {}},
      store: deps.store, journal: deps.journal, migrationJournal: deps.migrationJournal,
      reviews: {get: function(id) { return id === selected.id ? review : null; }}, remote: remote};
    const first = rposBridgeDeliver_(selected.id, delivery);
    const beforeRecovery = writes;
    const recovered = first.notion_confirmed ? first : rposBridgeDeliver_(selected.id, delivery);
    out.status = recovered.status;
    out.notion_confirmed = recovered.notion_confirmed;
    out.response_loss_recovered = discarded && first.status === 'delivery_error' &&
      recovered.notion_confirmed && writes === beforeRecovery;
    if (recovered.notion_confirmed) {
      const beforeReplay = writes;
      const replay = rposBridgeDeliver_(selected.id, delivery);
      out.replay_without_remote_writes = replay.notion_confirmed && writes === beforeReplay;
      if (!out.replay_without_remote_writes) out.status = 'confirmed_followup_requires_review';
    }
    out.remote_write_calls = writes;
    if (!deps.flagsOk()) out.status = 'flags_require_review';
  } catch (error) {
    const safe = ['flags_require_review', 'receipt_requires_review', 'delivery_conflict', 'delivery_error'];
    out.status = safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'delivery_error';
  } finally {
    if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} }
  }
  return out;
}

function rposBridgeOwnerExportMatches_(http, pageId, stored) {
  let cursor = null, count = 0, match = false;
  const seen = Object.create(null);
  for (let batch = 0; batch < 10; batch++) {
    const response = http.request('GET', '/blocks/' + rposBridgeUuid_(pageId) + '/children?page_size=100' +
      (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
    if (response.object !== 'list' || !Array.isArray(response.results)) rposBridgeFailure_('delivery_conflict');
    response.results.forEach(function(block) {
      if (block.type !== 'code' || block.in_trash || block.archived) return;
      let value;
      try { value = JSON.parse(rposBridgePlain_(block.code.rich_text || [])); } catch (ignore) { return; }
      if (!value || value.schema_version !== 'rpos.exercise.export.v1') return;
      const record = rposBridgeValidateExport_(value);
      count++;
      match = JSON.stringify(rposBridgeCanonical_(record)) ===
        JSON.stringify(rposBridgeCanonical_(stored.export.record));
    });
    if (response.has_more === false) return count === 1 && match;
    cursor = response.next_cursor;
    if (typeof cursor !== 'string' || !cursor || seen[cursor]) rposBridgeFailure_('delivery_conflict');
    seen[cursor] = true;
  }
  rposBridgeFailure_('delivery_conflict');
}

// Keep the owner operation independent of optional legacy transport/journal
// adapters, just like the accepted self-contained signed receipt query.
function rposBridgeCanonicalJournal_(props, prefix) {
  return {get: function(id) {
    const value = props.getProperty(prefix + id);
    return value ? JSON.parse(value) : null;
  }, set: function(id, value) { props.setProperty(prefix + id, JSON.stringify(value)); }};
}

function rposBridgeCanonicalHttp_(token) {
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
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) rposBridgeFailure_('delivery_error');
    const raw = response.getContentText();
    if (Utilities.newBlob(raw).getBytes().length > 8000000) rposBridgeFailure_('delivery_error');
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object') rposBridgeFailure_('delivery_error');
    return value;
  }};
}

function rposBridgeFinalizeCanonicalReceipt() {
  let report = {schema_version: 'rpos.bridge.canonical.delivery.v1', status: 'not_configured', notion_confirmed: false};
  try {
    const runtime = {uuid: typeof rposBridgeUuid_ === 'function', sha: typeof rposBridgeSha_ === 'function',
      canonical: typeof rposBridgeCanonical_ === 'function', failure: typeof rposBridgeFailure_ === 'function',
      verify_stored: typeof rposBridgeVerifyStored_ === 'function', validate_export: typeof rposBridgeValidateExport_ === 'function',
      plain_text: typeof rposBridgePlain_ === 'function', drive_store: typeof rposBridgeDriveStore_ === 'function',
      review: typeof rposBridgeReview_ === 'function', deliver: typeof rposBridgeDeliver_ === 'function',
      notion: typeof rposBridgeNotionPort_ === 'function'};
    report.runtime_present = runtime;
    if (!Object.keys(runtime).every(function(name) { return runtime[name]; })) {
      report.status = 'runtime_incomplete'; Logger.log(JSON.stringify(report)); return report;
    }
    const props = PropertiesService.getScriptProperties();
    const names = ['BRIDGE_INTAKE_ENABLED', 'BRIDGE_DELIVERY_ENABLED', 'BRIDGE_MIGRATION_ENABLED',
      'BRIDGE_SCHEDULER_BINDING_REVIEWED'];
    const before = names.map(function(name) { return props.getProperty(name); });
    function flagsOk() { return before.join('|') === 'true|false|false|true' &&
      names.every(function(name, i) { return props.getProperty(name) === before[i]; }); }
    if (!flagsOk()) rposBridgeFailure_('flags_require_review');
    const source = rposBridgeUuid_(props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID'));
    if (typeof RPOS === 'undefined' || source !== rposBridgeUuid_(RPOS.fitnessDataSourceId)) {
      rposBridgeFailure_('delivery_conflict');
    }
    const store = rposBridgeDriveStore_(props.getProperty('BRIDGE_RECEIPT_FOLDER_ID'), props);
    const originalHttp = rposBridgeCanonicalHttp_(props.getProperty('NOTION_TOKEN'));
    const started = Date.now();
    let selectedPage = null;
    const http = {request: function(method, path, payload) {
      if (Date.now() - started > 180000) rposBridgeFailure_('delivery_error');
      const query = method === 'POST' && path === '/data_sources/' + source + '/query';
      const patch = method === 'PATCH' && selectedPage &&
        (path === '/pages/' + selectedPage || path === '/blocks/' + selectedPage + '/children');
      if (!(method === 'GET' || query || patch)) rposBridgeFailure_('delivery_conflict');
      if (patch && (!flagsOk() || (path === '/pages/' + selectedPage &&
          Object.keys(payload.properties || {}).some(function(name) {
            return ['Source', 'Source Record ID'].indexOf(name) < 0;
          })))) rposBridgeFailure_('delivery_conflict');
      return originalHttp.request(method, path, payload);
    }};
    report = rposBridgeCanonicalDelivery_({flagsOk: flagsOk, sha256: rposBridgeSha_,
      lock: LockService.getScriptLock(), store: store,
      listReceipts: function() { return props.getKeys().filter(function(name) {
        return /^RPOS_BRIDGE_INTENT_[a-f0-9]{64}$/.test(name);
      }).map(function(name) { return name.slice('RPOS_BRIDGE_INTENT_'.length); }).sort(); },
      journal: rposBridgeCanonicalJournal_(props, 'RPOS_BRIDGE_DELIVERY_'),
      migrationJournal: rposBridgeCanonicalJournal_(props, 'RPOS_BRIDGE_MIGRATION_'),
      remote: rposBridgeNotionPort_(http, source, rposBridgeSha_),
      ownerExportMatches: function(id, stored) { return rposBridgeOwnerExportMatches_(http, id, stored); },
      selectPage: function(id) { selectedPage = rposBridgeUuid_(id); }});
    report.runtime_present = runtime;
    report.activation_flags_unchanged = flagsOk();
    report.continuous_delivery_enabled = props.getProperty('BRIDGE_DELIVERY_ENABLED') === 'true';
    report.migration_enabled = props.getProperty('BRIDGE_MIGRATION_ENABLED') === 'true';
  } catch (error) {
    report.status = error.bridgeCode === 'flags_require_review' ? 'flags_require_review' : 'delivery_error';
  }
  Logger.log(JSON.stringify(report));
  return report;
}
