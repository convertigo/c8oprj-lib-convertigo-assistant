// Choosing a default model in No Code Studio's settings (test-nocode, 29/10, mistral-large-4). The settings page's full
// check took 21-24 s there (Vibe model discovery, update checks) and the panel gave it 15 s: a user who closed the page
// meanwhile got it back at the timeout, without composer, and the gear reopened it with a new check, endlessly. Continue
// stayed disabled while the check ran, and the saved model lost to the gateway default (glm-5-3): the start check kept
// the first model of the list, the conversation router and its prewarm took the provider's default model.
// node --test tests/nocode-settings-default-model.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, formattedBlocks, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const yaml = read('_c8oProject/mobilePages/Page.yaml');
const source = pageClass();
const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
function pageMethods(names) {
  const methods = ast.statements[0].members.filter(m => m.name && names.includes(m.name.getText(ast)));
  assert.equal(methods.length, names.length);
  const code = ts.transpileModule('class Probe {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Probe = Probe;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;
  return code;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const clean = value => String(value ?? '').trim();

const MODELS = [
  { id: 'glm-5-3', defaultReasoning: 'high', reasoningLevels: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] },
  { id: 'glm-5-2', defaultReasoning: 'high', reasoningLevels: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'max' }] },
  { id: 'mistral-large-4', defaultReasoning: 'high', reasoningLevels: [{ id: 'high' }] }
];
function settings(saved) {
  const preferences = saved ? { confirmed: true, provider: 'convertigo', model: saved.model, reasoning: saved.reasoning } : null;
  return {
    ok: true,
    defaults: saved ? { provider: 'convertigo', model: saved.model, reasoning: saved.reasoning } : { provider: 'convertigo', model: 'glm-5-3', reasoning: 'high' },
    preferences,
    providers: [{ id: 'convertigo', ready: true, defaultModel: 'glm-5-3', models: MODELS, supports: { reasoning: true }, runtime: { installed: true } }]
  };
}
const answer = saved => ({ result: { ok: true, settings: settings(saved) } });

const PANEL = ['isEmbeddedNoCodeAgent', 'refreshAgentSettingsAfterHostContext', 'openAgentSettingsPage', 'closeAgentSettingsPage',
  'toggleAgentSettingsPage', 'resolveAgentReasoning'];
const panelCode = pageMethods(PANEL);

function panel() {
  const timers = new Map(), calls = [], pending = [];
  let id = 0;
  const context = { Promise, Date, Number, setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimeout: key => timers.delete(key) };
  vm.runInNewContext(panelCode, context);
  const page = new context.Probe();
  Object.assign(page, {
    local: {}, global: {},
    isEmbeddedInC8Oforms: () => true, getAgentSkillProfile: () => 'nocode', isAgentBridgeMode: () => true,
    hasLocalAgentBridgeCapability: () => false,
    hasAgentSettingsProvidersLoaded: () => !!page.local.AgentSettings?.providers?.length,
    getAgentSettingsRoot: () => page.local.AgentSettings || {},
    getAgentContextUserId: () => 'testuser', getAgentHomeScope: () => 'user', getEffectiveProjectName: () => '',
    getC8OformsText: key => key === 'agentCheckTimeout' ? 'timed out after {seconds} seconds' : key,
    normalizeAgentProviderValue: value => clean(value).toLowerCase(),
    isAgentProviderReady: p => p.ready === true,
    requestTigoResources() {}, setAgentSettingsUrlState() {}, requestAgentHostContext() {}, refreshAgentStackRelease() {},
    requestAgentQuota() {}, setEnableChat() {}, syncFooterPlaceholder() {}, tick() {},
    c8o: { log: { warn() {} }, callJsonObject: (name, payload) => {
      calls.push(payload);
      return { async: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
    } }
  });
  return {
    page, calls, pending, timers,
    timeouts: () => [...timers.values()].map(t => t.delay).filter(delay => delay >= 1000),
    fireTimeouts: () => { for (const [key, timer] of [...timers]) if (timer.delay >= 1000) { timers.delete(key); timer.fn(); } }
  };
}
async function loaded(saved, selection) {
  const f = panel();
  f.page.local.AgentSettings = settings(saved);
  f.page.local.AgentSettingsRefreshDone = true;
  Object.assign(f.page.local, { AgentProvider: 'convertigo', AgentModels: MODELS, AgentProviderSupportsReasoning: true, AgentProviderChoiceConfirmed: true }, selection);
  return f;
}

test('the start check applies the saved default model while nothing is selected yet', async () => {
  const f = panel();
  f.page.refreshAgentSettingsAfterHostContext();
  assert.equal(f.page.local.AgentRuntimeLoading, true, 'the start check marks the loading itself');
  assert.deepEqual(f.timeouts(), [15000]);
  f.pending[0].resolve(answer({ model: 'mistral-large-4', reasoning: 'high' })); await flush();
  assert.equal(f.page.local.AgentModel, 'mistral-large-4', 'not the first model of the list');
  assert.equal(f.page.local.AgentReasoningEffort, 'high');
});

test('a settings page closed before its check answers stays closed, with the choice made there', async () => {
  const f = await loaded({ model: 'glm-5-3', reasoning: 'high' }, { AgentModel: 'glm-5-3', AgentReasoningEffort: 'high' });
  f.page.toggleAgentSettingsPage();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].checkUpdates, true, 'the full check of the settings page');
  const limits = f.timeouts();
  f.page.local.AgentModel = 'mistral-large-4';
  f.page.toggleAgentSettingsPage();
  assert.equal(f.page.local.ShowAgentConfigPanel, false);
  f.fireTimeouts(); await flush();
  assert.equal(f.page.local.ShowAgentConfigPanel, false, 'the timeout does not reopen the page over the composer');
  assert.equal(f.page.local.AgentRuntimeError, '');
  assert.equal(f.page.local.AgentRuntimeLoading, false);
  assert.equal(f.page.local.AgentSettingsRefreshRunning, false);
  assert.equal(f.page.local.AgentModel, 'mistral-large-4');
  f.pending[0].resolve(answer({ model: 'glm-5-3', reasoning: 'high' })); await flush();
  assert.equal(f.page.local.AgentModel, 'mistral-large-4');
  assert.equal(f.calls.length, 1, 'the gear did not start another check');
  assert.deepEqual(limits, [60000], 'the time the Bridge needs to rediscover models and updates');
});

test('a late answer does not replace the choice confirmed with Continue', async () => {
  const f = await loaded({ model: 'glm-5-3', reasoning: 'high' }, { AgentModel: 'glm-5-3', AgentReasoningEffort: 'high' });
  f.page.openAgentSettingsPage();
  f.page.local.AgentModel = 'mistral-large-4';
  f.page.local.AgentSettings = settings({ model: 'mistral-large-4', reasoning: 'high' }); // Continue's own save answers
  f.page.closeAgentSettingsPage();
  f.pending[0].resolve(answer({ model: 'glm-5-3', reasoning: 'high' })); await flush();
  assert.equal(f.page.local.AgentModel, 'mistral-large-4');
  assert.equal(f.page.local.AgentSettings.preferences.model, 'mistral-large-4');
  assert.notEqual(f.page.local.ShowAgentConfigPanel, true);
});

test('a settings page reopened meanwhile gets a check of its own', async () => {
  const f = await loaded(null, { AgentModel: 'glm-5-3', AgentReasoningEffort: 'high' });
  f.page.openAgentSettingsPage();
  f.page.closeAgentSettingsPage();
  f.page.openAgentSettingsPage();
  assert.equal(f.calls.length, 1, 'one check at a time');
  f.pending[0].resolve(answer(null)); await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.page.local.ShowAgentConfigPanel, true);
  assert.equal(f.page.local.AgentRuntimeLoading, true);
  f.pending[1].resolve(answer(null)); await flush();
  assert.equal(f.page.local.AgentRuntimeLoading, false);
  assert.equal(f.page.local.ShowAgentConfigPanel, true, 'still open: the user did not close it');
});

test('a full check answering while the page is open keeps the model picked during the check', async () => {
  const f = await loaded({ model: 'glm-5-3', reasoning: 'max' }, { AgentModel: 'glm-5-3', AgentReasoningEffort: 'max' });
  f.page.openAgentSettingsPage();
  f.page.local.AgentModel = 'mistral-large-4';
  f.page.local.AgentReasoningEffort = 'high';
  f.pending[0].resolve(answer({ model: 'glm-5-3', reasoning: 'max' })); await flush();
  assert.equal(f.page.local.AgentModel, 'mistral-large-4');
  assert.equal(f.page.local.AgentReasoningEffort, 'high');
  assert.equal(f.page.local.AgentRuntimeError, '');
  assert.equal(f.page.local.AgentRuntimeLoading, false);
});

test('the timeout text names the limit that applied', () => {
  for (const text of ['délai de {seconds} secondes', 'after {seconds} seconds', 'los {seconds} segundos', 'i {seconds} secondi']) {
    assert.ok(yaml.includes(text), text);
  }
  assert.doesNotMatch(yaml, /agentCheckTimeout: "[^"]*\b15\b/);
});

test('Continue saves a choice while the page only refreshes settings already loaded', () => {
  const line = yaml.split('\n').find(l => l.includes('"Disabled": "script:') && l.includes('this.hasReadyAgentProvider(this.local.AgentProvider)'));
  const expression = /"Disabled": "script:(.*)",$/.exec(line.trim())[1];
  const disabled = local => new Function('return ' + expression).call({
    local, hasAgentSettingsProvidersLoaded: () => !!local.AgentSettings, hasReadyAgentProvider: () => local.ready !== false
  });
  const base = { AgentProvider: 'convertigo', AgentModel: 'mistral-large-4', AgentSettings: {} };
  assert.equal(disabled({ ...base }), false);
  assert.equal(disabled({ ...base, AgentRuntimeLoading: true, AgentSettingsRefreshRunning: true }), false, 'background refresh');
  assert.equal(disabled({ ...base, AgentRuntimeLoading: true }), true, 'login or install running');
  assert.equal(disabled({ ...base, AgentRuntimeLoading: true, AgentSettingsRefreshRunning: true, AgentRuntimeOperation: 'update' }), true);
  assert.equal(disabled({ ...base, AgentSettings: null, AgentRuntimeLoading: true, AgentSettingsRefreshRunning: true }), true, 'first check');
  assert.equal(disabled({ ...base, ready: false }), true);
});

test('choosing an agent takes its saved default model and reasoning first', () => {
  const blocks = formattedBlocks('_c8oProject/mobilePages/Page.yaml').filter(code => code.includes('page.local.AgentProviderSelectionPending = true;') && /^\s*var provider = '\w+';/.test(code));
  assert.equal(blocks.length, 4);
  for (const code of blocks) {
    const provider = /var provider = '(\w+)';/.exec(code)[1];
    const run = saved => {
      const local = { AgentReasoningEffort: '' };
      const settingsRoot = { defaults: saved ? { provider, model: 'mistral-large-4', reasoning: 'high' } : { provider: 'other', model: 'x' },
        providers: [{ id: provider, defaultModel: 'glm-5-3', models: MODELS, supports: { reasoning: true } }] };
      local.AgentSettings = settingsRoot;
      const page = { local, tick() {}, resolveAgentReasoning: candidates => candidates.find(value => clean(value).length) || '' };
      new Function('page', 'props', 'resolve', code)(page, {}, () => {});
      return [local.AgentModel, local.AgentReasoningEffort];
    };
    assert.deepEqual(run(true), ['mistral-large-4', 'high'], provider);
    assert.deepEqual(run(false), ['glm-5-3', 'high'], provider);
  }
});

test('the default model of a provider is the saved one when it offers it', () => {
  const f = vm.runInNewContext(pageMethods(['getDefaultAgentModel']) + '; new Probe()', {});
  const run = (defaults, models = MODELS) => Object.assign(f, {
    normalizeAgentProviderValue: value => clean(value).toLowerCase(), getAgentProvider: () => 'convertigo',
    cleanProjectName: clean, getAgentSettingsRoot: () => ({ defaults }),
    getAgentProviderDescriptor: () => ({ id: 'convertigo', defaultModel: 'glm-5-3' }),
    getAgentModelOptions: () => models.map(m => ({ id: m.id, label: m.id }))
  }).getDefaultAgentModel('convertigo');
  assert.equal(run({ provider: 'convertigo', model: 'mistral-large-4' }), 'mistral-large-4');
  assert.equal(run({ provider: 'convertigo', model: 'retired-model' }), 'glm-5-3');
  assert.equal(run({ provider: 'codex', model: 'mistral-large-4' }), 'glm-5-3');
});

test('the conversation router and its prewarm start on the saved default model', () => {
  const sandbox = {
    trim: clean,
    normalizeProvider: value => clean(value).toLowerCase() || 'vibe',
    normalizeProviderSelector: value => clean(value).toLowerCase() || 'all'
  };
  vm.runInNewContext(backendParts(['providerSettings', 'modelSettings', 'defaultModelForProvider', 'applyAgentSettingsDefaults']), sandbox);
  const run = (saved, options = {}) => {
    const resolved = sandbox.applyAgentSettingsDefaults(options, settings(saved), 'all');
    return [resolved.model, resolved.reasoningEffort, options.model];
  };
  assert.deepEqual(run({ model: 'mistral-large-4', reasoning: 'high' }), ['mistral-large-4', 'high', 'mistral-large-4']);
  assert.deepEqual(run({ model: 'glm-5-2', reasoning: 'low' }), ['glm-5-2', 'low', 'glm-5-2']);
  assert.deepEqual(run(null), ['glm-5-3', 'high', 'glm-5-3']);
  assert.deepEqual(run({ model: 'retired-model', reasoning: 'max' }), ['glm-5-3', 'high', 'glm-5-3'], 'a model the gateway no longer offers');
  assert.deepEqual(run({ model: 'mistral-large-4', reasoning: 'high' }, { model: 'glm-5-2' }), ['glm-5-2', 'high', 'glm-5-2'], 'an explicit model wins');
});
