// The reasoning effort the user sees must be one the selected model really accepts.
// node --test tests/assistant_reasoning_effort.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { formattedBlocks, ts, pageClass } = require('./helpers/assistant-source.cjs');

const blocks = formattedBlocks('_c8oProject/mobilePages/Page.yaml');
const only = (marker) => {
  const found = blocks.filter((block) => block.includes(marker));
  assert.equal(found.length, 1, marker);
  return found[0];
};
// The alignment runs twice: when the settings land on page load, and when a conversation is
// restored. Both slices end on the assignment of the local the combo is bound to.
const slice = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end + to.length);
};

const pageInit = slice(only('var preferredReasoning ='), 'var preferredReasoning =',
  "this.local.AgentReasoningEffort = this.resolveAgentReasoning([preferredReasoning], true);");
const settingsAction = slice(only('var reasoning = clean(preserveSelection ? page.local.AgentReasoningEffort'),
  'var reasoning = clean(preserveSelection ? page.local.AgentReasoningEffort',
  "page.local.AgentReasoningEffort = page.resolveAgentReasoning ? page.resolveAgentReasoning([preserveSelection ? page.local.AgentReasoningEffort : '', state.reasoningEffort, result.reasoningEffort, reasoning], true) : (page.local.AgentProviderSupportsReasoning === true ? reasoning : '');");

// The real resolveAgentReasoning of the page, every reasoning assignment goes through it.
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const resolveMethod = pageAst.statements[0].members.find((m) => m.name && m.name.getText(pageAst) === 'resolveAgentReasoning');
assert.ok(resolveMethod, 'resolveAgentReasoning');
const resolveSandbox = {};
vm.runInNewContext(ts.transpileModule('class Resolver { ' + resolveMethod.getText(pageAst) + ' }; this.Resolver = Resolver;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, resolveSandbox);
function withResolver(local, settings) {
  const owner = new resolveSandbox.Resolver();
  owner.local = local;
  owner.getAgentSettingsRoot = () => settings || {};
  return owner;
}

const clean = (value) => (value === null || typeof value === 'undefined' ? '' : String(value)).trim();
const levels = (ids) => ids.map((id) => ({ id, label: id }));
// GLM 5.3 on the Vibe profile: off and low are not offered, the model default is medium.
const glm53 = { id: 'glm-5-3', defaultReasoning: 'medium', reasoningLevels: levels(['medium', 'high', 'max']) };

function modelLocal(selectedModel, effort) {
  return { AgentProvider: 'vibe', AgentModel: selectedModel.id, AgentModels: [selectedModel], AgentProviderSupportsReasoning: true,
    AgentReasoningEffort: effort, AgentReasoningLevels: selectedModel.reasoningLevels };
}

function runPageInit(storedReasoning, selectedModel, settings) {
  const self = withResolver(modelLocal(selectedModel, ''), settings);
  const context = vm.createContext({
    clean, selectedModel, storedReasoning, preserveSelection: false, preferencesConfirmed: false,
    preferences: {}, self
  });
  vm.runInContext('(function () {\n' + pageInit.replace(/this\./g, 'self.') + '\n})();', context);
  return self.local.AgentReasoningEffort;
}

function runSettingsAction(previousChoice, selectedModel, state, settings) {
  const page = withResolver(modelLocal(selectedModel, previousChoice), settings);
  const context = vm.createContext({
    clean, selectedModel, page, storedReasoning: '', preserveSelection: false, preferencesConfirmed: !!(settings && settings.preferences),
    preferences: (settings && settings.preferences) || {}, state: state || {}, result: {}
  });
  vm.runInContext('(function () {\n' + settingsAction + '\n})();', context);
  return page.local.AgentReasoningEffort;
}

test('a conversation with no choice pre-selects the model default', () => {
  assert.equal(runPageInit('', glm53), 'medium');
  assert.equal(runSettingsAction('', glm53), 'medium');
});

test('a remembered level the model no longer offers falls back on its default', () => {
  // The exact bug: "low" was remembered from a GLM 5.2 conversation, the combo showed nothing
  // selected and the session was started on a level the model refuses.
  assert.equal(runPageInit('low', glm53), 'medium');
  assert.equal(runPageInit('off', glm53), 'medium');
  assert.equal(runSettingsAction('low', glm53), 'medium');
  assert.equal(runSettingsAction('off', glm53), 'medium');
});

test('a remembered level the model still offers is kept', () => {
  assert.equal(runPageInit('max', glm53), 'max');
  assert.equal(runSettingsAction('high', glm53), 'high');
});

test('the selected effort is always one of the offered options', () => {
  const offered = glm53.reasoningLevels.map((level) => level.id);
  ['', 'off', 'none', 'low', 'medium', 'high', 'max', 'banana'].forEach((asked) => {
    assert.ok(offered.includes(runPageInit(asked, glm53)), 'page load with ' + asked);
    assert.ok(offered.includes(runSettingsAction(asked, glm53)), 'settings refresh with ' + asked);
  });
});

test('changing the model re-aligns the effort on the new model default', () => {
  // SetModel and SetFooterModel take the new model's default outright, never the stale choice.
  ['var reasoning = clean(agentModel && agentModel.defaultReasoning);',
    'var reasoning = clean(selectedModel && selectedModel.defaultReasoning);'].forEach((assignment) => {
    assert.ok(blocks.some((block) => block.includes(assignment)), assignment);
  });
});

test('a resumed conversation keeps its own level before the saved preference', () => {
  const settings = { preferences: { confirmed: true, provider: 'vibe', reasoning: 'high' } };
  assert.equal(runSettingsAction('', glm53, { reasoningEffort: 'max' }, settings), 'max');
  assert.equal(runSettingsAction('', glm53, {}, settings), 'high', 'no conversation level: the preference');
  assert.equal(runSettingsAction('', glm53, { reasoningEffort: 'low' }, settings), 'high', 'a level the model refuses is skipped');
});

test('a model or provider change keeps the current level when the new model accepts it', () => {
  const onlyHigh = { id: 'mistral-large-4', defaultReasoning: 'high', reasoningLevels: levels(['high']) };
  assert.equal(withResolver(modelLocal(glm53, 'max')).resolveAgentReasoning(['max', 'medium'], false), 'max');
  assert.equal(withResolver(modelLocal(onlyHigh, 'max')).resolveAgentReasoning(['max', 'high'], false), 'high');
});

test('the provider global default is the last fallback, and no level without reasoning', () => {
  const noDefault = { id: 'custom', reasoningLevels: levels(['low', 'high']) };
  assert.equal(withResolver(modelLocal(noDefault, '')).resolveAgentReasoning([''], true, ), 'low', 'first offered level');
  assert.equal(withResolver(modelLocal(noDefault, ''), { defaults: { provider: 'vibe', reasoning: 'high' } }).resolveAgentReasoning([''], true), 'high');
  const local = modelLocal(glm53, 'max'); local.AgentProviderSupportsReasoning = false;
  assert.equal(withResolver(local).resolveAgentReasoning(['max'], true), '');
});
