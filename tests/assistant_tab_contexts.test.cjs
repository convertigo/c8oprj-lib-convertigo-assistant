// In a desktop Studio the engine runs every request without a "studio_" context name in ONE context per sequence, shared
// by every browser and locked for the whole request (up to 24 h): one stuck request froze a panel function everywhere
// until the Studio restarted (17-18/11). Each tab now names its own contexts; a send that fails or does not answer
// leaves the panel ready.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');

const names = ['tigoTabContextId', 'rotateTigoCallContext', 'tigoReadContext', 'isTigoStudioContextSurface', 'tigoCallContext',
  'installTigoCallContexts', 'recoverFailedTigoSend', 'withTigoSendTimeout'];
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const methods = ast.statements[0].members.filter((m) => m.name && names.includes(m.name.getText(ast)));
assert.equal(methods.length, names.length);
const code = ts.transpileModule('class Page { ' + methods.map((m) => m.getText(ast)).join('\n') + ' }; this.Page = Page;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const page = fs.readFileSync(path.join(__dirname, '../_c8oProject/mobilePages/Page.yaml'), 'utf8');

function storage(values = {}) {
  return { getItem: (k) => (k in values ? values[k] : null), setItem: (k, v) => { values[k] = String(v); }, values };
}
function load(sessionStorage, timers) {
  const sandbox = { window: { sessionStorage }, setTimeout: timers ? (fn, ms) => { timers.push({ fn, ms }); return timers.length; } : setTimeout, clearTimeout: () => {}, Promise };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}
function make(sessionStorage, surface = 'studio', timers) {
  const sandbox = load(sessionStorage, timers);
  const p = new sandbox.Page();
  Object.assign(p, {
    local: {},
    tick() {},
    t: (key, fallback) => fallback,
    isEmbeddedNoCodeAgent: () => surface === 'nocode',
    isServerAgentSurface: () => surface === 'server' || surface === 'nocode',
  });
  return { page: p, window: sandbox.window };
}

test('a tab keeps its context name across reloads and gets a new one when a call does not answer', () => {
  const store = storage();
  const first = make(store).page.tigoTabContextId();
  assert.match(first, /^[a-z0-9]{6,32}$/);
  const reloaded = make(store).page;
  assert.equal(reloaded.tigoTabContextId(), first, 'a reload of the tab reuses its contexts');
  assert.equal(reloaded.tigoReadContext(), 'studio_tigo_read_' + first);
  const rotated = reloaded.rotateTigoCallContext();
  assert.notEqual(rotated, first);
  assert.equal(store.values['lib_ConvertigoAssistant.tabContextId'], rotated);
  assert.equal(make(store).page.tigoTabContextId(), rotated);
  assert.notEqual(make(storage()).page.tigoTabContextId(), rotated, 'another tab has contexts of its own');
});

test('in a Studio every call of the panel gets a context of its tab and sequence; No Code and server calls are untouched', () => {
  const store = storage({ 'lib_ConvertigoAssistant.tabContextId': 'tab0001' });
  const calls = [];
  const c8o = { callJsonObject(requestable, parameters) { calls.push([requestable, parameters]); return 'ok'; } };
  const { page: p } = make(store);
  p.c8o = c8o;
  p.installTigoCallContexts();
  p.installTigoCallContexts();
  assert.equal(c8o.callJsonObject('lib_ConvertigoAssistant.AgentResources', { request: '{}' }), 'ok');
  c8o.callJsonObject('lib_ConvertigoAssistant.AgentSendMessageRouter#marker', {});
  c8o.callJsonObject('lib_ConvertigoAssistant.AgentSettings', { __context: 'byside' });
  c8o.callJsonObject('lib_ConvertigoAssistant.AgentSettings', { __context: 'studio_assistant_settings_check' });
  c8o.callJsonObject('lib_ConvertigoAssistant.AgentReadResponseRouter', { __context: 'studio_tigo_read_tab0001' });
  c8o.callJsonObject('lib_ConvertigoAgentBridge.agent_session_metrics', {});
  c8o.callJsonObject('C8Oforms.APIV2_FormsList', {});
  assert.deepEqual(calls.map((c) => c[1] && c[1].__context), [
    'studio_tigo_tab0001_AgentResources',
    'studio_tigo_tab0001_AgentSendMessageRouter',
    'studio_tigo_tab0001_AgentSettings',
    'studio_tigo_tab0001_AgentSettings_assistant_settings_check',
    'studio_tigo_read_tab0001',
    'studio_tigo_tab0001_agent_session_metrics',
    undefined,
  ]);
  assert.equal(calls.length, 7, 'installed once: one call per call');

  for (const surface of ['nocode', 'server']) {
    const seen = [];
    const other = { callJsonObject(requestable, parameters) { seen.push(parameters); } };
    const { page: q } = make(storage(), surface);
    q.c8o = other;
    q.installTigoCallContexts();
    other.callJsonObject('lib_ConvertigoAssistant.AgentResources', { request: '{}' });
    other.callJsonObject('lib_ConvertigoAssistant.AgentSettings', { __context: 'agent_nocode_settings' });
    assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ request: '{}' }, { __context: 'agent_nocode_settings' }], surface + ' keeps its contexts');
  }
});

test('a send that fails leaves the panel ready, the thinking bubble explained and the draft back', () => {
  const { page: p } = make(storage());
  let composer = '';
  p.chatfooter = { getQuestionText: () => composer, setQuestionText: (text) => { composer = text; } };
  p.local = {
    IsProcessing: true, SendPending: true, spinner: true, LastSentQuestion: 'Crée une page',
    AgentOperationError: 'Le serveur n’a pas répondu à l’envoi en 5 minutes.',
    Messages: [{ type: 'user', msg: 'Crée une page' }, { type: 'assistant', msg: '', writing: true, status: 'En réflexion' }],
    StreamingIndex: 1,
  };
  p.recoverFailedTigoSend();
  assert.deepEqual([p.local.IsProcessing, p.local.SendPending, p.local.spinner, p.local.StreamingIndex], [false, false, false, null]);
  assert.deepEqual([p.local.Messages[1].writing, p.local.Messages[1].status, p.local.Messages[1].msg], [false, '', 'Le serveur n’a pas répondu à l’envoi en 5 minutes.']);
  assert.equal(composer, 'Crée une page');
  assert.equal(p.local.Question, 'Crée une page', 'the two-way bound question holds the draft, or the next tick empties the composer');
  composer = 'Un autre texte';
  p.local.Question = '';
  p.local.IsProcessing = true;
  p.recoverFailedTigoSend();
  assert.equal(composer, 'Un autre texte', 'what the user typed meanwhile is kept');
});

test('the send call alone is bounded to 5 minutes: past it the panel stops waiting and changes its contexts', async () => {
  const store = storage({ 'lib_ConvertigoAssistant.tabContextId': 'tab0001' });
  const timers = [];
  const { page: p } = make(store, 'studio', timers);
  const fast = await p.withTigoSendTimeout(Promise.resolve('queued'));
  assert.equal(fast, 'queued');
  assert.equal(timers[0].ms, 300000);
  const pending = p.withTigoSendTimeout(new Promise(() => {}));
  timers[1].fn();
  await assert.rejects(pending, /agent_send_timeout/);
  assert.notEqual(store.values['lib_ConvertigoAssistant.tabContextId'], 'tab0001');
});

test('the send has a failure path, its timeout and the reads use the tab contexts', () => {
  assert.match(page, /"requestable": "plain:lib_ConvertigoAssistant\.AgentSendMessageRouter",\n\s+"noLoading": "plain:true"\n\s+\}'\n\s+↓Failure \[ngx\.components\.UIActionFailureEvent-1793400000021\]: \n\s+↓RecoverFailedSend[\s\S]{0,900}page\.recoverFailedTigoSend\(\);\n\s+reject\(new Error\("agent_send_failed"\)\);/);
  assert.match(page, /if \(requestable === ''lib_ConvertigoAssistant\.AgentSendMessageRouter'' && page\.withTigoSendTimeout\) \{ task = page\.withTigoSendTimeout\(task\); \}/);
  assert.equal((page.match(/MobileSmartSourceType: script:this\.tigoReadContext\(\)/g) || []).length, 5);
  assert.doesNotMatch(page, /__tigoReadContext'\] \|\|/);
  assert.match(page, /this\.installAgentSessionRecovery\(\);\n\s+this\.installTigoCallContexts\(\);/);
  assert.match(page, /this\.local\.LastSentQuestion = message;/);
});

test('library writes hold a monitor of their own, not the engine', () => {
  const resources = fs.readFileSync(path.join(__dirname, '../js/tigo_resources.js'), 'utf8');
  const lock = resources.slice(resources.indexOf('lock: function (base, fn)'), resources.indexOf('protectProject:'));
  assert.match(lock, /new java\.lang\.String\("lib_ConvertigoAssistant\.tigoResources\.lock"\)\.intern\(\)/);
  assert.doesNotMatch(lock, /E\.theApp/);
});
