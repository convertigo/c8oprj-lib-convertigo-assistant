// The settings page shows every network wait (the check of the agent, a refresh of the model catalog, a save) and says
// when a check did not finish; its opening no longer refreshes the model catalog (a settings Vibe start and gateway probes,
// 60 to 90 s on test-nocode, 16/11), and a Continue no longer waits behind the check of the same screen.
// node --test tests/settings-wait.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, formattedEntries } = require('./helpers/assistant-source.cjs');

const PAGE = '_c8oProject/mobilePages/Page.yaml';
const pageYaml = read(PAGE);

function subject(names) {
  const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
  const members = ast.statements.find(ts.isClassDeclaration).members.filter((m) => m.name && names.includes(m.name.getText(ast)));
  assert.deepEqual(members.map((m) => m.name.getText(ast)).sort(), [...names].sort());
  const sandbox = { setTimeout: () => 0 };
  vm.runInNewContext(ts.transpileModule('class Subject { ' + members.map((m) => m.getText(ast)).join('\n') + ' }; this.Subject = Subject;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
  return new sandbox.Subject();
}

function waitPage(language = 'fr') {
  const page = subject(['settingsWaitText', 'getSettingsWaitState', 'retrySettingsCheck', 'refreshAgentModelCatalog']);
  const checks = [];
  Object.assign(page, {
    local: {},
    global: { currentLanguage: () => language },
    refreshAgentSettingsAfterHostContext: (...args) => checks.push(args)
  });
  return { page, checks };
}

test('every wait of the settings page is said, saves first, and a check that did not finish offers Retry', () => {
  const { page, checks } = waitPage();
  assert.equal(page.getSettingsWaitState(), null, 'nothing waits');
  page.local.AgentSettingsCheckKind = 'check';
  assert.equal(page.getSettingsWaitState().text, 'Vérification de l’agent et de ses mises à jour…');
  page.local.AgentSettingsCheckKind = 'catalog';
  assert.match(page.getSettingsWaitState().text, /^Actualisation de la liste des modèles/);
  page.local.AgentUserReasoningSaving = true;
  assert.equal(page.getSettingsWaitState().kind, 'effortSaving');
  page.local.AgentServerSettingsSaving = 'writeConfirm';
  assert.equal(page.getSettingsWaitState().kind, 'serverSaving');
  page.local.AgentSettingsSaving = true;
  assert.equal(page.getSettingsWaitState().text, 'Enregistrement des réglages…');
  // a check that failed or timed out: what happened, with Retry, the last known settings stay
  page.local = { AgentSettingsCheckError: 'La vérification a dépassé le délai de 60 secondes.', AgentSettingsLastCheckKind: 'catalog' };
  const failed = page.getSettingsWaitState();
  assert.equal(failed.error, true);
  assert.equal(failed.retry, true);
  assert.equal(failed.text, 'La vérification n’a pas abouti. La vérification a dépassé le délai de 60 secondes. Les réglages affichés sont les derniers connus.');
  page.retrySettingsCheck();
  assert.deepEqual(checks.pop(), [true, false, true], 'the retry repeats the catalog refresh that failed');
  assert.equal(page.local.AgentSettingsCheckError, '');
  // the Refresh models button asks for the catalog, the opening never does
  page.local = {};
  page.refreshAgentModelCatalog();
  assert.deepEqual(checks.pop(), [true, false, true]);
  page.local.AgentSettingsRefreshRunning = true;
  page.refreshAgentModelCatalog();
  assert.equal(checks.length, 0, 'not while a check runs');
});

test('the wait texts exist in French, English, Italian and Spanish', () => {
  const keys = ['check', 'catalog', 'saving', 'serverSaving', 'effortSaving', 'lastKnown', 'checkFailed', 'retry', 'saveTimeout'];
  const seen = {};
  for (const language of ['fr', 'en', 'it', 'es']) {
    const { page } = waitPage(language);
    for (const key of keys) {
      const text = page.settingsWaitText(key);
      assert.ok(text.length && text !== key, language + ' ' + key);
      (seen[key] = seen[key] || new Set()).add(text);
    }
  }
  for (const key of keys) {
    assert.equal(seen[key].size, 4, key + ' translated');
  }
});

test('the opening reads the cached catalog; Refresh models, a sign-in and a re-read key refresh it', () => {
  const method = pageYaml.slice(pageYaml.indexOf('public refreshAgentSettingsAfterHostContext('), pageYaml.indexOf('public setAgentSettingsUrlState('));
  assert.match(method, /public refreshAgentSettingsAfterHostContext\(forceFullSettings = false, presenceRecheck = false, refreshCatalog = false\)/);
  assert.match(method, /''refreshModelCatalog'': refreshCatalog === true,/);
  assert.match(method, /''settingsCacheMaxAgeMs'': \(forceFullSettings === true && refreshCatalog !== true\) \? 604800000 : "",/);
  assert.match(method, /var checkKind = forceFullSettings === true \? \(refreshCatalog === true \? "catalog" : "check"\) : "";/);
  assert.equal((method.match(/endCheck\((null|settingsError)\);/g) || []).length, 2, 'the answer and the failure both end the wait');
  assert.match(method, /try \{ if \(endCheck\) \{ endCheck\(e\); \} \} catch \(eEnd\) \{\}/, 'a check that failed before its request left too');
  assert.match(method, /''__context'': noCode \? ''agent_nocode_settings'' : \(forceFullSettings === true \? ''studio_assistant_settings_check'' : ''byside''\)/,
    'in the Studio the full check does not hold the saves of byside');
  assert.equal((pageYaml.match(/refreshAgentSettingsAfterHostContext\(true, false, true\)/g) || []).length, 3,
    'Refresh models, the sign-in, the Convertigo key (Retry repeats the kind that failed)');
  // the banner under the tabs, the footer status
  assert.match(pageYaml, /↓SettingsWait \[ngx\.components\.UICustom-\d+\]: \n[^\n]+\n\s+htmlTemplate: '<div \*ngIf="getSettingsWaitState\(\) as wait"/);
  assert.match(pageYaml, /<ion-spinner \*ngIf="!wait\.error" name="crescent"/);
  assert.match(pageYaml, /\(click\)="retrySettingsCheck\(\)"/);
  assert.match(pageYaml, /MobileSmartSourceType: 'script:''agent-settings-sync-status'' \+ \(this\.getSettingsWaitState && this\.getSettingsWaitState\(\)/);
  assert.match(pageYaml, /\.agent-settings-sync-status\.is-waiting::before \{\n\s+animation: tigo-settings-wait/);
});

test('a user of a No Code server opens the settings without a full check of the agent', () => {
  const page = subject(['openAgentSettingsPage']);
  const calls = [];
  Object.assign(page, {
    local: { AgentSettings: { serverSettings: { managed: true, administrator: false } } },
    requestTigoResources() {}, setAgentSettingsUrlState() {}, setEnableChat() {}, tick() {},
    requestAgentHostContext() {}, refreshAgentStackRelease() {},
    refreshAgentSettingsAfterHostContext: (...args) => calls.push(args)
  });
  page.openAgentSettingsPage();
  assert.equal(calls.length, 0);
  assert.equal(page.local.AgentRuntimeLoading, false);
  assert.equal(page.local.ShowAgentConfigPanel, true);
  page.local.AgentSettings.serverSettings.administrator = true;
  page.local.AgentServerSettingsError = 'an earlier failure';
  page.openAgentSettingsPage();
  assert.deepEqual(calls, [[true]], 'an administrator: the check of the agent, on the cached catalog');
  assert.equal(page.local.AgentServerSettingsError, '', 'an earlier failure is not this opening\'s');
});

const action = (marker) => {
  const entries = formattedEntries(PAGE).filter((entry) => entry.code.includes(marker));
  assert.equal(entries.length, 1, marker);
  return entries[0].code;
};

test('Continue shows its save, is disabled until it answers, and gives up after 30 s', async () => {
  const code = action('page.local.AgentSettingsSaving = true;');
  const timers = [];
  const fakeSetTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const run = (page) => new Promise((resolve) => new Function('page', 'event', 'props', 'resolve', 'setTimeout', 'clearTimeout', code)(page, {}, {}, resolve, fakeSetTimeout, () => {}));
  const make = (serverSettings, answer) => {
    const closed = [];
    const page = {
      local: { AgentProvider: 'convertigo', AgentModel: 'glm-5-3', AgentSettings: { serverSettings } },
      tick() {}, closeAgentSettingsPage: () => closed.push(true), getAgentContextUserId: () => 'someone',
      settingsWaitText: (key) => key,
      c8o: { callJsonObject: () => ({ async: () => answer }), log: { warn() {} } }
    };
    return { page, closed };
  };
  // a user of a No Code server saves nothing: no call, no wait
  const user = make({ managed: true, administrator: false }, new Promise(() => {}));
  await run(user.page);
  assert.equal(user.closed.length, 1);
  assert.equal(user.page.local.AgentSettingsSaving, undefined);
  // an administrator whose save never answers: shown as saving, then the timeout keeps the screen open and says it
  const admin = make({ managed: true, administrator: true }, new Promise(() => {}));
  const done = run(admin.page);
  assert.equal(admin.page.local.AgentSettingsSaving, true);
  assert.equal(timers.at(-1).ms, 30000);
  timers.at(-1).fn();
  await done;
  assert.equal(admin.page.local.AgentSettingsSaving, false);
  assert.equal(admin.page.local.AgentServerSettingsError, 'saveTimeout');
  assert.equal(admin.closed.length, 0);
  // the Studio: a save that answers closes the screen
  const studio = make(undefined, Promise.resolve({ result: { settings: { providers: [] } } }));
  await run(studio.page);
  assert.equal(studio.page.local.AgentSettingsSaving, false);
  assert.equal(studio.closed.length, 1);
  // disabled while it saves
  assert.match(pageYaml, /"Disabled": "script:!this\.local \|\| this\.local\.AgentSettingsSaving === true \|\|/);
});

test('a settings-only read lists no conversations; the screen, Continue and the setup refresh ask for none', () => {
  const { backendParts } = require('./helpers/assistant-source.cjs');
  const listed = [];
  const sandbox = {
    trim: (value) => String(value ?? '').trim(),
    resolveWorkspaceRoot: () => '/workspace', normalizeUserKey: (value) => String(value), normalizeProviderSelector: (value) => value,
    normalizeSkillProfile: () => 'nocode', sendMark() {}, now: () => 1,
    agentSettingsForOptions: () => ({ ok: true, providers: [{ id: 'convertigo' }], defaults: { provider: 'convertigo' } }),
    publicConversations: () => { listed.push(true); return [{ conversationId: 'agent-1' }]; }
  };
  vm.runInNewContext(backendParts(['settingsSteps']), sandbox);
  assert.equal(sandbox.settingsSteps({ userId: 'u' }).conversations.length, 1, 'by default, as before');
  assert.equal(sandbox.settingsSteps({ userId: 'u', withConversations: 'false' }).conversations.length, 0);
  assert.equal(listed.length, 1);
  assert.match(read('js/agent_bridge_client.js'), /"settingsTimeoutMs", "settingsCacheMaxAgeMs", "withConversations",/);
  assert.equal((pageYaml.match(/withConversations'*: false,/g) || []).length, 3);
});
