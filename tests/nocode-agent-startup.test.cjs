// Run after Mobile Builder dependencies are installed:
// node --test tests/nocode-agent-startup.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, '_private/ionic/node_modules/typescript'));
const yaml = fs.readFileSync(path.join(root, '_c8oProject/mobilePages/Page.yaml'), 'utf8');
const start = yaml.indexOf("'/*Begin_c8o_PageImport*/");
const end = yaml.indexOf('\nsegment:', start);
const content = yaml.slice(start, end).trim().slice(1, -1).replace(/''/g, "'");
const functions = content.slice(content.indexOf('/*Begin_c8o_PageFunction*/'));
const ast = ts.createSourceFile('probe.ts', 'class Probe {\n' + functions + '\n}', ts.ScriptTarget.Latest, true);
const selected = new Set(['isEmbeddedNoCodeAgent', 'isAgentEnvironmentCheckPending',
  'scheduleAgentSettingsRefreshAfterHostContext', 'refreshAgentSettingsAfterHostContext']);
const methods = ast.statements[0].members.filter(m => m.name && selected.has(m.name.getText(ast)));
assert.equal(methods.length, selected.size);
const code = ts.transpileModule('class Probe {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Probe = Probe;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('UI bean values do not contain accidentally nested mode prefixes', () => {
  assert.doesNotMatch(yaml, /plain:(?:plain|script):/);
});

test('Forms focus uses successful structured results, including newly created forms', () => {
  const source = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  const backend = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['noCodeConversationContext', 'isSuccessfulToolStatus', 'isNoCodeFormMutationTool', 'noCodeFormToolResult', 'markSuccessfulNoCodeFormMutation']);
  const snippets = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) snippets.push(node.getText(backend));
    ts.forEachChild(node, visit);
  }
  visit(backend);
  assert.equal(snippets.length, names.size);
  const ctx = {
    trim: value => String(value ?? '').trim(), now: () => 100,
    eventToolStatus: data => data.status, eventToolTitle: (_, data) => data.toolName,
    normalizedToolTitle: (_, __, title) => title, toolNameFromData: data => data.toolName,
    toolCallId: data => data.callId || ''
  };
  vm.runInNewContext(snippets.join('\n'), ctx);
  const state = { hostFormContext: { formId: 'old', elementId: 'old-field' } };
  const saved = { status: 'ok', saved: true, form: { _id: 'new', name: 'Suivi client', _rev: '1-a' } };
  const completed = (toolName, result) => ctx.markSuccessfulNoCodeFormMutation(state, {}, { status: 'completed', toolName, result }, 'tool/update');
  completed('convertigo.nocode-form-create', { Ok: { content: [{ type: 'text', text: JSON.stringify(saved) }] } });
  assert.equal(state.formMutation.formId, 'new');
  assert.equal(state.formMutation.elementId, '');
  assert.equal(state.formMutation.changed, true);
  completed('nocode-form-get', { structuredContent: { ...saved, saved: false, fetched: true } });
  assert.equal(state.formMutation.changed, true);
  completed('nocode-form-get', { structuredContent: { status: 'ok', fetched: true, form: { _id: 'other' } } });
  assert.equal(state.formMutation.formId, 'other');
  assert.equal(state.formMutation.changed, false);
  const previous = state.formMutation;
  for (const result of [{ isError: true, structuredContent: saved }, { Err: 'denied' }, { status: 'unavailable', fetched: false }, 'Created form new', { ...saved, saved: false }]) {
    completed('nocode-form-create', result);
    assert.equal(state.formMutation, previous);
  }
  completed('nocode-form-contract-get', saved);
  assert.equal(state.formMutation, previous);
  assert.equal(ctx.noCodeFormToolResult({ item: saved }, 0), null);
});

test('Forms focus is sent while running and not repeated on completion', () => {
  const generated = fs.readFileSync(path.join(root, '_private/ionic/src/app/pages/page/page.ts'), 'utf8');
  const marker = generated.indexOf('// Notify saved forms before the running-state early return.');
  assert.ok(marker > 0);
  const notification = generated.slice(marker, generated.indexOf('var trimText = function', marker));
  assert.doesNotMatch(notification, /isCompleted/);
  assert.equal((generated.match(/var formMutation = /g) || []).length, 1);
  const calls = [];
  const page = {
    local: {}, isEmbeddedInC8Oforms: () => true,
    notifyC8OformsFormUpdated: (mutation, runid) => { calls.push([mutation.formId, runid]); return true; }
  };
  const state = { formMutation: { success: true, formId: 'saved', completedAt: 100 } };
  const poll = (runid, status) => vm.runInNewContext(notification, { page, state, aiData: {}, runid, status });
  poll('run1', 'running');
  assert.equal(calls.length, 1);
  poll('run1', 'running');
  poll('run1', 'completed');
  assert.equal(calls.length, 1);
  state.formMutation = { ...state.formMutation, completedAt: 101 };
  poll('run1', 'running');
  assert.equal(calls.length, 2);
  page.isEmbeddedInC8Oforms = () => false;
  poll('studio', 'completed');
  assert.equal(calls.length, 2);
  page.isEmbeddedInC8Oforms = () => true;
  state.formMutation.success = false;
  poll('run2', 'running');
  assert.equal(calls.length, 2);
});

test('Forms context button has readable light and dark colors', () => {
  const scss = fs.readFileSync(path.join(root, '_private/ionic/src/app/pages/page/page.scss'), 'utf8');
  const styles = scss.slice(scss.indexOf('/* Secondary context action:'));
  assert.match(styles, /:host-context\(\.force-dark\) \.forms-integrated/);
  const rules = [...styles.matchAll(/(?:^|\n)([^{}]+)\{([^}]+)\}/g)];
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  let checked = 0;
  for (const [, selector, declarations] of rules) {
    if (!selector.includes('.agent-new-conversation-button')) continue;
    assert.match(selector, /\.forms-integrated/);
    const properties = Object.fromEntries([...declarations.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/g)].map(m => [m[1], m[2]]));
    for (const suffix of ['', '-hover', '-focused', '-activated']) {
      if (!properties['color' + suffix]) continue;
      const fg = luminance(properties['color' + suffix]);
      const bg = luminance(properties['background' + suffix]);
      assert.ok((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 4.5, selector + suffix);
      checked++;
    }
  }
  assert.equal(checked, 8);
});

test('Forms welcome suggestions follow the selected resource and remain draft prompts', () => {
  const uxNames = new Set(['getFormsUxText', 'getFormsUxSuggestions', 'getFormsContextSummary']);
  const uxMethods = ast.statements[0].members.filter(m => m.name && uxNames.has(m.name.getText(ast)));
  assert.equal(uxMethods.length, uxNames.size);
  const uxCode = ts.transpileModule('class UX {\n' + uxMethods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.UX = UX;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sandbox = {}; vm.runInNewContext(uxCode, sandbox);
  const page = new sandbox.UX();
  page.local = {};
  page.getC8OformsLanguageCode = () => 'fr';
  page.getNoCodeContextTargetLabel = () => page.local.NoCodeSelectedElementName || page.local.NoCodeSelectedFormName || '';
  page.getAgentHostContextObject = () => ({ currentFormId: 'leave', pageName: 'Informations' });
  page.getFormsCatalogContext = value => value;
  assert.equal(page.getFormsUxSuggestions()[0].label, 'Créer une application');
  assert.equal(page.getFormsUxSuggestions().length, 2);
  page.local = { NoCodeSelectedKind: 'element', NoCodeSelectedFormId: 'leave', NoCodeSelectedFormName: 'Congés', NoCodeSelectedElementName: 'Date de début' };
  assert.equal(page.getFormsContextSummary(), 'Congés · Informations · Date de début');
  assert.equal(page.getFormsUxSuggestions().length, 3);
  assert.ok(page.getFormsUxSuggestions()[2].question.includes('Date de début'));
  page.local.NoCodeSelectedFormId = 'other';
  assert.equal(page.getFormsContextSummary(), 'Congés · Date de début');
  for (const locale of ['fr', 'en', 'es', 'it']) {
    page.getC8OformsLanguageCode = () => locale;
    for (const suggestion of page.getFormsUxSuggestions()) {
      assert.ok(suggestion.label.length > 3);
      assert.ok(suggestion.question.length > 10);
      assert.deepEqual(Object.keys(suggestion).sort(), ['icon', 'label', 'question']);
    }
  }
  const footer = fs.readFileSync(path.join(root, '_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml'), 'utf8');
  assert.match(footer, /setSuggestion\(question\)\s*\{\s*this\.setQuestionText\(question, true\);\s*\}/);
});

test('NoCode uses the deployed bridge library and surfaces engine errors; Studio defaults remain unchanged', () => {
  const source = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  const backend = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['defaultBridgeUrl', 'normalizeSkillProfile', 'bridgeCall']);
  const snippets = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) snippets.push(node.getText(backend));
    ts.forEachChild(node, visit);
  }
  visit(backend);
  assert.equal(snippets.length, names.size);
  const calls = [];
  let response = { result: { ok: true, providers: [] } };
  const context = {
    DEFAULT_BRIDGE_PROJECT: 'ConvertigoAgentBridge',
    engineConvertigoBaseUrl: () => 'https://engine/convertigo/',
    trim: value => String(value ?? '').trim(),
    shouldAttachNoCodeMcpTokenHandle: () => false,
    postForm: (...args) => { calls.push(args); return response; }
  };
  vm.runInNewContext(snippets.join('\n'), context);
  assert.equal(context.defaultBridgeUrl({ skillProfile: 'nocode' }), 'https://engine/convertigo/projects/lib_ConvertigoAgentBridge/.json');
  assert.equal(context.defaultBridgeUrl({ skillProfile: 'generalist' }), 'https://engine/convertigo/projects/ConvertigoAgentBridge/.json');
  context.bridgeCall({ skillProfile: 'nocode', bridgeBaseUrl: 'https://custom/bridge' }, 'agent_settings', {});
  assert.equal(calls[0][0], 'https://custom/bridge');
  response = { document: { error: { message: 'Project missing' } } };
  assert.throws(() => context.bridgeCall({ skillProfile: 'nocode' }, 'agent_settings', {}), /Project missing/);
  assert.equal(context.bridgeCall({ skillProfile: 'generalist' }, 'agent_settings', {}), response);
});

function fixture({ embedded = true, profile = 'nocode', localBridge = false, user = 'test-user', response, request } = {}) {
  const timers = new Map(), calls = [];
  let id = 0, ticks = 0;
  const context = { Promise, setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(code, context);
  const page = new context.Probe();
  Object.assign(page, {
    local: {}, global: { projectName: 'UnrelatedStudioProject' },
    isEmbeddedInC8Oforms: () => embedded, getAgentSkillProfile: () => profile,
    isAgentBridgeMode: () => true, hasLocalAgentBridgeCapability: () => localBridge,
    hasAgentSettingsProvidersLoaded: () => !!page.local.AgentSettings?.providers?.length,
    setAgentEnvironmentCheckDomState: () => {}, getAgentHostContextObject: () => ({}),
    getAgentContextUserId: () => user, getAgentHomeScope: () => 'user',
    getEffectiveProjectName: () => '', getC8OformsText: key => key,
    normalizeAgentProviderValue: value => String(value || '').toLowerCase(),
    isAgentProviderReady: p => p.runtime?.installed === true,
    tick: () => ticks++, setEnableChat: () => {}, syncFooterPlaceholder: () => {},
    c8o: { log: { warn: () => {} }, callJsonObject: (name, payload) => {
      calls.push({ name, payload }); return { async: () => request ? request() : Promise.resolve(response) };
    } }
  });
  return { page, calls, timers, ticks: () => ticks, fire: delay => {
    for (const [key, timer] of [...timers]) if (timer.delay === delay) { timers.delete(key); timer.fn(); }
  } };
}
const ready = { result: { ok: true, settings: { providers: [{ id: 'codex', models: [], runtime: { installed: true } }] } } };

test('embedded NoCode loads server settings without Studio capability or project', async () => {
  const f = fixture({ response: ready });
  f.page.scheduleAgentSettingsRefreshAfterHostContext();
  assert.equal(f.page.isAgentEnvironmentCheckPending(), true);
  f.fire(80); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.agentProfile, 'nocode');
  assert.equal(f.calls[0].payload.projectName, '');
  assert.equal(f.calls[0].payload.runtimePresenceOnly, true);
  assert.equal(f.calls[0].payload.checkUpdates, false);
  assert.equal(f.page.local.AgentProvider, 'codex');
  assert.equal(f.page.isAgentEnvironmentCheckPending(), false);
  assert.equal(f.timers.size, 0);
});

test('NoCode timeout exits loading and ignores a late response', async () => {
  let complete;
  const f = fixture({ request: () => new Promise(resolve => { complete = resolve; }) });
  f.page.refreshAgentSettingsAfterHostContext();
  f.fire(15000); await flush();
  assert.equal(f.page.local.AgentSettingsRefreshRunning, false);
  assert.equal(f.page.local.AgentSettingsRefreshDone, true);
  assert.equal(f.page.local.ShowAgentConfigPanel, true);
  assert.match(f.page.local.AgentRuntimeStatusText, /agentCheckTimeout/);
  assert.equal(f.page.isAgentEnvironmentCheckPending(), false);
  complete(ready); await flush();
  assert.equal(f.page.local.AgentSettings, undefined);
  assert.ok(f.ticks() > 0);
});

test('NoCode errors and empty settings settle with a visible error', async () => {
  for (const response of [{}, { result: { ok: false } }, { result: { settings: { providers: [] } } }]) {
    const f = fixture({ response });
    f.page.refreshAgentSettingsAfterHostContext(); await flush();
    assert.equal(f.page.local.AgentSettingsRefreshDone, true);
    assert.equal(f.page.local.ShowAgentConfigPanel, true);
    assert.match(f.page.local.AgentRuntimeStatusText, /agentCheckFailed/);
    assert.equal(f.timers.size, 0);
  }
});

test('missing NoCode user does not query scoped server settings', async () => {
  const f = fixture({ user: 'nocode-anonymous' });
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.page.isAgentEnvironmentCheckPending(), false);
  assert.match(f.page.local.AgentRuntimeStatusText, /agentCheckUserMissing/);
});

test('NoCode retries are explicit and do not loop on host-context updates', async () => {
  const f = fixture({ response: {} });
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  f.page.scheduleAgentSettingsRefreshAfterHostContext();
  assert.equal(f.timers.size, 0);
  f.page.refreshAgentSettingsAfterHostContext(true); await flush();
  assert.equal(f.calls.length, 2);
});

test('Studio still requires local capability, without a NoCode timeout', async () => {
  for (const embedded of [false, true]) {
    const f = fixture({ embedded, profile: 'generalist' });
    f.page.scheduleAgentSettingsRefreshAfterHostContext();
    f.page.refreshAgentSettingsAfterHostContext();
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture({ embedded: false, profile: 'generalist', localBridge: true, response: ready });
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.__context, 'byside');
  assert.equal(f.calls[0].payload.projectName, 'UnrelatedStudioProject');
  assert.equal(f.page.local.AgentProvider, 'codex');
  assert.equal(f.timers.size, 0);
});
