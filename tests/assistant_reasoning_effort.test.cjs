// The reasoning effort the user sees must be one the selected model really accepts.
// node --test tests/assistant_reasoning_effort.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { formattedBlocks } = require('./helpers/assistant-source.cjs');

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
  "this.local.AgentReasoningEffort = this.local.AgentProviderSupportsReasoning === true ? preferredReasoning : '';");
const settingsAction = slice(only('var reasoning = clean(preserveSelection ? page.local.AgentReasoningEffort'),
  'var reasoning = clean(preserveSelection ? page.local.AgentReasoningEffort',
  "page.local.AgentReasoningEffort = page.local.AgentProviderSupportsReasoning === true ? reasoning : '';");

const clean = (value) => (value === null || typeof value === 'undefined' ? '' : String(value)).trim();
const levels = (ids) => ids.map((id) => ({ id, label: id }));
// GLM 5.3 on the Vibe profile: off and low are not offered, the model default is medium.
const glm53 = { id: 'glm-5-3', defaultReasoning: 'medium', reasoningLevels: levels(['medium', 'high', 'max']) };

function runPageInit(storedReasoning, selectedModel) {
  const local = { AgentProviderSupportsReasoning: true, AgentReasoningEffort: '', AgentReasoningLevels: [] };
  local.AgentReasoningLevels = selectedModel.reasoningLevels;
  const context = vm.createContext({
    clean, selectedModel, storedReasoning, preserveSelection: false, preferencesConfirmed: false,
    preferences: {}, self: { local }
  });
  vm.runInContext('(function () {\n' + pageInit.replace(/this\.local/g, 'self.local') + '\n})();', context);
  return local.AgentReasoningEffort;
}

function runSettingsAction(previousChoice, selectedModel) {
  const page = { local: { AgentProviderSupportsReasoning: true, AgentReasoningEffort: previousChoice, AgentReasoningLevels: selectedModel.reasoningLevels } };
  const context = vm.createContext({
    clean, selectedModel, page, storedReasoning: '', preserveSelection: false, preferencesConfirmed: false,
    preferences: {}, state: {}, result: {}
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
