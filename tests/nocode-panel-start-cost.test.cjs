// What a start of the No Code panel costs the server. Seen on test-nocode (28/10, five reloads of No Code Studio with the
// panel open on a conversation): the start (AgentCreateConversationRouter) read the full settings, 10 s there (Codex,
// Node and Playwright probed at every opening), and prewarmed a Vibe (17.5 s) although the panel opened again an
// existing conversation; the panel's own check of the agent waited behind them on the shared Bridge context, up to 29 s,
// and its 15-s limit opened the settings.
// node --test tests/nocode-panel-start-cost.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, backendParts, pageClass } = require('./helpers/assistant-source.cjs');

const source = read('js/agent_bridge_client.js');
const pageYaml = read('_c8oProject/mobilePages/Page.yaml');

function bridgeCallSandbox(sessionId) {
  const posts = [];
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    requireBridgeCaller() {}, shouldAttachMcpTokenHandle: () => false, isOwnBridgeUrl: () => false, sendMark() {},
    normalizeSkillProfile: () => 'nocode',
    callerSessionId: () => sessionId,
    defaultBridgeUrl: () => 'http://localhost/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    postForm: (url, payload) => { posts.push(payload); return { result: { ok: true } }; },
    java: { lang: {
      Integer: { toHexString: value => (value >>> 0).toString(16) },
      String: function (text) { this.hashCode = () => { let h = 0; for (const c of String(text)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return h; }; }
    } }
  };
  vm.runInNewContext(backendParts(['bridgeCall']), sandbox);
  return { sandbox, posts };
}

test('the settings are read on a Bridge context of their own, one per caller session', () => {
  const { sandbox, posts } = bridgeCallSandbox('session-A');
  sandbox.bridgeCall({ userId: 'forms-user' }, 'agent_settings', { runtimePresenceOnly: true }, 120000);
  sandbox.bridgeCall({ userId: 'forms-user' }, 'agent_settings', {}, 120000);
  sandbox.bridgeCall({ userId: 'forms-user' }, 'agent_vibe_start', { handle: 'agent-1' }, 90000);
  assert.match(posts[0].__context, /^studio_assistant_settings_[0-9a-f]+$/, 'not the context of the starts and prompts');
  assert.equal(posts[1].__context, posts[0].__context, 'stable for the session: no new engine context per read');
  assert.equal(posts[2].__context, undefined, 'starts, prompts and stops keep the shared context that orders them');
  const other = bridgeCallSandbox('session-B');
  other.sandbox.bridgeCall({ userId: 'forms-user' }, 'agent_settings', {}, 120000);
  assert.notEqual(other.posts[0].__context, posts[0].__context, 'another browser session');
});

function panelStartSandbox(answers, profile = 'nocode') {
  const reads = [];
  const sandbox = {
    Object, trim: value => String(value ?? '').trim(),
    normalizeSkillProfile: () => profile,
    agentSettingsForOptions: options => {
      reads.push({ presence: options.runtimePresenceOnly, checkUpdates: options.checkUpdates });
      return answers[reads.length - 1];
    }
  };
  vm.runInNewContext(backendParts(['panelStartSettings']), sandbox);
  return { sandbox, reads };
}

const READY = { ok: true, providers: [{ id: 'convertigo', status: 'ready', ready: true, models: [{ id: 'glm-5-3' }] },
  { id: 'codex', status: 'authentication_required', ready: false }, { id: 'claude', status: 'missing', ready: false }] };

test('the start of a No Code panel reads the settings present, as its own check does', () => {
  const { sandbox, reads } = panelStartSandbox([READY]);
  const options = { userId: 'forms-user', agentProfile: 'nocode' };
  assert.equal(sandbox.panelStartSettings(options, '/ws', 'key', '', 'all'), READY);
  assert.deepEqual(reads, [{ presence: true, checkUpdates: false }], 'one read, presence only, no update check');
  assert.equal(options.runtimePresenceOnly, undefined, 'the caller\'s options are not changed');
});

test('a model catalog not cached yet is read in full once, at that start', () => {
  const uncached = { ok: true, providers: [{ id: 'convertigo', status: 'configuration_required', ready: false }] };
  const { sandbox, reads } = panelStartSandbox([uncached, READY]);
  assert.equal(sandbox.panelStartSettings({ userId: 'forms-user' }, '/ws', 'key', '', 'all'), READY);
  assert.deepEqual(reads, [{ presence: true, checkUpdates: false }, { presence: undefined, checkUpdates: undefined }]);
});

test('the Studio and an explicit choice of the caller keep their read', () => {
  const studio = panelStartSandbox([READY], 'generalist');
  studio.sandbox.panelStartSettings({ userId: 'studio' }, '/ws', 'studio', '', 'all');
  assert.deepEqual(studio.reads, [{ presence: undefined, checkUpdates: undefined }]);
  const explicit = panelStartSandbox([READY]);
  explicit.sandbox.panelStartSettings({ userId: 'forms-user', runtimePresenceOnly: 'false' }, '/ws', 'key', '', 'all');
  assert.deepEqual(explicit.reads, [{ presence: 'false', checkUpdates: undefined }]);
});

function startSandbox() {
  const events = [];
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    boolValue: (value, fallback) => (value === undefined || value === '' ? fallback : value === true || value === 'true'),
    resolveWorkspaceRoot: () => '/ws', normalizeUserKey: value => 'key:' + value, normalizeProvider: value => value,
    normalizeSkillProfile: () => 'nocode', normalizeThreadId: value => String(value ?? ''),
    latestConversationRecord: () => null, setBuffer() {}, sendMark() {},
    panelStartSettings: () => { events.push('settings'); return READY; },
    agentSettingsForOptions: () => { events.push('full-settings'); return READY; },
    applyAgentSettingsDefaults: () => ({ provider: 'convertigo', model: 'glm-5-3' }),
    prewarmNoCodeConversation: (options, provider) => { events.push('prewarm:' + provider); return null; },
    publicConversations: () => []
  };
  vm.runInNewContext(backendParts(['createConversationSteps']), sandbox);
  return { sandbox, events };
}

test('a panel that opens again the conversation of a reloaded No Code Studio prewarms no Vibe', () => {
  for (const provider of ['', 'convertigo']) {
    const restored = startSandbox();
    const answer = restored.sandbox.createConversationSteps({ userId: 'forms-user', provider, restoreConversation: 'true' });
    assert.equal(answer.ok, true);
    assert.deepEqual(restored.events, ['settings'], 'provider "' + provider + '"');
    const opened = startSandbox();
    opened.sandbox.createConversationSteps({ userId: 'forms-user', provider, restoreConversation: 'false' });
    assert.deepEqual(opened.events, ['settings', 'prewarm:convertigo'], 'a panel the user opens still prewarms');
  }
});

test('the page says to its start when it opens again the conversation of the tab', () => {
  const callSequence = pageYaml.slice(pageYaml.indexOf('"requestable": "plain:lib_ConvertigoAssistant.AgentCreateConversationRouter"'),
    pageYaml.indexOf('↓RefreshFooterLocale [ngx.components.UICustomAction-1772036531069]'));
  assert.match(callSequence, /↓restoreConversation \[ngx\.components\.UIControlVariable-\d+\]: \n {10}varValue: \n[\s\S]*?MobileSmartSourceType: 'script:this\.isRestoringFormsConversation && this\.isRestoringFormsConversation\(\) \? ''true'' : ''false'''/);
  const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
  let method = '';
  (function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'isRestoringFormsConversation') method = node.getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  const context = {};
  vm.runInNewContext(ts.transpileModule('class Page { ' + method + ' } this.Page = Page;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const page = new context.Page();
  assert.equal(page.isRestoringFormsConversation(), false);
  page.formsConversationRestorePending = true;
  assert.equal(page.isRestoringFormsConversation(), true, 'set by restoreFormsConversationAfterReload at the page initialization');
  const sequence = read('_c8oProject/sequences/AgentCreateConversation.yaml');
  assert.match(sequence, /restoreConversation: typeof restoreConversation === "undefined" \? "" : restoreConversation\n {4}\}\);'/);
  assert.match(sequence, /↓restoreConversation \[variables\.RequestableVariable-\d+\]: \n/);
});
