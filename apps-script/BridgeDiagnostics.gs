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
