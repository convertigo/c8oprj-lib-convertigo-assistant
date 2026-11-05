// The No Code agent of a server is set by its administrators for every user (global symbols assistant.nocode.*,
// assistant.feedback.policy, assistant.stack.channel; agents.tool_policy read only), from the Tigo page of the
// C8Oforms administration. node --test tests/nocode-server-settings.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

function fixture({ studio = false, webAdmin = false, admin = false, user = 'alice@example.com', symbols = {}, platformPolicy = '', c8oformsRight = true } = {}) {
  const store = new Map(Object.entries(symbols));
  const edits = [];
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    log: { info() {}, warn() {} },
    java: { lang: { System: { getProperty: name => (name === 'convertigo.engine.agents.tool_policy' ? platformPolicy : null) } } },
    Engine: {
      isStudioMode: () => studio,
      theApp: { databaseObjectsManager: {
        symbolsGetValue: name => (store.has(name) ? store.get(name) : null),
        symbolsEdit: (oldName, name, value) => { edits.push(['edit', name, value]); store.delete(oldName); store.set(name, value); },
        symbolsDelete: name => { edits.push(['delete', name]); store.delete(name); }
      } }
    },
    normalizeProvider: value => {
      const provider = String(value ?? '').trim().toLowerCase();
      return provider === 'mistral-vibe' ? 'vibe' : (provider === 'claude-code' ? 'claude' : provider || 'vibe');
    },
    assistantProfileDescriptor: options => ({ id: String(options.userId || '').trim() && options.userId !== 'studio' ? 'nocode' : 'generalist' }),
    truthyAccess: value => value === true || String(value ?? '').trim().toLowerCase() === 'true',
    isWebAdminSession: () => webAdmin,
    agentAccessSequenceAvailable: () => c8oformsRight,
    publicState: state => ({ threadid: state.threadid, provider: state.provider }),
    agentAccessOfSession: () => ({ admin }),
    bridgeCallerRefusal: () => null,
    C8O: { assistantAgentBridge: {} }
  };
  vm.runInNewContext(backendParts(['serverSymbolValue', 'noCodeServerChoice', 'readNoCodeServerSettings', 'noCodeServerSettings',
    'isNoCodeAdministrator', 'withNoCodeServerSettings', 'applyNoCodeServerDefaults', 'saveNoCodeServerSettings',
    'keepNoCodeServerValues', 'noCodeAgentChanged'],
  ['NOCODE_SERVER_SYMBOLS', 'NOCODE_SERVER_PROVIDERS', 'NOCODE_SERVER_REASONING', 'NOCODE_SERVER_CHOICES']), sandbox);
  // the public entry point is an assignment: run it with the same helpers
  const source = read('js/agent_bridge_client.js');
  const start = source.indexOf('  C8O.assistantAgentBridge.serverSettings = function (options) {');
  const end = source.indexOf('\n  };\n', start) + 5;
  vm.runInNewContext(source.slice(start, end), sandbox);
  return { sandbox, store, edits, user };
}

test('a No Code user gets the server agent, model and effort, whatever the page sends, and saves none of them', () => {
  const { sandbox } = fixture({ symbols: { 'assistant.nocode.provider': 'mistral-vibe', 'assistant.nocode.model': 'mistral-large-4', 'assistant.nocode.reasoning': 'High' } });
  const options = sandbox.withNoCodeServerSettings({ userId: 'alice@example.com', provider: 'claude', model: 'opus', reasoningLevel: 'max', savePreferences: 'true' });
  assert.equal(options.provider, 'vibe');
  assert.equal(options.agentProvider, 'vibe');
  assert.equal(options.model, 'mistral-large-4');
  assert.equal(options.reasoningEffort, 'high');
  assert.equal(options.reasoningLevel, undefined);
  assert.equal(options.savePreferences, 'false', 'not empty: no request parameter fills it again');
  for (const flag of ['updateRuntime', 'forceRuntimeUpdate', 'forceUpdate', 'forceVibeInstall']) {
    assert.equal(options[flag], 'false', flag);
  }
  // agentSettingsForOptions reads the request parameters again: the server's values stay
  const again = sandbox.keepNoCodeServerValues({ ...options, model: 'from-request', reasoningLevel: 'max', serviceTier: 'fast', savePreferences: 'true' });
  assert.equal(again.model, 'mistral-large-4');
  assert.equal(again.reasoningEffort, 'high');
  assert.equal(again.reasoningLevel, '');
  assert.equal(again.serviceTier, '');
  assert.equal(again.savePreferences, 'false');
});

test('a conversation of another agent than the server\'s is not continued', () => {
  const { sandbox } = fixture({ symbols: { 'assistant.nocode.provider': 'convertigo' } });
  const options = sandbox.withNoCodeServerSettings({ userId: 'alice@example.com' });
  assert.equal(sandbox.noCodeAgentChanged(options, { threadid: 't', provider: 'convertigo' }), null);
  assert.equal(sandbox.noCodeAgentChanged(options, null), null, 'a new conversation');
  const changed = sandbox.noCodeAgentChanged(options, { threadid: 't', provider: 'codex' });
  assert.equal(changed.error.code, 'agent_changed');
  assert.equal(sandbox.noCodeAgentChanged({}, { provider: 'codex' }), null, 'not a No Code request of a managed server');
});

test('a server whose C8Oforms does not know the Tigo right yet: nobody sets Tigo for the users, nothing is imposed', () => {
  const { sandbox } = fixture({ c8oformsRight: false, symbols: { 'assistant.nocode.provider': 'convertigo' } });
  assert.equal(sandbox.noCodeServerSettings({ userId: 'alice@example.com' }), null);
  assert.equal(sandbox.withNoCodeServerSettings({ userId: 'alice@example.com', provider: 'vibe' }).provider, 'vibe');
});

test('nothing set: the Convertigo agent with its own default model and effort', () => {
  const { sandbox } = fixture();
  const settings = sandbox.noCodeServerSettings({ userId: 'alice@example.com' });
  assert.equal(settings.managed, true);
  assert.equal(settings.provider, 'convertigo');
  assert.equal(settings.model, '');
  assert.equal(settings.reasoning, '');
  assert.equal(settings.writeConfirm, 'off');
  assert.equal(settings.feedbackPolicy, 'user');
  assert.equal(settings.stackChannel, 'stable');
  assert.equal(settings.toolPolicy, 'files');
  assert.equal(settings.symbols.toolPolicy.readOnly, true);
});

test('not concerned: the Studio; the settings screen of an administrator is the server\'s', () => {
  assert.equal(fixture({ studio: true }).sandbox.noCodeServerSettings({ userId: 'alice@example.com' }), null);
  const page = { userId: 'alice@example.com', provider: 'claude', model: 'opus', reasoningEffort: 'high', savePreferences: 'true' };
  // a user who is not an administrator: the server values, nothing saved, in the settings screen as in a turn
  const user = fixture({ symbols: { 'assistant.nocode.provider': 'convertigo' } });
  assert.equal(user.sandbox.withNoCodeServerSettings({ ...page }, true).provider, 'convertigo');
  assert.equal(user.store.get('assistant.nocode.provider'), 'convertigo');
  for (const caller of [{ admin: true }, { webAdmin: true }]) {
    const admin = fixture({ ...caller, symbols: { 'assistant.nocode.provider': 'convertigo' } });
    const options = admin.sandbox.withNoCodeServerSettings({ ...page }, true);
    assert.equal(options.provider, 'claude', 'the screen lists and keeps the administrator\'s choice');
    assert.equal(options.savePreferences, 'false', 'no preference of their own');
    assert.equal(options.noCodeServerAdministrator, true);
    assert.equal(admin.store.get('assistant.nocode.provider'), 'claude', 'saved for the server');
    assert.equal(admin.store.get('assistant.nocode.model'), 'opus');
    assert.equal(admin.store.get('assistant.nocode.reasoning'), 'high');
    // the administrator's own turns run on the server values too
    assert.equal(admin.sandbox.withNoCodeServerSettings({ userId: 'alice@example.com', provider: 'vibe' }).provider, 'claude');
  }
  const reading = fixture({ admin: true });
  reading.sandbox.withNoCodeServerSettings({ ...page, savePreferences: '' }, true);
  assert.equal(reading.edits.length, 0, 'opening the screen saves nothing');
});

test('the settings the Bridge answers: the server values are the defaults and the only preference', () => {
  const { sandbox } = fixture({ symbols: { 'assistant.nocode.model': 'glm-5-3' } });
  const settings = sandbox.applyNoCodeServerDefaults({ userId: 'alice@example.com' },
    { defaults: { provider: 'vibe', model: 'mistral-large-4', reasoning: 'high' }, preferences: { model: 'mistral-large-4' } });
  assert.deepEqual({ ...settings.defaults }, { provider: 'convertigo', model: 'glm-5-3', reasoning: '' });
  assert.equal(settings.preferences.model, 'glm-5-3');
  assert.equal(settings.preferences.source, 'server');
  assert.equal(settings.serverSettings.managed, true);
});

test('an administrator saves the symbols; a value left empty removes its symbol; anyone else is refused', () => {
  const refused = fixture().sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { provider: 'vibe' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'not_administrator');
  const { sandbox, store, edits } = fixture({ admin: true, symbols: { 'assistant.nocode.reasoning': 'high' } });
  const saved = sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: JSON.stringify({
    provider: 'Claude-Code', model: 'claude-opus', reasoning: '', writeConfirm: 'on', feedbackPolicy: 'off', stackChannel: 'preview', toolPolicy: 'full' }) });
  assert.equal(saved.ok, true);
  assert.equal(store.get('assistant.nocode.provider'), 'claude');
  assert.equal(store.get('assistant.nocode.model'), 'claude-opus');
  assert.equal(store.has('assistant.nocode.reasoning'), false, 'emptied');
  assert.equal(store.get('assistant.nocode.write_confirm'), 'on');
  assert.equal(store.get('assistant.feedback.policy'), 'off');
  assert.equal(store.get('assistant.stack.channel'), 'preview');
  assert.equal(store.has('agents.tool_policy'), false, 'the confinement stays the operator\'s');
  assert.ok(!edits.some(edit => edit[1] === 'agents.tool_policy'));
  assert.equal(saved.settings.provider, 'claude');
  const bad = fixture({ admin: true }).sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { model: 'a model; rm -rf' } });
  assert.equal(bad.error.code, 'invalid_value');
  // a sequence variable is a Java string, whose typeof is object (Studio_8.4_tigo_admin, 05/11: nothing was saved)
  const javaString = fixture({ admin: true });
  // eslint-disable-next-line no-new-wrappers
  javaString.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: new String('{"provider":"vibe"}') });
  assert.equal(javaString.store.get('assistant.nocode.provider'), 'vibe');
  assert.equal(fixture({ admin: true }).sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: 'not json' }).error.code, 'invalid_value');
  assert.equal(fixture({ admin: true }).sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: 'null' }).error.code, 'invalid_value');
  // nothing is written when one value is no choice, an unknown agent included
  const partial = fixture({ admin: true });
  const answer = partial.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { provider: 'vibe', model: 'bad model!' } });
  assert.equal(answer.error.code, 'invalid_value');
  assert.equal(partial.edits.length, 0);
  assert.equal(fixture({ admin: true }).sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { provider: 'gemini' } }).error.code, 'invalid_value');
});

test('the platform confinement wins and is shown as such', () => {
  const settings = fixture({ platformPolicy: 'mcp-only', symbols: { 'agents.tool_policy': 'full' } }).sandbox.noCodeServerSettings({ userId: 'a@b.c' });
  assert.equal(settings.toolPolicy, 'mcp-only');
  assert.equal(settings.symbols.toolPolicy.source, 'platform');
});

test('the entry points apply the server settings right after the caller, the confirm switch takes the server default', () => {
  const source = read('js/agent_bridge_client.js');
  for (const name of ['createConversation', 'settings', 'setupAgent', 'sendMessage']) {
    const body = source.slice(source.indexOf(`C8O.assistantAgentBridge.${name} = function (options) {`));
    assert.match(body.slice(0, 400), new RegExp('options = withCallerUserId\\([^\\n]+\\);\\n    options = withNoCodeServerSettings\\(options' + (name === 'settings' ? ', true' : '') + '\\);'), name);
  }
  assert.match(source, /return applyNoCodeServerDefaults\(options, settings\);/);
  assert.match(source, /host\.defaultOn = function \(\) \{\n\s+var server = noCodeServerSettings\(options\);\n\s+return server !== null && server\.writeConfirm === "on";/);
  const sandbox = { C8O: {} };
  vm.runInNewContext(read('js/agent_write_confirm.js'), sandbox);
  const isOn = (choice, defaultOn) => sandbox.C8O.assistantWriteConfirm.isOn({ readChoice: () => choice, defaultOn: () => defaultOn });
  assert.equal(isOn(null, true), true, 'never chose: the server default');
  assert.equal(isOn(null, false), false);
  assert.equal(isOn({ on: false }, true), false, 'the user\'s own choice wins');
  assert.equal(isOn({ on: true }, false), true);
});
