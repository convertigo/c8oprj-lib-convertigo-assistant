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

const pageInit = slice(only('var preferredReasoning ='), 'var heldReasoning = this.local.AgentReasoningProvisional',
  "this.local.AgentReasoningProvisional = !!(this.isProvisionalAgentCatalog && this.isProvisionalAgentCatalog(selectedProvider));");
const settingsAction = slice(only('var provisionalReasoning = page.local.AgentReasoningProvisional'),
  'var provisionalReasoning = page.local.AgentReasoningProvisional',
  "page.local.AgentReasoningProvisional = !!(page.isProvisionalAgentCatalog && page.isProvisionalAgentCatalog(selectedProvider));");

// The real resolveAgentReasoning of the page, every reasoning assignment goes through it.
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const resolveMethod = pageAst.statements[0].members.find((m) => m.name && m.name.getText(pageAst) === 'resolveAgentReasoning');
assert.ok(resolveMethod, 'resolveAgentReasoning');
const resolveSandbox = {};
vm.runInNewContext(ts.transpileModule('class Resolver { ' + resolveMethod.getText(pageAst) + ' }; this.Resolver = Resolver;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, resolveSandbox);
const provisionalMethod = pageAst.statements[0].members.find((m) => m.name && m.name.getText(pageAst) === 'isProvisionalAgentCatalog');
assert.ok(provisionalMethod, 'isProvisionalAgentCatalog');
vm.runInNewContext(ts.transpileModule('class Provisional { ' + provisionalMethod.getText(pageAst) + ' }; this.Provisional = Provisional;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, resolveSandbox);
const provisionalCheck = new resolveSandbox.Provisional();
function withResolver(local, settings) {
  const owner = new resolveSandbox.Resolver();
  owner.isProvisionalAgentCatalog = (descriptor) => provisionalCheck.isProvisionalAgentCatalog(descriptor);
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

function runPageInit(storedReasoning, selectedModel, settings, selectedProvider = { source: { type: 'acp' } }, local = null) {
  const self = withResolver(local || modelLocal(selectedModel, ''), settings);
  const context = vm.createContext({
    clean, selectedModel, selectedProvider, storedReasoning, preserveSelection: false, preferencesConfirmed: false,
    preferences: {}, self
  });
  vm.runInContext('(function () {\n' + pageInit.replace(/this\./g, 'self.') + '\n})();', context);
  return local ? self.local : self.local.AgentReasoningEffort;
}

function runSettingsAction(previousChoice, selectedModel, state, settings, selectedProvider = { source: { type: 'acp' } }, extra = {}) {
  const page = withResolver(Object.assign(modelLocal(selectedModel, previousChoice), extra), settings);
  const context = vm.createContext({
    clean, selectedModel, selectedProvider, page, storedReasoning: '', preserveSelection: false, preferencesConfirmed: !!(settings && settings.preferences),
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

test('returning from settings restores the gateway effort choices in the prompt footer', () => {
  const methods = ['useReadyAgentProvider', 'resolveAgentReasoning'].map(name => {
    const method = pageAst.statements[0].members.find(m => m.name && m.name.getText(pageAst) === name);
    assert.ok(method, name);
    return method.getText(pageAst);
  });
  const scope = {};
  vm.runInNewContext(ts.transpileModule('class Page { ' + methods.join('\n') + ' }; this.Page = Page;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
  const model = { id: 'test-model', defaultReasoning: 'high', reasoningLevels: levels(['low', 'high', 'max']) };
  const descriptor = { id: 'convertigo', ready: true, supports: { reasoning: true }, models: [model] };
  const page = new scope.Page();
  Object.assign(page, {
    local: { AgentConfigReturnState: { provider: 'convertigo', model: model.id, reasoning: 'max' } },
    normalizeAgentProviderValue: clean, getAgentProviderDescriptor: () => descriptor,
    isAgentProviderReady: value => value.ready, getDefaultAgentModel: () => model.id,
    getAgentSettingsRoot: () => ({}), t: (_key, fallback) => fallback, tick() {}
  });
  assert.equal(page.useReadyAgentProvider('convertigo'), true);
  assert.deepEqual(Array.from(page.local.AgentReasoningLevels, level => level.id), ['low', 'high', 'max']);
  assert.equal(page.local.AgentReasoningEffort, 'max');
  assert.equal(page.resolveAgentReasoning(['high'], false), 'high');
  // The provider flag must agree with its offer; an unsupported model keeps the selector hidden.
  descriptor.supports.reasoning = false;
  descriptor.models = [{ id: model.id, reasoningLevels: [] }];
  page.useReadyAgentProvider('convertigo');
  assert.equal(page.local.AgentReasoningLevels.length, 0);
  assert.equal(page.local.AgentReasoningEffort, '');
});

// A fresh Studio first reads the agent from its configuration: Mistral Large 4 with its "high" effort alone. The agent
// lists its models some twenty seconds later, and its answer echoes the effort the panel sent: that effort was no choice.
const ml4Provisional = { id: 'mistral-large-4', defaultReasoning: 'high', reasoningLevels: levels(['high']) };
const ml4 = { id: 'mistral-large-4', defaultReasoning: 'medium', reasoningLevels: levels(['low', 'medium', 'high']) };

test('the effort of a provisional catalog gives way to the model default once the agent lists its models', () => {
  const first = runPageInit('', ml4Provisional, {}, { source: { type: 'fallback' } }, modelLocal(ml4Provisional, ''));
  assert.equal(first.AgentReasoningEffort, 'high');
  assert.equal(first.AgentReasoningProvisional, true);
  const page = withResolver(Object.assign(modelLocal(ml4, 'high'), { AgentReasoningProvisional: true }), {});
  const context = vm.createContext({ clean, selectedModel: ml4, selectedProvider: { source: { type: 'acp' } }, page, storedReasoning: '',
    preserveSelection: false, preferencesConfirmed: false, preferences: {}, state: { reasoningEffort: 'high' }, result: { reasoningEffort: 'high' } });
  vm.runInContext('(function () {\n' + settingsAction + '\n})();', context);
  assert.equal(page.local.AgentReasoningEffort, 'medium', 'the echo of the provisional effort is ignored');
  assert.equal(page.local.AgentReasoningEchoIgnored, true);
  assert.equal(page.local.AgentReasoningProvisional, false);
  const refreshed = runPageInit('', ml4, {}, { source: { type: 'acp' } }, Object.assign(modelLocal(ml4, 'high'), { AgentReasoningProvisional: true }));
  assert.equal(refreshed.AgentReasoningEffort, 'medium', 'the settings refresh picks again too');
  assert.equal(runPageInit('low', ml4, {}, { source: { type: 'acp' } }, Object.assign(modelLocal(ml4, 'high'), { AgentReasoningProvisional: true })).AgentReasoningEffort, 'low', 'a stored choice wins');
});

test('an effort chosen on the real catalog stays, echoed or not', () => {
  assert.equal(runSettingsAction('high', ml4, { reasoningEffort: 'high' }, undefined, { source: { type: 'acp' } }, { AgentReasoningProvisional: false }), 'high');
});
