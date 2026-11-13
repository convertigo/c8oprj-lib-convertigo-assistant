const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');

function settings(options) {
  let payload;
  const sandbox = {
    now: () => 123456789,
    attachTigoAccessRefusal: () => {},
    optionsWithRequestFallbacks: value => value,
    keepNoCodeServerValues: value => value,
    trim: value => String(value ?? '').trim(),
    normalizeProviderSelector: value => value || 'vibe',
    normalizeSkillProfile: value => value.agentProfile || 'generalist',
    normalizeConversationId: value => value || '',
    defaultMcpEndpoint: () => '/api/mcp',
    resolveWorkspaceRoot: () => '/workspace',
    codexHomeForRun: () => '', codexHomeScopeForRun: () => 'user',
    existingViewerCdpEndpoint: value => value.browserDebugUrl || '',
    vibeProfileForProvider: () => 'mistral',
    bridgeCall: (_options, sequence, value) => { assert.equal(sequence, 'agent_settings'); payload = value; return { ok: true }; },
    applyNoCodeServerDefaults: (_options, result) => result
  };
  vm.runInNewContext(backendParts(['agentSettingsForOptions', 'providerHomeScopeForRun', 'boolValue']), sandbox);
  assert.equal(sandbox.agentSettingsForOptions(options, '/workspace', 'owner', '', 'vibe').ok, true);
  return payload;
}

test('settings use the installation user home and refresh the full ACP catalog', () => {
  const payload = settings({ userId: 'owner', runtimePresenceOnly: false });
  assert.equal(payload.vibeHomeScope, 'user');
  assert.equal(payload.refreshModelCatalog, true);
});

test('presence-only settings stay passive and explicit refresh choices are preserved', () => {
  assert.equal(settings({ runtimePresenceOnly: 'true' }).refreshModelCatalog, false);
  assert.equal(settings({ runtimePresenceOnly: true }).vibeHomeScope, 'user');
  assert.equal(settings({ refreshModelCatalog: false }).refreshModelCatalog, false);
  assert.equal(settings({ runtimePresenceOnly: true, refreshModelCatalog: true }).refreshModelCatalog, true);
});

test('a panel start or a conversation creation keeps the Bridge catalog caches', () => {
  // AgentCreateConversation forwards neither refreshModelCatalog nor runtimePresenceOnly: a refresh there would start a
  // Vibe process, probe every gateway model's efforts and start the wrapper metadata process at each panel start and
  // each new conversation.
  const created = settings({ threadid: '', provider: '', includeSettings: '', targetProject: 'Demo', userId: 'studio' });
  assert.equal(created.refreshModelCatalog, '');
  assert.equal(settings({ skillProfile: 'nocode', userId: 'ann' }).refreshModelCatalog, '');
  // the settings screen says what it wants
  assert.equal(settings({ runtimePresenceOnly: false, refreshModelCatalog: true }).refreshModelCatalog, true);
  assert.equal(settings({ runtimePresenceOnly: 'false' }).refreshModelCatalog, true);
});

test('settings preserve explicit homes and the viewer conversation scope', () => {
  const explicit = settings({ vibeHome: '/custom/home', vibeHomeScope: 'explicit' });
  assert.equal(explicit.vibeHome, '/custom/home');
  assert.equal(explicit.vibeHomeScope, 'explicit');
  assert.equal(settings({ homeScope: 'project' }).vibeHomeScope, 'project');
  const viewer = settings({ browserDebugUrl: 'http://127.0.0.1:33333', threadid: 'conversation-1' });
  assert.equal(viewer.vibeHomeScope, 'conversation');
  assert.equal(viewer.conversationId, 'conversation-1');
});
