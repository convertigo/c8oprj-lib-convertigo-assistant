// The No Code Studio of a server: its administrators set the agent, the model and the default effort; every user sees
// the agent and the model (composer and settings, read only) and chooses their own reasoning effort among the levels of
// that model (AgentServerSettings action reasoning, js/agent_bridge_client.js saveCallerReasoning). The Continue of an
// administrator's screen stays open and says why when the server refused the save (serverSettings.saveError).
// node --test tests/nocode-user-reasoning.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, formattedEntries } = require('./helpers/assistant-source.cjs');

const PAGE = '_c8oProject/mobilePages/Page.yaml';
const pageYaml = read(PAGE);

function subject(names) {
  const source = pageClass();
  const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
  const members = ast.statements.find(ts.isClassDeclaration).members.filter((m) => m.name && names.includes(m.name.getText(ast)));
  assert.deepEqual(members.map((m) => m.name.getText(ast)).sort(), [...names].sort());
  const sandbox = {};
  vm.runInNewContext(ts.transpileModule('class Subject { ' + members.map((m) => m.getText(ast)).join('\n') + ' }; this.Subject = Subject;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
  return new sandbox.Subject();
}

const LEVELS = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }];

// A page of the No Code Studio, as the settings answer leaves it (applyNoCodeServerDefaults).
function noCodePage({ server = {}, language = 'fr', answer = { ok: true, userReasoning: 'low' } } = {}) {
  const page = subject(['isNoCodeServerManaged', 'noCodeEffortText', 'getNoCodeServerAgent', 'getNoCodeAgentNote', 'setNoCodeUserReasoning']);
  const calls = [];
  const descriptor = { id: 'convertigo', defaultModel: 'glm-5-3', supports: { reasoning: true }, models: [
    { id: 'glm-5-3', label: 'GLM 5.3', defaultReasoning: 'high', reasoningLevels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }] },
    { id: 'mistral-large-4', label: 'Mistral Large 4', defaultReasoning: 'medium', reasoningLevels: LEVELS }] };
  Object.assign(page, {
    local: { AgentSettings: { providers: [descriptor], serverSettings: { managed: true, provider: 'convertigo', model: 'mistral-large-4',
      reasoning: 'high', userReasoning: '', administrator: false, ...server } }, AgentReasoningEffort: 'high' },
    global: { currentLanguage: () => language },
    ticks: 0,
    tick() { this.ticks++; },
    normalizeAgentProviderValue: (value) => String(value ?? '').trim().toLowerCase(),
    getAgentProviderDescriptor: (provider) => (provider === 'convertigo' ? descriptor : null),
    getAgentSettingsRoot() { return this.local.AgentSettings; },
    getAgentProviderLabel: (provider) => (provider === 'convertigo' ? 'Convertigo' : 'Agent'),
    c8o: { callJsonObject: (name, payload) => {
      calls.push({ name, payload });
      return { async: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ result: answer })) };
    } }
  });
  return { page, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('every user sees the agent and the model of the server, and their own effort among its levels', () => {
  const { page } = noCodePage();
  const agent = page.getNoCodeServerAgent();
  assert.equal(agent.model, 'mistral-large-4');
  assert.equal(agent.modelLabel, 'Mistral Large 4');
  assert.deepEqual(agent.levels.map((level) => level.id), ['low', 'medium', 'high']);
  assert.equal(agent.defaultReasoning, 'high', 'the server default');
  assert.equal(agent.userReasoning, '');
  assert.equal(agent.reasoning, 'high');
  assert.equal(page.getNoCodeAgentNote(), 'Agent et modèle : Convertigo · Mistral Large 4, choisis par les administrateurs du No Code Studio.');
  // the user's own effort wins; one the model does not offer is ignored
  page.local.AgentSettings.serverSettings.userReasoning = 'low';
  assert.equal(page.getNoCodeServerAgent().reasoning, 'low');
  assert.equal(page.getNoCodeServerAgent().reasoningLabel, 'Low');
  page.local.AgentSettings.serverSettings.userReasoning = 'max';
  assert.equal(page.getNoCodeServerAgent().reasoning, 'high');
  // the server's model left to the agent's default: that model and its default effort
  const byDefault = noCodePage({ server: { model: '', reasoning: '' } }).page.getNoCodeServerAgent();
  assert.equal(byDefault.model, 'glm-5-3');
  assert.equal(byDefault.defaultReasoning, 'high');
  // not a server whose administrators set Tigo (the Studio, a server without the C8Oforms right): nothing changes
  const studio = noCodePage({ server: { managed: false } }).page;
  assert.equal(studio.getNoCodeServerAgent(), null);
  assert.equal(studio.getNoCodeAgentNote(), '');
});

test('the texts exist in French, English, Italian and Spanish', () => {
  const keys = ['userTitle', 'userHint', 'adminHint', 'defaultChoice', 'saveError', 'agentNote'];
  const seen = {};
  for (const language of ['fr', 'en', 'it', 'es']) {
    const { page } = noCodePage({ language });
    for (const key of keys) {
      const text = page.noCodeEffortText(key);
      assert.ok(text.length && text !== key, language + ' ' + key);
      seen[key] = (seen[key] || new Set()).add(text);
    }
    assert.match(page.noCodeEffortText('userHint'), /\{model\}/);
    assert.match(page.noCodeEffortText('defaultChoice'), /\{level\}/);
    assert.match(page.noCodeEffortText('agentNote'), /\{agent\}/);
  }
  for (const key of keys) {
    assert.equal(seen[key].size, 4, key + ' translated');
  }
  assert.equal(noCodePage({ language: 'de' }).page.noCodeEffortText('userTitle'), 'Your reasoning effort', 'English otherwise');
});

test('a user chooses their effort: saved for them on the server, the next message runs on it', async () => {
  const { page, calls } = noCodePage();
  page.setNoCodeUserReasoning('low');
  assert.equal(page.getNoCodeServerAgent().saving, true);
  assert.equal(page.getNoCodeServerAgent().reasoning, 'low', 'shown at once');
  page.setNoCodeUserReasoning('medium');
  assert.equal(calls.length, 1, 'one save at a time');
  await settle();
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ name: 'lib_ConvertigoAssistant.AgentServerSettings', payload: { action: 'reasoning', settings: '{"reasoning":"low"}' } }));
  assert.equal(page.local.AgentSettings.serverSettings.userReasoning, 'low');
  assert.equal(page.local.AgentReasoningEffort, 'low');
  assert.equal(page.getNoCodeServerAgent().saving, false);
  page.setNoCodeUserReasoning('low');
  assert.equal(calls.length, 1, 'the same choice saves nothing');
  // refused (a level the model does not offer, the right withdrawn): the previous effort stays, the reason is shown
  const refused = noCodePage({ server: { userReasoning: 'medium' }, answer: { ok: false, error: { code: 'invalid_value', message: 'invalid_value: reasoning' } } });
  refused.page.setNoCodeUserReasoning('high');
  await settle();
  assert.equal(refused.page.getNoCodeServerAgent().reasoning, 'medium');
  assert.equal(refused.page.getNoCodeServerAgent().error, 'invalid_value: reasoning');
  // back to the server's default
  const back = noCodePage({ server: { userReasoning: 'low' }, answer: { ok: true, userReasoning: '' } });
  back.page.setNoCodeUserReasoning('');
  await settle();
  assert.equal(back.calls[0].payload.settings, '{"reasoning":""}');
  assert.equal(back.page.getNoCodeServerAgent().reasoning, 'high');
  // the composer of an administrator: their own effort, the screen keeps the server's default
  const admin = noCodePage({ server: { administrator: true }, answer: { ok: true, userReasoning: 'low' } });
  admin.page.setNoCodeUserReasoning('low');
  await settle();
  assert.equal(admin.page.getNoCodeServerAgent().reasoning, 'low');
  assert.equal(admin.page.local.AgentReasoningEffort, 'high', 'the server default on the administrator\'s screen');
});

// The composer (LightRagFooterComponent) as the page binds it.
const useVariable = (name) => {
  const match = new RegExp('↓' + name + ' \\[ngx\\.components\\.UIUseVariable-\\d+\\]: \\n      varValue: \\n        - xmlizable: \\n          - ↑classname: \\S+\\n          - MobileSmartSourceType: \'?(script:[^\\n]+?)\'?\\n').exec(pageYaml);
  assert.ok(match, name);
  const expression = match[1].replace(/''/g, "'").slice('script:'.length);
  return (page) => new Function('local', 'return ' + expression).call(page, page.local);
};

test('the composer shows the server\'s agent and model, and offers the user\'s effort', () => {
  const { page } = noCodePage({ server: { userReasoning: 'medium' } });
  page.isAgentBridgeMode = () => true;
  page.getAgentFooterModelOptions = () => [{ id: 'other' }];
  assert.deepEqual(useVariable('AgentModels')(page), [], 'no model to choose');
  assert.equal(useVariable('AgentProviderLabel')(page), 'Convertigo · Mistral Large 4');
  assert.deepEqual(useVariable('AgentReasoningLevels')(page).map((level) => level.id), ['low', 'medium', 'high']);
  assert.equal(useVariable('AgentReasoningEffort')(page), 'medium');
  assert.equal(useVariable('AgentReasoningLabel')(page), 'Medium');
  // the Studio keeps its own controls
  const studio = noCodePage({ server: { managed: false } }).page;
  Object.assign(studio, { isAgentBridgeMode: () => true, getAgentReasoningLabel: () => 'High', getAgentFooterModelOptions: () => [{ id: 'gpt' }], getAgentProviderLabel: () => 'Convertigo' });
  studio.local.AgentReasoningLevels = LEVELS;
  assert.deepEqual(useVariable('AgentReasoningLevels')(studio), LEVELS);
  assert.equal(useVariable('AgentReasoningEffort')(studio), 'high');
  assert.equal(useVariable('AgentProviderLabel')(studio), 'Convertigo');
});

const action = (marker) => {
  const entries = formattedEntries(PAGE).filter((entry) => entry.code.includes(marker));
  assert.equal(entries.length, 1, marker);
  return entries[0].code;
};

test('the composer\'s effort change saves the user\'s own effort on a No Code server', async () => {
  const code = action('var serverAgent = page.getNoCodeServerAgent ? page.getNoCodeServerAgent() : null;');
  const run = (page, value) => new Promise((resolve) => new Function('page', 'event', 'props', 'resolve', code)(page, { reasoning: value }, {}, resolve));
  const { page, calls } = noCodePage();
  await run(page, 'high');
  assert.equal(calls.length, 0, 'the effort already in use');
  await run(page, 'low');
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(page.local.AgentSettings.serverSettings.userReasoning, 'low');
  // the Studio: the local choice, as before
  const studio = noCodePage({ server: { managed: false } });
  await run(studio.page, 'medium');
  assert.equal(studio.calls.length, 0);
  assert.equal(studio.page.local.AgentReasoningEffort, 'medium');
});

test('the settings of a user: the effort block first in the preferences; Continue keeps an administrator\'s refused save open', async () => {
  const block = /↓UserReasoningSettings \[ngx\.components\.UICustom-\d+\]: \n[^\n]+\n\s+htmlTemplate: '([^\n]+)'\n/.exec(pageYaml);
  assert.ok(block, 'UserReasoningSettings');
  const template = block[1].replace(/''/g, "'");
  assert.match(template, /^<ng-container \*ngIf="getNoCodeServerAgent\(\) as agent"><div \*ngIf="agent\.levels\.length"/);
  assert.match(template, /\(click\)="setNoCodeUserReasoning\(''\)"/, 'back to the server default');
  assert.match(template, /\*ngFor="let level of agent\.levels"[^>]+\(click\)="setNoCodeUserReasoning\(level\.id\)"/);
  const prefs = pageYaml.indexOf('↓PrefsCategory [');
  assert.ok(prefs < pageYaml.indexOf('↓UserReasoningSettings [') && pageYaml.indexOf('↓UserReasoningSettings [') < pageYaml.indexOf('↓RevealSettings1 ['));
  assert.match(pageYaml, /↓ServerSaveError \[ngx\.components\.UICustom-\d+\]: \n[^\n]+\n\s+htmlTemplate: '<p \*ngIf="local\?\.AgentServerSettingsError && local\?\.AgentSettings\?\.serverSettings\?\.administrator === true"/);

  const code = action('var saveError = result.settings && result.settings.serverSettings ? result.settings.serverSettings.saveError : null;');
  const run = (answer) => {
    const closed = [];
    const page = {
      local: { AgentProvider: 'convertigo', AgentModel: 'mistral-large-4', AgentReasoningEffort: 'medium', AgentSettings: { serverSettings: { managed: true, administrator: true } } },
      tick() {}, closeAgentSettingsPage: () => closed.push(true), getAgentContextUserId: () => 'admin@example.com',
      c8o: { callJsonObject: () => ({ async: () => Promise.resolve({ result: answer }) }), log: { warn() {} } }
    };
    return new Promise((resolve) => new Function('page', 'event', 'props', 'resolve', code)(page, {}, {}, resolve)).then(() => ({ page, closed }));
  };
  const refused = await run({ settings: { serverSettings: { managed: true, administrator: true, saveError: { code: 'request_token_required', message: 'The server settings must be saved from this server\'s settings page using POST.' } } } });
  assert.equal(refused.closed.length, 0, 'the screen stays open');
  assert.match(refused.page.local.AgentServerSettingsError, /must be saved/);
  const saved = await run({ settings: { serverSettings: { managed: true, administrator: true, model: 'mistral-large-4' } } });
  assert.equal(saved.closed.length, 1);
  assert.equal(saved.page.local.AgentServerSettingsError, '');
  assert.equal(saved.page.local.AgentSettings.serverSettings.model, 'mistral-large-4');
});
