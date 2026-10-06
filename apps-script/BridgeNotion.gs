/* v2 hashes the intake record using sorted JS JSON. It is NOT the Python event hash. */
function rposBridgeRichText_(text) {
  const result = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 2000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push({type: 'text', text: {content: text.slice(offset, end)}});
    offset = end;
  }
  return result;
}

function rposBridgePlain_(items) {
  return items.map(function(item) {
    return item.type === 'text' ? item.text.content : (item.plain_text || '');
  }).join('');
}

function rposBridgeWritableText_(items) {
  return items.map(function(item) {
    if (['text', 'mention', 'equation'].indexOf(item.type) < 0 || !item[item.type]) {
      rposBridgeFailure_('delivery_conflict');
    }
    const copy = {type: item.type};
    copy[item.type] = JSON.parse(JSON.stringify(item[item.type]));
    if (item.annotations) copy.annotations = JSON.parse(JSON.stringify(item.annotations));
    return copy;
  });
}

function rposBridgeAlias_(source, uid, sha) {
  // Python v1 alias uses ensure_ascii=True, including surrogate pairs.
  const ascii = JSON.stringify([source, uid]).replace(/[\u007f-\uffff]/g, function(c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
  return 'rpos.alias.v1:' + sha(ascii);
}

function rposBridgeNotionPort_(http, dataSourceId, sha) {
  const sourceId = rposBridgeUuid_(dataSourceId);
  let checked = false;
  const prefix = 'rpos.notion.evidence.v2\n';
  function schema() {
    if (checked) return;
    const ds = http.request('GET', '/data_sources/' + sourceId);
    if (rposBridgeUuid_(ds.id) !== sourceId) rposBridgeFailure_('delivery_conflict');
    const required = {'Session': 'title', 'Source': 'rich_text', 'Source Record ID': 'rich_text',
      'Date': 'date', 'Notes': 'rich_text'};
    Object.keys(required).forEach(function(name) {
      if (!ds.properties || !ds.properties[name] || ds.properties[name].type !== required[name]) {
        rposBridgeFailure_('delivery_conflict');
      }
    });
    checked = true;
  }
  function list(method, path, payload) {
    let cursor = null;
    const seen = Object.create(null), all = [];
    for (let batch = 0; batch < 100; batch++) {
      const query = {page_size: 100};
      if (cursor) query.start_cursor = cursor;
      const response = method === 'GET' ? http.request(method, path + '?page_size=100' +
        (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '')) :
        http.request(method, path, Object.assign({}, payload, query));
      if (response.object !== 'list' || !Array.isArray(response.results)) rposBridgeFailure_('delivery_conflict');
      all.push.apply(all, response.results);
      if (response.has_more === false) return all;
      cursor = response.next_cursor;
      if (typeof cursor !== 'string' || !cursor || seen[cursor]) rposBridgeFailure_('delivery_conflict');
      seen[cursor] = true;
    }
    rposBridgeFailure_('delivery_conflict');
  }
  function query(filter) {
    schema();
    return list('POST', '/data_sources/' + sourceId + '/query', {filter: filter}).map(function(p) {
      if (p.object !== 'page') rposBridgeFailure_('delivery_conflict');
      return rposBridgeUuid_(p.id);
    });
  }
  function page(id) {
    schema(); id = rposBridgeUuid_(id);
    const p = http.request('GET', '/pages/' + id);
    if (p.object !== 'page' || rposBridgeUuid_(p.id) !== id || !p.parent ||
        p.parent.type !== 'data_source_id' || rposBridgeUuid_(p.parent.data_source_id) !== sourceId ||
        p.in_trash || p.archived || p.is_archived) rposBridgeFailure_('delivery_conflict');
    return p;
  }
  function property(p, name) {
    const prop = p.properties && p.properties[name];
    if (!prop || prop.type !== 'rich_text' || typeof prop.id !== 'string') rposBridgeFailure_('delivery_conflict');
    return list('GET', '/pages/' + rposBridgeUuid_(p.id) + '/properties/' +
      encodeURIComponent(decodeURIComponent(prop.id))).map(function(item) {
      if (item.type !== 'rich_text' || !item.rich_text) rposBridgeFailure_('delivery_conflict');
      return item.rich_text;
    });
  }
  function evidence(id) {
    const pending = [{id: id, depth: 0}], seen = Object.create(null);
    let managed = null, legacy = false, proseLegacy = false, count = 0;
    const legacyBlocks = [];
    const proseBlocks = [];
    while (pending.length) {
      const node = pending.pop();
      if (seen[node.id] || node.depth > 30) rposBridgeFailure_('delivery_conflict');
      seen[node.id] = true;
      list('GET', '/blocks/' + rposBridgeUuid_(node.id) + '/children').forEach(function(b) {
        if (++count > 10000 || b.in_trash || b.archived) rposBridgeFailure_('delivery_conflict');
        const text = rposBridgePlain_((b[b.type] || {}).rich_text || []);
        // Accepted early reconciliation pages contain prose rather than a v1
        // hash block. Recognize only our exact heading, never a date/title match.
        // Explicit UID/record/target/snapshot-bound operator review is still
        // required. Bind every retained original block, including table cells.
        if (/^heading_[123]$/.test(b.type) &&
            /^Samsung Health Bridge · UID reconciliation · \d{2}-[A-Za-z]{3}-\d{4}$/.test(text)) {
          proseLegacy = true;
        }
        if (text.indexOf(prefix) !== 0) {
          proseBlocks.push({id: b.id ? rposBridgeUuid_(b.id) : null, type: b.type,
            text_hash: sha(JSON.stringify(rposBridgeCanonical_({parent: node.id,
              content: b[b.type] || {}, has_children: b.has_children === true})))});
        }
        if (text.indexOf('rpos.notion.evidence.v1\n') === 0 || /Bridge payload SHA256:\s*`?[a-f0-9]{64}/.test(text)) {
          legacy = true;
          legacyBlocks.push({id: b.id ? rposBridgeUuid_(b.id) : null, type: b.type, text_hash: sha(text)});
        }
        if (text.indexOf(prefix) === 0) {
          if (b.type !== 'code' || managed) rposBridgeFailure_('delivery_conflict');
          const value = JSON.parse(text.slice(prefix.length));
          if (value.schema_version !== 'rpos.notion.evidence.v2' || value.source !== 'samsung_health' ||
              !value.record || !Array.isArray(value.aliases) ||
              sha(JSON.stringify(rposBridgeCanonical_(value.record))) !== value.record_hash ||
              sha(JSON.stringify(['samsung_health', value.record.uid])) !== value.receipt_id) {
            rposBridgeFailure_('delivery_conflict');
          }
          managed = value;
        }
        if (b.has_children) pending.push({id: rposBridgeUuid_(b.id), depth: node.depth + 1});
      });
    }
    if (proseLegacy) {
      legacy = true;
      legacyBlocks.splice.apply(legacyBlocks, [0, legacyBlocks.length].concat(proseBlocks));
    }
    legacyBlocks.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
    if (managed && (legacy || managed.migration)) {
      const migration = managed.migration;
      if (!migration || migration.schema_version !== 'rpos.bridge.migration.v1' ||
          !/^[a-f0-9]{64}$/.test(migration.review_hash || '') ||
          JSON.stringify(rposBridgeCanonical_(migration.legacy_blocks)) !==
          JSON.stringify(rposBridgeCanonical_(legacyBlocks)) ||
          legacyBlocks.some(function(b) { return !b.id; })) rposBridgeFailure_('delivery_conflict');
      legacy = false; // Explicit v2 migration retains and authenticates every legacy block.
    }
    return {value: managed, legacy: legacy, legacy_blocks: legacyBlocks};
  }
  function read(id) {
    const p = page(id), source = rposBridgePlain_(property(p, 'Source'));
    const uid = rposBridgePlain_(property(p, 'Source Record ID')), ev = evidence(rposBridgeUuid_(p.id));
    if (ev.value && (source !== ev.value.source || uid !== ev.value.record.uid)) rposBridgeFailure_('delivery_conflict');
    const notes = property(p, 'Notes'), lines = rposBridgePlain_(notes).split(/\r?\n/);
    if (ev.value && !ev.value.aliases.every(function(alias) {
      return alias && rposBridgeText_(alias.source, 256) && rposBridgeText_(alias.uid, 2000) &&
        lines.indexOf(rposBridgeAlias_(alias.source, alias.uid, sha)) >= 0;
    })) rposBridgeFailure_('delivery_conflict');
    return {id: rposBridgeUuid_(p.id), source: source, uid: uid, edited: p.last_edited_time,
      date: p.properties.Date.date, notes: notes, evidence: ev.value, legacy: ev.legacy,
      legacy_blocks: ev.legacy_blocks, url: p.url};
  }
  return {
    findUid: function(source, uid) {
      return query({and: [{property: 'Source', rich_text: {equals: source}},
        {property: 'Source Record ID', rich_text: {equals: uid}}]});
    },
    findAlias: function(source, uid) {
      const marker = rposBridgeAlias_(source, uid, sha);
      return query({property: 'Notes', rich_text: {contains: marker}}).filter(function(id) {
        return rposBridgePlain_(property(page(id), 'Notes')).split(/\r?\n/).indexOf(marker) >= 0;
      });
    },
    read: read,
    prepareMigration: function(p, stored, review, reviewHash) {
      // No canonical identity, Date, metrics, feedback or legacy block is changed.
      let notes = rposBridgeWritableText_(p.notes);
      review.aliases.forEach(function(alias) {
        const marker = rposBridgeAlias_(alias.source, alias.uid, sha);
        if (rposBridgePlain_(notes).split(/\r?\n/).indexOf(marker) < 0) {
          notes = notes.concat(rposBridgeRichText_('\n' + marker + '\n' + JSON.stringify(alias)));
        }
      });
      const value = {schema_version: 'rpos.notion.evidence.v2', source: 'samsung_health',
        receipt_id: stored.receipt_id, record_hash: stored.record_hash, record: stored.export.record,
        aliases: review.aliases, migration: {schema_version: 'rpos.bridge.migration.v1',
          review_hash: reviewHash, legacy_blocks: p.legacy_blocks}};
      const code = {language: 'json', rich_text: rposBridgeRichText_(prefix + JSON.stringify(value))};
      const prepared = {properties: {Notes: {rich_text: notes}}, code: code};
      if (notes.length > 100 || code.rich_text.length > 100) rposBridgeFailure_('delivery_conflict');
      [{properties: prepared.properties}, {children: [{object: 'block', type: 'code', code: code}]}].forEach(function(body) {
        if (encodeURIComponent(JSON.stringify(body)).replace(/%[A-F0-9]{2}/g, 'x').length > 500000) {
          rposBridgeFailure_('delivery_conflict');
        }
      });
      return prepared;
    },
    prepare: function(p, stored, reviewedAliases) {
      const record = stored.export.record, aliases = [];
      const props = {'Source': {rich_text: rposBridgeRichText_('samsung_health')},
        'Source Record ID': {rich_text: rposBridgeRichText_(record.uid)},
        'Date': {date: {start: record.start_time}}};
      let notes = rposBridgeWritableText_(p.notes);
      if (p.uid && (p.source !== 'samsung_health' || p.uid !== record.uid)) {
        const alias = {source: p.source, uid: p.uid, date: p.date};
        aliases.push(alias);
        const marker = rposBridgeAlias_(p.source, p.uid, sha);
        if (rposBridgePlain_(notes).split(/\r?\n/).indexOf(marker) < 0) {
          notes = notes.concat(rposBridgeRichText_('\n' + marker + '\n' + JSON.stringify(alias)));
          props.Notes = {rich_text: notes};
        }
      }
      (reviewedAliases || []).forEach(function(alias) {
        aliases.push(JSON.parse(JSON.stringify(alias)));
        const marker = rposBridgeAlias_(alias.source, alias.uid, sha);
        if (rposBridgePlain_(notes).split(/\r?\n/).indexOf(marker) < 0) {
          notes = notes.concat(rposBridgeRichText_('\n' + marker + '\n' + JSON.stringify(alias)));
          props.Notes = {rich_text: notes};
        }
      });
      const value = {schema_version: 'rpos.notion.evidence.v2', source: 'samsung_health',
        receipt_id: stored.receipt_id, record_hash: stored.record_hash, record: record, aliases: aliases};
      const code = {language: 'json', rich_text: rposBridgeRichText_(prefix + JSON.stringify(value))};
      if (code.rich_text.length > 100 || notes.length > 100) rposBridgeFailure_('delivery_conflict');
      // Preflight BOTH requests before the first remote write (UTF-8 byte limits).
      [{properties: props}, {children: [{object: 'block', type: 'code', code: code}]}].forEach(function(body) {
        if (encodeURIComponent(JSON.stringify(body)).replace(/%[A-F0-9]{2}/g, 'x').length > 500000) {
          rposBridgeFailure_('delivery_conflict');
        }
      });
      return {properties: props, code: code};
    },
    write: function(id, prepared) {
      id = rposBridgeUuid_(id);
      const response = http.request('PATCH', '/pages/' + id, {properties: prepared.properties});
      if (rposBridgeUuid_(response.id) !== id) rposBridgeFailure_('delivery_conflict');
      http.request('PATCH', '/blocks/' + id + '/children', {
        children: [{object: 'block', type: 'code', code: prepared.code}]});
    }
  };
}
