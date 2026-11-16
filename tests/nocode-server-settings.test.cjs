// The No Code agent of a server is set by its administrators for every user (global symbols assistant.nocode.*,
// assistant.feedback.policy, assistant.stack.channel; agents.tool_policy read only), from the Tigo page of the
// C8Oforms administration. node --test tests/nocode-server-settings.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

function fixture({ studio = false, webAdmin = false, admin = false, user = 'alice@example.com', symbols = {}, platformPolicy = '', c8oformsRight = true, tigoRight = true, method = 'POST', origin = 'https://settings.example.test', token = '', sessionToken = '', fetchSite = null, configuredUrl = '', requestUrl = 'https://settings.example.test/convertigo/projects/lib_ConvertigoAssistant/.json', bridgeLevels = { 'mistral-large-4': ['low', 'medium', 'high'], 'glm-5-3': ['low', 'high', 'max'] }, bridgeDown = false, files = new Map() } = {}) {
  const store = new Map(Object.entries(symbols));
  const edits = [];
  const bridgeCalls = [];
  // a file of the workspace: its path, read and written through the helpers of the Assistant
  function File(parent, name) { this.path = (parent && parent.path ? parent.path : String(parent)) + '/' + name; }
  File.prototype.exists = function () { return files.has(this.path); };
  File.prototype.delete = function () { return files.delete(this.path); };
  // what the Bridge offers (agent_settings, cached catalog): the Convertigo agent and its models' levels
  const bridgeSettings = () => ({ ok: true, providers: [{ id: 'convertigo', defaultModel: 'glm-5-3', supports: { reasoning: true },
    models: Object.keys(bridgeLevels).map(id => ({ id, defaultReasoning: bridgeLevels[id][0], reasoningLevels: bridgeLevels[id].map(level => ({ id: level, label: level })) })) }] });
  const uri = value => {
    const u = new URL(value);
    return { getScheme: () => u.protocol.slice(0, -1), getHost: () => u.hostname,
      getPort: () => u.port ? Number(u.port) : -1, getUserInfo: () => u.username || u.password || null,
      getRawPath: () => u.pathname, getRawQuery: () => u.search || null, getRawFragment: () => u.hash || null };
  };
  const sandbox = {
    context: { httpSession: {}, httpServletRequest: {
      getMethod: () => method,
      getHeader: name => name.toLowerCase() === 'origin' ? origin : (name.toLowerCase() === 'x-xsrf-token' ? token : (name.toLowerCase() === 'sec-fetch-site' ? fetchSite : null)),
      getParameter: () => null, getRequestURL: () => requestUrl
    } },
    configuredConvertigoBaseUrl: () => configuredUrl,
    Packages: { com: { twinsoft: { convertigo: { engine: { enums: { SessionAttribute: { xsrfToken: { get: () => sessionToken } } } } } } } },
    MessageDigest: { isEqual: (a, b) => a.length === b.length && require('node:crypto').timingSafeEqual(a, b) },
    trim: value => String(value ?? '').trim(),
    log: { info() {}, warn() {} },
    java: { net: { URI: function (value) { return uri(value); } }, lang: { String: function (value) { return { getBytes: () => Buffer.from(String(value), 'utf8') }; }, System: { getProperty: name => (name === 'convertigo.engine.agents.tool_policy' ? platformPolicy : null) } } },
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
    noCodeAgentRefusal: () => (tigoRight ? null : { ok: false, status: 'failed', error: { code: 'agent_not_allowed', message: 'agent_not_allowed' } }),
    withCallerUserId: options => Object.assign(options || {}, { userId: user }),
    File,
    resolveWorkspaceRoot: () => '/workspace',
    safePathPart: value => String(value),
    normalizeUserKey: value => String(value ?? '').trim().toLowerCase(),
    readJsonFile: file => (files.has(file.path) ? JSON.parse(files.get(file.path)) : null),
    writeJsonFile: (file, value) => { files.set(file.path, JSON.stringify(value)); },
    now: () => 1794850000000,
    agentSettingsForOptions: (options, workspaceRoot, userKey, projectFilter, provider) => {
      bridgeCalls.push({ options: { ...options }, userKey, provider });
      if (bridgeDown) { return { ok: false, status: 'error', error: 'bridge down' }; }
      return bridgeSettings();
    },
    C8O: { assistantAgentBridge: {} }
  };
  const requestHelpers = read('js/agent_bridge_client.js').includes('function noCodeServerSettingsWriteRefusal(')
    ? ['noCodeServerSettingsWriteRefusal', 'noCodeSettingsOrigin'] : [];
  vm.runInNewContext(backendParts([...requestHelpers,'serverSymbolValue', 'noCodeServerChoice', 'readNoCodeServerSettings', 'noCodeServerSettings',
    'isNoCodeAdministrator', 'withNoCodeServerSettings', 'applyNoCodeServerDefaults', 'saveNoCodeServerSettings',
    'keepNoCodeServerValues', 'noCodeAgentChanged', ...['settingsObjectOf', 'noCodeUserReasoningFile', 'noCodeUserReasoning',
      'noCodeServerModelLevels', 'saveNoCodeUserReasoning', 'saveCallerReasoning', 'providerSettings', 'modelSettings']
      .filter(name => read('js/agent_bridge_client.js').includes('function ' + name + '('))],
  ['NOCODE_SERVER_SYMBOLS', 'NOCODE_SERVER_PROVIDERS', 'NOCODE_SERVER_REASONING', 'NOCODE_SERVER_CHOICES']), sandbox);
  // the public entry point is an assignment: run it with the same helpers
  const source = read('js/agent_bridge_client.js');
  const start = source.indexOf('  C8O.assistantAgentBridge.serverSettings = function (options) {');
  const end = source.indexOf('\n  };\n', start) + 5;
  vm.runInNewContext(source.slice(start, end), sandbox);
  return { sandbox, store, edits, user, files, bridgeCalls };
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
  assert.match(source, /host\.defaultOn = function \(\) \{\n\s+if \(studio\) \{\n\s+return false;\n\s+\}\n\s+var server = noCodeServerSettings\(options\);\n\s+return server !== null && server\.writeConfirm === "on";/, 'the No Code default, never the Studio\'s');
  const sandbox = { C8O: {} };
  vm.runInNewContext(read('js/agent_write_confirm.js'), sandbox);
  const isOn = (choice, defaultOn) => sandbox.C8O.assistantWriteConfirm.isOn({ readChoice: () => choice, defaultOn: () => defaultOn });
  assert.equal(isOn(null, true), true, 'never chose: the server default');
  assert.equal(isOn(null, false), false);
  assert.equal(isOn({ on: false }, true), false, 'the user\'s own choice wins');
  assert.equal(isOn({ on: true }, false), true);
});


test('T9: settings save requires POST and a session token or the server origin', () => {
  const save = f => f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { model: 'test-model' } });
  for (const options of [
    { method: 'GET' },
    { origin: 'https://other.example.test' },
    { origin: null },
    { origin: 'null' },
    { origin: 'https://settings.example.test.other.test' },
    { origin: 'https://settings.example.test:444' },
    { origin: 'https://settings.example.test/path' },
    { token: 'wrong', sessionToken: 'expected' },
    { origin: 'https://other.example.test', token: 'Fetch' }
  ]) {
    const f = fixture({ admin: true, ...options });
    assert.equal(save(f).ok, false, JSON.stringify(options));
    assert.equal(f.edits.length, 0);
  }
  for (const options of [
    {},
    { origin: 'https://SETTINGS.example.test:443' },
    { origin: null, token: 'expected', sessionToken: 'expected' },
    { token: 'Fetch' },
    { origin: 'https://public.example.test', requestUrl: 'http://engine:28080/convertigo/', configuredUrl: 'https://public.example.test/convertigo' }
  ]) {
    const f = fixture({ admin: true, ...options });
    assert.equal(save(f).ok, true, JSON.stringify(options));
    assert.equal(f.edits.length, 1);
  }
});

test('T9: the settings-read route stays readable and implicit admin saves use the same guard', () => {
  const f = fixture({ admin: true, method: 'GET', origin: null });
  assert.equal(f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'get' }).ok, true);
  const options = f.sandbox.withNoCodeServerSettings({ userId: 'test-user', provider: 'vibe', savePreferences: 'true' }, true);
  assert.equal(options.noCodeServerSaved.ok, false);
  assert.equal(f.edits.length, 0);
});


test('T9b: an existing session token never substitutes for the server origin', () => {
  const save = options => {
    const f = fixture({ admin: true, token: 'expected', sessionToken: 'expected', ...options });
    const result = f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { model: 'test-model' } });
    return { result, f };
  };
  for (const origin of ['https://other.example.test', 'null', '']) {
    const { result, f } = save({ origin });
    assert.equal(result.ok, false);
    assert.equal(f.edits.length, 0);
  }
  assert.equal(save({ origin: null }).result.ok, true);
  assert.equal(save({ origin: null, token: 'wrong' }).result.ok, false);
  assert.equal(save({ origin: null, token: '' }).result.ok, false);
  assert.equal(save({ origin: null, token: 'Fetch' }).result.ok, false);
});

test('T9c: TLS termination uses the configured public HTTPS origin', () => {
  const save = configuredUrl => fixture({ admin: true, origin: 'https://public.example.test',
    requestUrl: 'http://engine:28080/convertigo/', configuredUrl }).sandbox.C8O.assistantAgentBridge
    .serverSettings({ action: 'save', settings: { model: 'test-model' } });
  assert.equal(save('https://public.example.test/convertigo').ok, true);
  assert.equal(save('http://engine:28080/convertigo').ok, false);
  assert.equal(save('http://public.example.test/convertigo').ok, false);
  assert.equal(save('').ok, false);
});

test('T9d: a token the session never received does not refuse a save from the server origin (test-nocode, 16/11)', () => {
  // The c8o SDK sends the x-xsrf-token its origin keeps in localStorage, which the engine's administration console
  // writes; the engine issues none to a No Code session. Every save of a No Code administrator who had once opened the
  // console in that browser was refused (request_token_required), the Continue of the Agent tab included.
  const save = options => {
    const f = fixture({ admin: true, symbols: { 'assistant.nocode.model': 'glm-5-3' }, ...options });
    return { result: f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'save', settings: { model: 'mistral-large-4' } }), f };
  };
  const stale = save({ token: 'console-token-of-an-ended-session', sessionToken: '' });
  assert.equal(stale.result.ok, true, JSON.stringify(stale.result));
  assert.equal(stale.f.store.get('assistant.nocode.model'), 'mistral-large-4');
  // the Continue of the Agent tab (AgentSettings with savePreferences) goes through the same check
  const page = fixture({ admin: true, token: 'console-token-of-an-ended-session', symbols: { 'assistant.nocode.model': 'glm-5-3' } });
  const options = page.sandbox.withNoCodeServerSettings({ userId: 'alice@example.com', provider: 'convertigo', model: 'mistral-large-4', reasoningEffort: 'medium', savePreferences: 'true' }, true);
  assert.equal(options.noCodeServerSaved.ok, true, JSON.stringify(options.noCodeServerSaved));
  assert.equal(page.store.get('assistant.nocode.model'), 'mistral-large-4');
  assert.equal(page.store.get('assistant.nocode.reasoning'), 'medium');
  // an https server behind a proxy: the engine sees its internal URL, the configured endpoint names the public origin
  const proxied = save({ token: 'console-token-of-an-ended-session', origin: 'https://public.example.test',
    requestUrl: 'http://engine:28080/convertigo/projects/lib_ConvertigoAssistant/.json', configuredUrl: 'https://public.example.test/convertigo' });
  assert.equal(proxied.result.ok, true, JSON.stringify(proxied.result));
  // the browser's own word on a same-origin request changes nothing
  assert.equal(save({ token: 'console-token', fetchSite: 'same-origin' }).result.ok, true);
  // still refused: another origin, another port, no origin, a cross-site request, or a token that differs from the one
  // the session holds
  for (const refused of [
    { token: 'console-token', origin: 'https://other.example.test' },
    { token: 'console-token', origin: 'https://settings.example.test:8443' },
    { token: 'console-token', origin: 'https://public.example.test:8443', requestUrl: 'http://engine:28080/convertigo/projects/lib_ConvertigoAssistant/.json',
      configuredUrl: 'https://public.example.test/convertigo' },
    { token: 'console-token', origin: 'http://public.example.test', requestUrl: 'http://engine:28080/convertigo/projects/lib_ConvertigoAssistant/.json',
      configuredUrl: 'https://public.example.test/convertigo' },
    { token: 'console-token', origin: null },
    { token: 'console-token', fetchSite: 'cross-site' },
    { token: '', fetchSite: 'cross-site' },
    { token: 'issued-to-this-session', sessionToken: 'issued-to-this-session', fetchSite: 'Cross-Site' },
    { token: 'console-token', sessionToken: 'issued-to-this-session' }
  ]) {
    const { result, f } = save(refused);
    assert.equal(result.ok, false, JSON.stringify(refused));
    assert.equal(f.edits.length, 0, JSON.stringify(refused));
  }
});

test('each No Code user chooses their own effort among the levels of the server\'s model', () => {
  const symbols = { 'assistant.nocode.provider': 'convertigo', 'assistant.nocode.model': 'mistral-large-4', 'assistant.nocode.reasoning': 'high' };
  const files = new Map();
  const alice = fixture({ symbols, files });
  const choose = (f, reasoning) => f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'reasoning', settings: JSON.stringify({ reasoning }) });
  const saved = choose(alice, 'Low');
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.userReasoning, 'low');
  assert.deepEqual([...saved.levels], ['low', 'medium', 'high']);
  assert.deepEqual(JSON.parse(files.get('/workspace/agents/nocode/users/alice@example.com/reasoning.json')),
    { provider: 'convertigo', model: 'mistral-large-4', reasoning: 'low', at: 1794850000000 });
  // the levels come from the Bridge's cached catalog, without a runtime check or a catalog refresh
  const call = alice.bridgeCalls[0];
  assert.equal(call.provider, 'convertigo');
  assert.equal(call.options.runtimePresenceOnly, 'true');
  assert.equal(call.options.refreshModelCatalog, 'false');
  assert.equal(call.options.savePreferences, 'false');
  // nothing of the server changes
  assert.equal(alice.edits.length, 0);
  assert.equal(alice.store.get('assistant.nocode.reasoning'), 'high');
  // her turns run on her effort, the agent and the model stay the server's whatever the page sends
  const turn = alice.sandbox.withNoCodeServerSettings({ userId: 'alice@example.com', provider: 'codex', model: 'gpt', reasoningEffort: 'max' });
  assert.equal(turn.provider, 'convertigo');
  assert.equal(turn.model, 'mistral-large-4');
  assert.equal(turn.reasoningEffort, 'low');
  assert.equal(alice.sandbox.keepNoCodeServerValues({ ...turn, reasoningEffort: 'max' }).reasoningEffort, 'low');
  // another user keeps the server's default
  const bob = fixture({ symbols, files, user: 'bob@example.com' });
  assert.equal(bob.sandbox.withNoCodeServerSettings({ userId: 'bob@example.com' }).reasoningEffort, 'high');
  // the settings answer: her effort as her preference, the server's default stays the default
  const answer = alice.sandbox.applyNoCodeServerDefaults({ userId: 'alice@example.com' }, { providers: [] });
  assert.equal(answer.serverSettings.userReasoning, 'low');
  assert.equal(answer.serverSettings.reasoning, 'high');
  assert.equal(answer.preferences.reasoning, 'low');
  assert.equal(answer.defaults.reasoning, 'high');
  // an administrator's screen shows the server's default, their own effort apart
  const admin = fixture({ symbols, files, admin: true });
  const adminAnswer = admin.sandbox.applyNoCodeServerDefaults({ userId: 'alice@example.com', noCodeServerAdministrator: true }, { providers: [] });
  assert.equal(adminAnswer.preferences.reasoning, 'high');
  assert.equal(adminAnswer.serverSettings.userReasoning, 'low');
  // refused outside the levels of the server's model, and for a value that is no level
  for (const wrong of ['max', 'turbo']) {
    const refused = choose(alice, wrong);
    assert.equal(refused.ok, false, wrong);
    assert.equal(refused.error.code, 'invalid_value', wrong);
  }
  assert.equal(JSON.parse(files.get('/workspace/agents/nocode/users/alice@example.com/reasoning.json')).reasoning, 'low', 'kept');
  // the administrators change the model: back on the server's default until she chooses again
  const changed = fixture({ symbols: { ...symbols, 'assistant.nocode.model': 'glm-5-3' }, files });
  assert.equal(changed.sandbox.withNoCodeServerSettings({ userId: 'alice@example.com' }).reasoningEffort, 'high');
  assert.equal(changed.sandbox.applyNoCodeServerDefaults({ userId: 'alice@example.com' }, {}).serverSettings.userReasoning, '');
  assert.equal(choose(changed, 'max').ok, true, 'max is a level of glm-5-3');
  // empty: back on the server's default
  assert.equal(choose(changed, '').ok, true);
  assert.equal(files.has('/workspace/agents/nocode/users/alice@example.com/reasoning.json'), false);
  assert.equal(changed.sandbox.withNoCodeServerSettings({ userId: 'alice@example.com' }).reasoningEffort, 'high');
});

test('the effort of a user: only where the administrators set Tigo, with the right, from the page, with the levels known', () => {
  const symbols = { 'assistant.nocode.model': 'mistral-large-4' };
  const choose = (options, reasoning = 'low') => {
    const f = fixture({ symbols, ...options });
    return { result: f.sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'reasoning', settings: { reasoning } }), f };
  };
  assert.equal(choose({ studio: true }).result.error.code, 'not_managed');
  assert.equal(choose({ c8oformsRight: false }).result.error.code, 'not_managed');
  assert.equal(choose({ tigoRight: false }).result.error.code, 'agent_not_allowed');
  assert.equal(choose({ user: '' }).result.error.code, 'authentication_required');
  assert.equal(choose({ method: 'GET' }).result.error.code, 'post_required');
  assert.equal(choose({ origin: 'https://other.example.test' }).result.error.code, 'request_origin_required');
  const down = choose({ bridgeDown: true });
  assert.equal(down.result.error.code, 'levels_unavailable');
  assert.equal(down.f.files.size, 0);
  assert.equal(fixture({ symbols }).sandbox.C8O.assistantAgentBridge.serverSettings({ action: 'reasoning', settings: 'not json' }).error.code, 'invalid_value');
  // a server model the Bridge's catalog does not list: no levels of another model stand for it
  const unknown = choose({ symbols: { 'assistant.nocode.model': 'retired-model' } });
  assert.equal(unknown.result.error.code, 'levels_unavailable');
  assert.equal(unknown.f.files.size, 0);
  assert.equal(choose({ symbols }).f.bridgeCalls[0].options.settingsTimeoutMs, '20000', 'within the 30 s of the sequence');
  // the server's model left to the agent's default: the levels of that default model
  const byDefault = choose({ symbols: {} }, 'max');
  assert.equal(byDefault.result.ok, true, JSON.stringify(byDefault.result));
  assert.equal(JSON.parse(byDefault.f.files.get('/workspace/agents/nocode/users/alice@example.com/reasoning.json')).model, '');
});
