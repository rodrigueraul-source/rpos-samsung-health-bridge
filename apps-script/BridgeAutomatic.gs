/* Future-only automatic capture. Disabled until explicitly configured and activated. */
function rposBridgeAutoActivity_(record) {
  if (record.exercise_type === 'POOL_SWIMMING' || record.exercise_type === 'OPEN_WATER_SWIMMING') return 'Swimming';
  if (record.exercise_type === 'WALKING') return 'Walking';
  if (['RUNNING', 'TREADMILL', 'CYCLING', 'ELLIPTICAL'].indexOf(record.exercise_type) >= 0) return 'Cardio';
  if (['SQUATS', 'LEG_CURLS', 'SIT_UPS', 'WEIGHT_TRAINING'].indexOf(record.exercise_type) >= 0 ||
      (record.exercise_type === 'OTHER' && (record.sessions || []).some(function(s) {
        return ['SQUATS', 'LEG_CURLS', 'SIT_UPS', 'WEIGHT_TRAINING'].indexOf(s.exercise_type) >= 0 ||
          (s.exercise_type === 'OTHER' && s.custom_title);
      }))) return 'Gym';
  return 'Other';
}

function rposBridgeAutomatic_(receiptId, deps) {
  let locked = false;
  try {
    if (!deps.enabled) return rposBridgeDeliveryResult_('disabled');
    if (!/^[a-f0-9]{64}$/.test(receiptId || '')) rposBridgeFailure_('delivery_conflict');
    const cutoff = rposBridgeTime_(deps.startAt), now = deps.now();
    if (!Number.isFinite(now) || cutoff > now) rposBridgeFailure_('not_configured');
    locked = deps.lock.tryLock(1000);
    if (!locked) return rposBridgeDeliveryResult_('busy');
    const found = deps.store.find(receiptId);
    if (found.length !== 1) rposBridgeFailure_('storage_unresolved');
    const stored = found[0].value;
    rposBridgeVerifyStored_(stored, receiptId, stored.record_hash, deps);
    const intake = deps.store.getIntent(receiptId);
    if (!intake || intake.state !== 'staged' || intake.receipt_id !== receiptId ||
        intake.record_hash !== stored.record_hash || intake.file_id !== found[0].id) rposBridgeFailure_('storage_unresolved');
    const record = stored.export.record;
    // Existing/late historical workouts require the accepted reviewed path, never migration here.
    if (rposBridgeTime_(record.start_time) < cutoff) return rposBridgeDeliveryResult_('needs_reconciliation');
    if (record.end_time == null || rposBridgeTime_(record.end_time) > now - 120000 ||
        (record.update_time != null && rposBridgeTime_(record.update_time) > now - 120000)) {
      return rposBridgeDeliveryResult_('unresolved');
    }
    const intent = deps.journal.get(receiptId);
    if (intent && (intent.receipt_id !== receiptId || intent.record_hash !== stored.record_hash ||
        ['attempting', 'confirmed'].indexOf(intent.state) < 0 || intent.mode !== 'automatic_new_page')) {
      rposBridgeFailure_('delivery_conflict');
    }
    const ids = deps.remote.findUid(record.uid);
    if (ids.length > 1) rposBridgeFailure_('delivery_conflict');
    if (ids.length) {
      const p = deps.remote.read(ids[0]);
      if (intent && intent.page_id && intent.page_id !== p.id) rposBridgeFailure_('delivery_conflict');
      if (p.source !== 'samsung_health' || p.uid !== record.uid || p.legacy || !p.evidence ||
          p.evidence.migration || p.evidence.receipt_id !== receiptId ||
          p.evidence.record_hash !== stored.record_hash ||
          JSON.stringify(rposBridgeCanonical_(p.evidence.record)) !== JSON.stringify(rposBridgeCanonical_(record))) {
        return rposBridgeDeliveryResult_(intent ? 'unresolved' : 'needs_reconciliation');
      }
      deps.remote.verifyOriginal(p.id, stored.export);
      rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
        page_id: p.id, state: 'confirmed', mode: 'automatic_new_page'});
      return rposBridgeDeliveryResult_('confirmed');
    }
    // Missing lookup after an interrupted POST is not permission to create another page.
    if (intent) return rposBridgeDeliveryResult_('unresolved');
    if (deps.remote.findCandidates(record).length) return rposBridgeDeliveryResult_('needs_reconciliation');
    const prepared = deps.remote.prepare(stored);
    if (deps.remote.findUid(record.uid).length || deps.remote.findCandidates(record).length) {
      return rposBridgeDeliveryResult_('needs_reconciliation');
    }
    if (deps.permitNew && !deps.permitNew()) return rposBridgeDeliveryResult_('needs_reconciliation');
    rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
      state: 'attempting', mode: 'automatic_new_page'});
    const id = rposBridgeUuid_(deps.remote.create(prepared));
    const idsAfter = deps.remote.findUid(record.uid), p = deps.remote.read(id);
    if (idsAfter.length !== 1 || idsAfter[0] !== id || p.source !== 'samsung_health' || p.uid !== record.uid ||
        p.legacy || !p.evidence || p.evidence.migration || p.evidence.receipt_id !== receiptId ||
        p.evidence.record_hash !== stored.record_hash ||
        JSON.stringify(rposBridgeCanonical_(p.evidence.record)) !== JSON.stringify(rposBridgeCanonical_(record))) {
      return rposBridgeDeliveryResult_('unresolved');
    }
    deps.remote.verifyOriginal(id, stored.export);
    rposBridgeDeliverySave_(deps, receiptId, {receipt_id: receiptId, record_hash: stored.record_hash,
      page_id: id, state: 'confirmed', mode: 'automatic_new_page'});
    return rposBridgeDeliveryResult_('confirmed');
  } catch (error) {
    const safe = ['delivery_conflict', 'storage_unresolved', 'needs_reconciliation', 'not_configured'];
    return rposBridgeDeliveryResult_(safe.indexOf(error.bridgeCode) >= 0 ? error.bridgeCode : 'delivery_error');
  } finally { if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} } }
}

function rposBridgeAutomaticPort_(http, sourceId, sha) {
  sourceId = rposBridgeUuid_(sourceId);
  const base = rposBridgeNotionPort_(http, sourceId, sha);
  function query(filter) {
    const all = [], seen = Object.create(null); let cursor = null;
    for (let n = 0; n < 100; n++) {
      const body = {filter: filter, page_size: 100}; if (cursor) body.start_cursor = cursor;
      const r = http.request('POST', '/data_sources/' + sourceId + '/query', body);
      if (r.object !== 'list' || !Array.isArray(r.results)) rposBridgeFailure_('delivery_conflict');
      r.results.forEach(function(p) {
        if (p.object !== 'page') rposBridgeFailure_('delivery_conflict'); all.push(rposBridgeUuid_(p.id));
      });
      if (r.has_more === false) return all;
      if (typeof r.next_cursor !== 'string' || !r.next_cursor || seen[r.next_cursor]) rposBridgeFailure_('delivery_conflict');
      cursor = r.next_cursor; seen[cursor] = true;
    }
    rposBridgeFailure_('delivery_conflict');
  }
  function day(record) {
    if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(record.zone_offset || '')) {
      rposBridgeFailure_('needs_reconciliation');
    }
    const sign = record.zone_offset[0] === '-' ? -1 : 1;
    const offset = sign * (Number(record.zone_offset.slice(1,3)) * 60 + Number(record.zone_offset.slice(4))) * 60000;
    const local = new Date(rposBridgeTime_(record.start_time) + offset).toISOString().slice(0,10);
    const start = Date.parse(local + 'T00:00:00Z') - offset;
    return {local: local, start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString()};
  }
  return {
    findUid: function(uid) {
      // Also reject an original UID stored under another Source or an accepted alias.
      return Array.from(new Set(query({property: 'Source Record ID', rich_text: {equals: uid}})
        .concat(base.findAlias('samsung_health', uid))));
    },
    findCandidates: function(record) {
      const d = day(record);
      // Date/activity only block creation; they NEVER select or patch a destination.
      return query({and: [{or: [{property: 'Date', date: {equals: d.local}},
        {and: [{property: 'Date', date: {on_or_after: d.start}}, {property: 'Date', date: {before: d.end}}]}]},
        {or: [{property: 'Activity Type', select: {equals: rposBridgeAutoActivity_(record)}},
          {property: 'Activity Type', select: {is_empty: true}}]}]}).filter(function(id) {
        const p = base.read(id), other = p.evidence && p.evidence.record;
        // A distinct canonical UID with a verified, disjoint SDK interval is another
        // real workout, not an ambiguous planned/manual row. Never patch either one.
        if (p.source === 'samsung_health' && p.uid !== record.uid && !p.legacy && other &&
            other.uid === p.uid && other.end_time != null && record.end_time != null) {
          const a=rposBridgeTime_(record.start_time),b=rposBridgeTime_(record.end_time);
          const c=rposBridgeTime_(other.start_time),e=rposBridgeTime_(other.end_time);
          if (e>=c && b>=a && (b<=c || a>=e)) return false;
        }
        return true;
      });
    },
    read: base.read,
    verifyOriginal: function(id, value) {
      let cursor = null, count = 0; const seen = Object.create(null);
      for (let n = 0; n < 100; n++) {
        const r = http.request('GET', '/blocks/' + rposBridgeUuid_(id) + '/children?page_size=100' +
          (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
        if (r.object !== 'list' || !Array.isArray(r.results)) rposBridgeFailure_('delivery_conflict');
        r.results.forEach(function(b) {
          if (b.type !== 'code') return;
          let v; try { v = JSON.parse(rposBridgePlain_(b.code.rich_text || [])); } catch (ignore) { return; }
          if (v.schema_version === 'rpos.exercise.export.v1') {
            count++;
            if (JSON.stringify(rposBridgeCanonical_(v)) !== JSON.stringify(rposBridgeCanonical_(value))) rposBridgeFailure_('delivery_conflict');
          }
        });
        if (r.has_more === false) { if (count !== 1) rposBridgeFailure_('delivery_conflict'); return; }
        if (typeof r.next_cursor !== 'string' || !r.next_cursor || seen[r.next_cursor]) rposBridgeFailure_('delivery_conflict');
        cursor = r.next_cursor; seen[cursor] = true;
      }
      rposBridgeFailure_('delivery_conflict');
    },
    prepare: function(stored) {
      const ds = http.request('GET', '/data_sources/' + sourceId), r = stored.export.record;
      const required = {Session:'title',Source:'rich_text','Source Record ID':'rich_text',Date:'date',
        Notes:'rich_text','Capture State':'select','Activity Type':'select'};
      Object.keys(required).forEach(function(k) {
        if (!ds.properties || !ds.properties[k] || ds.properties[k].type !== required[k]) rposBridgeFailure_('delivery_conflict');
      });
      if (rposBridgeUuid_(ds.id) !== sourceId ||
          !ds.properties['Capture State'].select.options.some(function(o) { return o.name === 'Completed'; }) ||
          !ds.properties['Activity Type'].select.options.some(function(o) { return o.name === rposBridgeAutoActivity_(r); })) {
        rposBridgeFailure_('delivery_conflict');
      }
      const props = {Session:{title:rposBridgeRichText_(r.custom_title || r.exercise_type + ' · ' + day(r).local)},
        Source:{rich_text:rposBridgeRichText_('samsung_health')},'Source Record ID':{rich_text:rposBridgeRichText_(r.uid)},
        Date:{date:{start:r.start_time}},'Capture State':{select:{name:'Completed'}},
        'Activity Type':{select:{name:rposBridgeAutoActivity_(r)}},
        Notes:{rich_text:rposBridgeRichText_('Automatic SDK capture. Original export and canonical receipt retained. Missing parent metrics and subjective feedback remain missing. Activity classification is presentation only.')}};
      [['Duration (min)', r.duration_seconds == null ? null : r.duration_seconds / 60],
        ['Calories (kcal)', r.calories_kcal], ['Distance (km)', r.distance_meters == null ? null : r.distance_meters / 1000]]
        .forEach(function(pair) {
          if (pair[1] != null) {
            if (!ds.properties[pair[0]] || ds.properties[pair[0]].type !== 'number') rposBridgeFailure_('delivery_conflict');
            props[pair[0]] = {number: pair[1]};
          }
        });
      const evidence = {schema_version:'rpos.notion.evidence.v2',source:'samsung_health',receipt_id:stored.receipt_id,
        record_hash:stored.record_hash,record:r,aliases:[]};
      const codes = [JSON.stringify(stored.export), 'rpos.notion.evidence.v2\n' + JSON.stringify(evidence)].map(function(text) {
        const rt = rposBridgeRichText_(text); if (rt.length > 100) rposBridgeFailure_('delivery_conflict');
        return {object:'block',type:'code',code:{language:'json',rich_text:rt}};
      });
      const body = {parent:{type:'data_source_id',data_source_id:sourceId},properties:props,children:codes};
      if (encodeURIComponent(JSON.stringify(body)).replace(/%[A-F0-9]{2}/g, 'x').length > 500000) rposBridgeFailure_('delivery_conflict');
      return body;
    },
    create: function(body) {
      const p = http.request('POST', '/pages', body);
      if (p.object !== 'page') rposBridgeFailure_('delivery_conflict');
      return rposBridgeUuid_(p.id);
    }
  };
}

function rposBridgeAutomaticReceipt_(receiptId, props) {
  try {
    if (props.getProperty('BRIDGE_AUTOMATIC_ENABLED') !== 'true' || props.getProperty('BRIDGE_DELIVERY_ENABLED') !== 'true') {
      return rposBridgeDeliveryResult_('disabled');
    }
    const sourceId = rposBridgeUuid_(props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID'));
    if (typeof RPOS === 'undefined' || sourceId !== rposBridgeUuid_(RPOS.fitnessDataSourceId) ||
        props.getProperty('BRIDGE_SCHEDULER_BINDING_REVIEWED') !== 'true') return rposBridgeDeliveryResult_('not_configured');
    const flagNames = ['BRIDGE_INTAKE_ENABLED','BRIDGE_DELIVERY_ENABLED','BRIDGE_AUTOMATIC_ENABLED',
      'BRIDGE_MIGRATION_ENABLED','BRIDGE_SCHEDULER_BINDING_REVIEWED','BRIDGE_AUTOMATIC_START_AT',
      'BRIDGE_FITNESS_DATA_SOURCE_ID','BRIDGE_RECEIPT_FOLDER_ID','NOTION_TOKEN',
      'BRIDGE_AUTOMATIC_MODE','BRIDGE_AUTOMATIC_MAX_NEW'];
    const before = flagNames.map(function(k) { return props.getProperty(k); });
    if (before[0] !== 'true' || before[3] !== 'false') return rposBridgeDeliveryResult_('not_configured');
    if (before[9] !== 'pilot' && before[9] !== 'continuous') return rposBridgeDeliveryResult_('not_configured');
    if (before[9] === 'pilot' && (!/^[1-3]$/.test(before[10] || ''))) return rposBridgeDeliveryResult_('not_configured');
    rposBridgeTime_(before[5]);
    const rawHttp = rposBridgeNotionHttp_(props.getProperty('NOTION_TOKEN'), sourceId);
    const http = {request:function(method,path,body) {
      if (!flagNames.every(function(k,i) { return props.getProperty(k) === before[i]; })) rposBridgeFailure_('delivery_conflict');
      return rawHttp.request(method,path,body);
    }};
    return rposBridgeAutomatic_(receiptId, {enabled:true,startAt:props.getProperty('BRIDGE_AUTOMATIC_START_AT'),
      now:function() { return Date.now(); },sha256:rposBridgeSha_,lock:LockService.getScriptLock(),
      store:rposBridgeDriveStore_(props.getProperty('BRIDGE_RECEIPT_FOLDER_ID'),props),
      journal:rposBridgePropertyJournal_(props,'RPOS_BRIDGE_DELIVERY_'),
      permitNew:function() {
        if (!flagNames.every(function(k,i) { return props.getProperty(k) === before[i]; })) return false;
        if (before[9] === 'continuous') return true;
        const all = props.getProperties();
        return Object.keys(all).filter(function(k) {
          return /^RPOS_BRIDGE_DELIVERY_[a-f0-9]{64}$/.test(k) && JSON.parse(all[k]).mode === 'automatic_new_page';
        }).length < Number(before[10]);
      },
      remote:rposBridgeAutomaticPort_(http,sourceId,rposBridgeSha_)});
  } catch (ignore) { return rposBridgeDeliveryResult_('delivery_error'); }
}

/** Optional timer entry. Installing the trigger is a separate authorized operation. */
function rposBridgeRunAutomaticPending() {
  const result = {schema_version:'rpos.bridge.automatic.run.v1',status:'disabled',checked:0,confirmed:0};
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('BRIDGE_AUTOMATIC_ENABLED') !== 'true' || props.getProperty('BRIDGE_DELIVERY_ENABLED') !== 'true') return result;
    const cutoff = rposBridgeTime_(props.getProperty('BRIDGE_AUTOMATIC_START_AT'));
    const ids = Object.keys(props.getProperties()).filter(function(k) { return /^RPOS_BRIDGE_INTENT_[a-f0-9]{64}$/.test(k); });
    if (ids.length > 1000) { result.status='review_required'; return result; }
    const store = rposBridgeDriveStore_(props.getProperty('BRIDGE_RECEIPT_FOLDER_ID'),props);
    result.status='completed';
    for (let i=0;i<ids.length && result.checked<3;i++) {
      const id = ids[i].slice('RPOS_BRIDGE_INTENT_'.length), journal = props.getProperty('RPOS_BRIDGE_DELIVERY_'+id);
      if (journal && JSON.parse(journal).state === 'confirmed') continue;
      const retryKey = 'RPOS_BRIDGE_AUTOMATIC_RETRY_'+id, rawRetry=props.getProperty(retryKey);
      const retry=rawRetry?JSON.parse(rawRetry):{attempts:0,next_at:0,state:'ready'};
      if (!Number.isSafeInteger(retry.attempts) || retry.attempts<0 || retry.attempts>1000000 ||
          !Number.isSafeInteger(retry.next_at) || retry.next_at<0 ||
          ['ready','retry','blocked','confirmed'].indexOf(retry.state)<0) {
        result.status='review_required';continue;
      }
      if (retry.state==='blocked' || retry.next_at>Date.now()) continue;
      const found = store.find(id);
      if (found.length !== 1 || rposBridgeTime_(found[0].value.export.record.start_time) < cutoff) continue;
      const attempt=retry.attempts+1, delay=Math.min(900,30*Math.pow(2,Math.min(attempt-1,5)));
      const next={attempts:attempt,next_at:Date.now()+delay*1000,state:'retry'};
      props.setProperty(retryKey,JSON.stringify(next));
      if (props.getProperty(retryKey)!==JSON.stringify(next)) {result.status='review_required';continue;}
      const r = rposBridgeAutomaticReceipt_(id,props); result.checked++;
      if (r.status === 'confirmed') {result.confirmed++;next.state='confirmed';}
      else {
        result.status='pending_or_review';
        if (['delivery_conflict','needs_reconciliation','not_configured','disabled'].indexOf(r.status)>=0) next.state='blocked';
      }
      props.setProperty(retryKey,JSON.stringify(next));
    }
  } catch (ignore) { result.status='delivery_error'; }
  return result;
}

/** Owner-only read-only preparation check. No health records, tokens or identifiers logged. */
function rposBridgeAutomaticPreflight() {
  let report={schema_version:'rpos.bridge.automatic.preflight.v1',version:'0.8.0',status:'review_required'};
  try {
    const props=PropertiesService.getScriptProperties(),before=JSON.stringify(props.getProperties());
    const source=props.getProperty('BRIDGE_FITNESS_DATA_SOURCE_ID');
    const bound=typeof RPOS!=='undefined' && source && rposBridgeUuid_(source)===rposBridgeUuid_(RPOS.fitnessDataSourceId);
    const flags={intake:props.getProperty('BRIDGE_INTAKE_ENABLED')==='true',
      delivery:props.getProperty('BRIDGE_DELIVERY_ENABLED')==='true',
      migration:props.getProperty('BRIDGE_MIGRATION_ENABLED')==='true',
      automatic:props.getProperty('BRIDGE_AUTOMATIC_ENABLED')==='true',
      binding_reviewed:props.getProperty('BRIDGE_SCHEDULER_BINDING_REVIEWED')==='true'};
    const configured=!!props.getProperty('BRIDGE_RECEIPT_FOLDER_ID')&&!!props.getProperty('NOTION_TOKEN')&&
      /^[a-f0-9]{64}$/.test(props.getProperty('BRIDGE_INTAKE_HMAC_KEY')||'');
    report={schema_version:report.schema_version,version:report.version,
      status:bound&&configured&&flags.intake&&flags.binding_reviewed&&!flags.delivery&&!flags.migration&&!flags.automatic?
        'prepared_activation_off':'review_required',source_binding_matches:!!bound,configuration_present:configured,flags:flags,
      activation_flags_unchanged:before===JSON.stringify(props.getProperties())};
  } catch(ignore) {report.status='review_required';}
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(report));
  return report;
}
