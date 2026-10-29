// Choosing an agent that is not ready in No Code Studio's settings (test-nocode, 29/10, "Mistral - Vibe" for an account
// without a Mistral login). Closed with the gear, the settings came back bare in the start card (agent cards overlapping, a
// check on every card), without composer and without a way back to Convertigo. The runtime section said "Runtime non
// installé" although vibe 3.0.1 was installed: the No Code panel holds only the agent in use until the settings check of the
// page answers (20 s and more there), and an agent it has not read was shown as a runtime to install.
// node --test tests/nocode-agent-not-ready.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, formattedEntries, pageClass } = require('./helpers/assistant-source.cjs');

const PAGE = '_c8oProject/mobilePages/Page.yaml';
const yaml = read(PAGE);
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = ast.statements[0].members.filter(m => m.name);
function pageMethods(names) {
  const methods = members.filter(m => names.includes(m.name.getText(ast)));
  assert.equal(methods.length, names.length);
  return ts.transpileModule('class Probe {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Probe = Probe;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const clean = value => String(value ?? '').trim();

const CONVERTIGO_MODELS = [
  { id: 'glm-5-3', defaultReasoning: 'high', reasoningLevels: [{ id: 'low' }, { id: 'high' }] },
  { id: 'glm-5-2', defaultReasoning: 'high', reasoningLevels: [{ id: 'low' }, { id: 'high' }] }
];
const PROVIDERS = {
  convertigo: { id: 'convertigo', ready: true, status: 'ready', defaultModel: 'glm-5-3', models: CONVERTIGO_MODELS, supports: { reasoning: true },
    runtime: { installed: true, installedVersion: '3.0.1', checked: true }, authentication: { configured: true } },
  vibe: { id: 'vibe', ready: false, status: 'authentication_required', defaultModel: 'mistral-medium-3', models: [{ id: 'mistral-medium-3' }],
    supports: { reasoning: false }, runtime: { installed: true, installedVersion: '3.0.1' }, authentication: { configured: false } },
  codex: { id: 'codex', ready: false, status: 'missing', defaultModel: '', models: [], supports: {}, runtime: { installed: false }, authentication: {} },
  claude: { id: 'claude', ready: false, status: 'missing', defaultModel: '', models: [], supports: {}, runtime: { installed: false }, authentication: {} }
};
// What the No Code conversation router reads at the start of the panel: the agent in use only.
const startSettings = () => ({ ok: true, defaults: { provider: 'convertigo', model: 'glm-5-3', reasoning: 'high' },
  providers: [structuredClone(PROVIDERS.convertigo)] });
// What the settings check of the page reads: every agent.
const fullSettings = (change = {}) => ({ ok: true, defaults: { provider: 'convertigo', model: 'glm-5-3', reasoning: 'high' },
  providers: Object.keys(PROVIDERS).map(id => Object.assign(structuredClone(PROVIDERS[id]), change[id] || {})) });
const answer = settings => ({ result: { ok: true, settings } });

const PANEL = ['isEmbeddedNoCodeAgent', 'refreshAgentSettingsAfterHostContext', 'openAgentSettingsPage', 'closeAgentSettingsPage',
  'toggleAgentSettingsPage', 'resolveAgentReasoning', 'normalizeAgentProviderValue', 'getAgentSettingsRoot', 'isAgentProviderReady',
  'getAgentProviderDescriptor', 'getAgentProviderLabel', 'hasReadyAgentProvider', 'shouldShowAgentSettingsPanel', 'getAgentModelOptions',
  'getDefaultAgentModel', 'isAgentSettingsPageShown', 'getAgentProviderTitle', 'getReadyAgentFallback', 'getAgentNotReadyState',
  'getAgentNotReadyText', 'getAgentBackLabel', 'canConnectSelectedAgent', 'useReadyAgentProvider', 'startAgentProviderCheck'];
const panelCode = pageMethods(PANEL);

function panel(settings = startSettings()) {
  const calls = [], pending = [], storage = new Map();
  const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } };
  const context = { Promise, Date, Number, window, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(panelCode, context);
  const page = new context.Probe();
  Object.assign(page, {
    global: {},
    local: { AgentSettings: settings, AgentSettingsRefreshDone: true, AgentProvider: 'convertigo', AgentModels: CONVERTIGO_MODELS,
      AgentModel: 'glm-5-2', AgentReasoningEffort: 'low', AgentProviderSupportsReasoning: true, AgentReasoningLevels: CONVERTIGO_MODELS[1].reasoningLevels,
      AgentProviderChoiceConfirmed: true, EnableChat: true },
    isEmbeddedInC8Oforms: () => true, getAgentSkillProfile: () => 'nocode', isAgentBridgeMode: () => true,
    isAgentEnvironmentCheckPending: () => false, shouldBlockRemoteStudioAgent: () => false, isFormsRecentHistory: () => false,
    hasLocalAgentBridgeCapability: () => false,
    hasAgentSettingsProvidersLoaded: () => !!page.local.AgentSettings?.providers?.length,
    getAgentProvider: () => page.local.AgentProvider || '',
    getAgentContextUserId: () => 'testuser', getAgentHomeScope: () => 'user', getEffectiveProjectName: () => '',
    getC8OformsText: key => key === 'agentCheckTimeout' ? 'timed out after {seconds} seconds' : key,
    cleanProjectName: clean, t: (key, fallback) => fallback, tigoText: key => key === 'runtime' ? 'Runtime et stack' : key,
    requestTigoResources() {}, setAgentSettingsUrlState() {}, requestAgentHostContext() {}, refreshAgentStackRelease() {},
    requestAgentQuota() {}, setEnableChat() {}, syncFooterPlaceholder() {}, tick() {},
    c8o: { log: { warn() {} }, callJsonObject: (name, payload) => {
      calls.push(payload);
      return { async: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
    } }
  });
  return { page, calls, pending, storage, window };
}

// The actions of an agent card, in their order: the choice, the runtime section, the models.
const entries = formattedEntries(PAGE);
function cardActions(provider) {
  const action = (name, marker) => {
    const found = entries.filter(e => e.context.includes('↓' + name + ' [') && e.code.includes(marker));
    assert.equal(found.length, 1, name + ' ' + provider);
    return found[0].code;
  };
  return [
    action('SetProvider', "var provider = '" + provider + "';"),
    action('SetRuntimeSummary', "=== '" + provider + "') { selected = providers[i]; break; }"),
    action('UseDiscoveredModels', "=== '" + provider + "') { selected = providers[i]; break; }")
  ];
}
function pickCard(f, provider) {
  for (const code of cardActions(provider)) new Function('page', 'props', 'resolve', 'window', code)(f.page, {}, () => {}, f.window);
}

// A class binding of the page template, evaluated as the template does.
function binding(marker, nth = 0) {
  const lines = yaml.split('\n').filter(l => l.includes('MobileSmartSourceType: ') && l.includes(marker));
  const raw = lines[nth].trim().replace(/^- MobileSmartSourceType: /, '');
  const script = (raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw).replace(/^script:/, '');
  return page => new Function('local', 'return (' + script + ');').call(page, page.local);
}
const startCard = binding("'modern-card modern-cta-card agent-start-card agent-config-page'");
const surface = binding("'agent-conversations-panel agent-config-surface'");
const settingsClass = binding("'agent-create-settings agent-config-settings'");
const composer = binding("'modern-footer agent-footer-codex agent-controls-enabled'");

test('settings shown while the chosen agent is not ready keep the settings page look', () => {
  const f = panel(fullSettings());
  Object.assign(f.page.local, { AgentProvider: 'vibe', ShowAgentConfigPanel: false, AgentConfigExplicitOpen: false });
  assert.equal(f.page.shouldShowAgentSettingsPanel(), true, 'shown although the page was closed');
  assert.match(startCard(f.page), /\bagent-config-page\b/);
  assert.match(surface(f.page), /\bagent-config-surface\b/);
  assert.match(settingsClass(f.page), /\bagent-config-settings\b/);
  Object.assign(f.page.local, { AgentProvider: 'convertigo' });
  assert.doesNotMatch(startCard(f.page), /agent-config-page/, 'a ready agent and a closed page: the conversation');
  assert.match(settingsClass(f.page), /agent-hidden/);
  assert.match(composer(f.page), /agent-controls-enabled/);
});

test('an agent the panel has not read yet is checked, not shown as a runtime to install', async () => {
  const f = panel();
  f.page.toggleAgentSettingsPage();
  assert.equal(f.calls.length, 1, 'the check of the opened page');
  pickCard(f, 'vibe');
  assert.equal(f.page.local.AgentProvider, 'vibe');
  assert.notEqual(f.page.local.AgentRuntimeVersionText, 'Runtime non installé');
  assert.notEqual(f.page.local.AgentRuntimeActionText, 'Installer le runtime');
  assert.equal(f.page.local.AgentRuntimeStatusText, 'Vérification de l’environnement...');
  assert.equal(f.calls.length, 1, 'the check already running covers it');
  assert.equal(f.page.getAgentNotReadyText(), 'Vérification de Mistral - Vibe pour votre compte...');
  assert.equal(f.page.getAgentBackLabel(), 'Revenir à Convertigo - Agent intégré');

  f.pending[0].resolve(answer(fullSettings())); await flush();
  assert.equal(f.page.local.AgentProvider, 'vibe', 'the page is still open on the agent picked there');
  assert.equal(f.page.local.AgentRuntimeVersionText, 'Version installée 3.0.1');
  assert.equal(f.page.local.AgentRuntimeActionText, 'Se connecter à Mistral');
  assert.equal(f.page.local.AgentModel, 'mistral-medium-3');
  assert.equal(f.page.getAgentNotReadyState(), 'sign_in');
  assert.equal(f.page.canConnectSelectedAgent(), true);
  assert.equal(f.page.getAgentNotReadyText(), 'Mistral - Vibe n’est pas encore connecté à votre compte : connectez-vous pour l’utiliser. '
    + 'Sinon, revenez à Convertigo - Agent intégré : fermer la configuration y revient aussi.');
});

test('a card picked once the check is over starts a check for an agent the panel has not read', async () => {
  const f = panel();
  f.page.openAgentSettingsPage();
  f.pending[0].resolve(answer(startSettings())); await flush(); // the settings the conversation router left
  assert.equal(f.page.local.AgentSettingsRefreshRunning, false);
  pickCard(f, 'claude');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].checkUpdates, true, 'the full check of the settings page, every agent');
  assert.equal(f.calls[1].provider, '');
  assert.equal(f.page.getAgentNotReadyState(), 'checking');
  f.pending[1].resolve(answer(fullSettings())); await flush();
  assert.equal(f.page.getAgentNotReadyState(), 'install');
  assert.equal(f.page.local.AgentRuntimeActionText, 'Installer le runtime', 'now known: Claude Code is really missing');
  assert.match(f.page.getAgentNotReadyText(), /^Le runtime de Anthropic - Claude Code n’est pas installé : installez-le dans « Runtime et stack »\./);
});

test('closing the settings on an agent that is not ready goes back to the agent in use, with its composer', async () => {
  const f = panel();
  f.page.toggleAgentSettingsPage();
  pickCard(f, 'vibe');
  assert.equal(f.storage.get('lib_ConvertigoAssistant.AgentProvider'), 'vibe');
  f.page.toggleAgentSettingsPage();
  assert.equal(f.page.local.ShowAgentConfigPanel, false);
  assert.equal(f.page.local.AgentProvider, 'convertigo');
  assert.equal(f.page.local.AgentModel, 'glm-5-2', 'the model in use when the settings opened');
  assert.equal(f.page.local.AgentReasoningEffort, 'low');
  assert.equal(f.page.local.AgentModels.length, 2);
  assert.equal(f.storage.get('lib_ConvertigoAssistant.AgentProvider'), 'convertigo');
  assert.equal(f.page.shouldShowAgentSettingsPanel(), false);
  assert.equal(f.page.isAgentSettingsPageShown(), false);
  assert.match(composer(f.page), /agent-controls-enabled/, 'the composer is back');
  f.pending[0].resolve(answer(fullSettings())); await flush();
  assert.equal(f.page.local.AgentProvider, 'convertigo', 'the late check of the closed page changes nothing');
  assert.equal(f.page.local.ShowAgentConfigPanel, false);
});

test('the note under the cards goes back to a ready agent and the page stays open', async () => {
  const f = panel();
  f.page.openAgentSettingsPage();
  f.pending[0].resolve(answer(fullSettings())); await flush();
  pickCard(f, 'vibe');
  assert.equal(f.page.local.AgentRuntimeActionText, 'Se connecter à Mistral');
  assert.equal(f.page.useReadyAgentProvider(), true);
  assert.equal(f.page.local.AgentProvider, 'convertigo');
  assert.equal(f.page.local.AgentModel, 'glm-5-2');
  assert.equal(f.page.local.ShowAgentConfigPanel, true);
  assert.equal(f.page.local.AgentConfigExplicitOpen, true);
  assert.equal(f.page.local.AgentRuntimeProvider, 'convertigo', 'the runtime section describes Convertigo again');
  assert.equal(f.page.local.AgentRuntimeActionText, 'Réinstaller le runtime');
  assert.equal(f.page.local.AgentAuthenticationRequired, false);
  assert.equal(f.page.getAgentNotReadyText(), '');
});

test('with no agent ready, closing keeps the settings page and says so', async () => {
  const f = panel();
  f.page.openAgentSettingsPage();
  f.pending[0].resolve(answer(fullSettings({ convertigo: { ready: false, status: 'authentication_required', authentication: { configured: false } } }))); await flush();
  pickCard(f, 'vibe');
  f.page.closeAgentSettingsPage();
  assert.equal(f.page.local.AgentProvider, 'vibe');
  assert.equal(f.page.isAgentSettingsPageShown(), true);
  assert.match(startCard(f.page), /\bagent-config-page\b/);
  assert.equal(f.page.getAgentBackLabel(), '');
  assert.match(f.page.getAgentNotReadyText(), /Aucun autre agent n’est prêt/);
});

test('an install still running keeps its agent when the settings close', async () => {
  const f = panel();
  f.page.openAgentSettingsPage();
  f.pending[0].resolve(answer(fullSettings())); await flush();
  pickCard(f, 'codex');
  f.page.local.AgentRuntimeInstallProvider = 'codex'; // as the runtime button does until the install ends
  f.page.closeAgentSettingsPage();
  assert.equal(f.page.local.AgentProvider, 'codex');
  assert.match(startCard(f.page), /\bagent-config-page\b/, 'the install progress stays in the settings page');
  f.page.local.AgentRuntimeInstallProvider = '';
  f.page.closeAgentSettingsPage();
  assert.equal(f.page.local.AgentProvider, 'convertigo');
});

test('the runtime button marks the agent it installs until the install ends', () => {
  const found = entries.filter(e => e.context.includes('↓InstallOrUpdateRuntime ['));
  assert.equal(found.length, 1);
  const code = found[0].code;
  assert.equal(code.split('page.local.AgentRuntimeInstallProvider = provider;').length - 1, 1);
  assert.equal(code.split("page.local.AgentRuntimeInstallProvider = '';").length - 1, 3, 'signed-out runtime, installed, failed');
  assert.ok(code.indexOf("page.local.AgentRuntimeOperation = 'update';") < code.indexOf('page.local.AgentRuntimeInstallProvider = provider;'));
  assert.ok(code.indexOf('payload.login = true;') < code.indexOf('page.local.AgentRuntimeInstallProvider = provider;'), 'a sign-in is no install');
});

test('every agent card checks an agent the panel has not read', () => {
  for (const provider of ['convertigo', 'vibe', 'codex', 'claude']) {
    assert.ok(cardActions(provider)[1].includes("page.startAgentProviderCheck('" + provider + "')"), provider);
  }
});

test('the note calls public page methods, and its texts exist in the four languages', () => {
  const template = /htmlTemplate: (<div \*ngIf="getAgentNotReadyText\(\)".*)$/m.exec(yaml)[1];
  const publicMethods = new Set(members.filter(m => ts.isMethodDeclaration(m) && !(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Private))
    .map(m => m.name.getText(ast)));
  const called = [...template.matchAll(/\b([A-Za-z]+)\(\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(called)].sort(), ['canConnectSelectedAgent', 'connectSelectedAgent', 'getAgentBackLabel', 'getAgentNotReadyText', 'useReadyAgentProvider']);
  for (const name of called) assert.ok(publicMethods.has(name), name);
  for (const key of ['Agent_Not_Ready_Checking', 'Agent_Not_Ready_Sign_In', 'Agent_Not_Ready_Install', 'Agent_Not_Ready', 'Agent_Not_Ready_Back',
    'Agent_Not_Ready_No_Back', 'Agent_Back_To']) {
    assert.equal(yaml.split('\n').filter(line => line.trim().startsWith(key + ': "')).length, 4, key);
  }
});
