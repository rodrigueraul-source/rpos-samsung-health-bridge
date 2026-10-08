/* Wrap the owner's existing capture creator; preserves its payload and notifications. */
function rposBridgeScheduler_(eventId, deps, create) {
  let locked = false;
  try {
    if (!rposBridgeText_(eventId, 256)) rposBridgeFailure_('delivery_conflict');
    locked = deps.lock.tryLock(1000);
    if (!locked) return {ok: false, stage: 'bridge_busy'};
    const source = 'R-POS External Scheduler F';
    const key = deps.sha256(JSON.stringify([source, eventId]));
    const intent = deps.journal.get(key);
    if (intent && (intent.event_id !== eventId || ['attempting', 'confirmed'].indexOf(intent.state) < 0)) {
      rposBridgeFailure_('delivery_conflict');
    }
    const ids = deps.remote.findUid(source, eventId).concat(deps.remote.findAlias(source, eventId));
    const unique = ids.filter(function(id, index) { return ids.indexOf(id) === index; });
    if (unique.length > 1) rposBridgeFailure_('delivery_conflict');
    if (unique.length === 1) {
      const p = deps.remote.read(unique[0]);
      if (intent && intent.page_id && intent.page_id !== p.id) rposBridgeFailure_('delivery_conflict');
      rposBridgeDeliverySave_(deps, key, {event_id: eventId, page_id: p.id, state: 'confirmed'});
      return {ok: true, reused: true, page_id: p.id, page_url: p.url};
    }
    if (intent) return {ok: false, stage: 'bridge_scheduler_unresolved'};
    rposBridgeDeliverySave_(deps, key, {event_id: eventId, state: 'attempting'});
    const created = create();
    if (!created || !created.ok || !created.page_id) return {ok: false, stage: 'bridge_scheduler_unresolved'};
    const id = rposBridgeUuid_(created.page_id);
    // Keep target before readback: empty lookup after a lost response cannot cause another create.
    rposBridgeDeliverySave_(deps, key, {event_id: eventId, page_id: id, state: 'attempting'});
    const matches = deps.remote.findUid(source, eventId);
    if (matches.length !== 1 || matches[0] !== id) return {ok: false, stage: 'bridge_scheduler_unresolved'};
    const p = deps.remote.read(id);
    if (p.source !== source || p.uid !== eventId) rposBridgeFailure_('delivery_conflict');
    rposBridgeDeliverySave_(deps, key, {event_id: eventId, page_id: id, state: 'confirmed'});
    return {ok: true, reused: false, page_id: id, page_url: p.url};
  } catch (ignore) { return {ok: false, stage: 'bridge_scheduler_conflict'}; }
  finally { if (locked) { try { deps.lock.releaseLock(); } catch (ignore) {} } }
}

function rposBridgeCreateGymCapture_(cfg, event, plan, now, legacyCreate) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('BRIDGE_SCHEDULER_BINDING_REVIEWED') !== 'true') {
      return {ok: false, stage: 'bridge_scheduler_not_configured'};
    }
    // Same existing project / same Fitness source. No new DB or notifications.
    const port = rposBridgeNotionPort_(rposBridgeNotionHttp_(cfg.notionToken),
      RPOS.fitnessDataSourceId, rposBridgeSha_);
    return rposBridgeScheduler_(event.event_id, {
      sha256: rposBridgeSha_, lock: LockService.getScriptLock(), remote: port,
      journal: rposBridgePropertyJournal_(props, 'RPOS_BRIDGE_SCHEDULER_')
    }, function() { return legacyCreate(cfg, event, plan, now); });
  } catch (ignore) { return {ok: false, stage: 'bridge_scheduler_conflict'}; }
}
