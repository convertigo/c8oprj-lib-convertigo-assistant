// The context and usage panel lists the agent model and the vision models (image-describe) with a session total.
// node --test tests/assistant_usage_per_model.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');

const METHODS = ['getAgentUsageView', 'agentUiText', 'agentUiLanguage', 'formatAgentNumber', 'formatAgentTokens', 'formatAgentCost', 'formatAgentDuration'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const sandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

function view(language, usage) {
  const page = new sandbox.View();
  page.global = { currentLanguage: () => language };
  return page.getAgentUsageView(usage);
}
const rows = (result) => Object.fromEntries(result.rows.map((row) => [row.label, row.value]));

const agentRow = { model: 'glm-5-3', kind: 'agent', calls: null, requests: 6, inputTokens: 40000, cachedTokens: 30000, outputTokens: 1200, costAmount: 0.05, costSource: 'journal' };
const visionRow = { model: 'mistral/mistral-large-4', kind: 'vision', calls: 2, requests: 2, inputTokens: 2500, cachedTokens: 0, outputTokens: 300, costAmount: 0.006, costSource: 'gateway' };
const base = { used: 9400, size: 950000, window: 1000000, threshold: 950000, model: 'glm-5-3', inputTokens: 40000, cachedTokens: 30000, cacheRate: 0.75,
  outputTokens: 1200, completionTokens: 1100, costAmount: 0.05, costCurrency: 'USD', costSource: 'journal', models: [agentRow], sessionTokens: { inputTokens: 40000, cachedTokens: 30000, outputTokens: 1200 } };

test('with one model the session cost row stays, with its source, and no per-model rows', () => {
  const result = rows(view('en', base));
  assert.equal(result['Estimated session cost'], '0.05 USD · estimated from the journal');
  assert.equal(result['Session total (all models)'], undefined);
  assert.equal(result['Agent · glm-5-3'], undefined);
  assert.equal(result['Completion tokens (session)'], '1.2 k', 'the generated tokens row reads the journal count');
});

test('each model has its row with its cost source, and the session total adds them up', () => {
  const usage = Object.assign({}, base, { costAmount: 0.056, models: [agentRow, visionRow], sessionTokens: { inputTokens: 42500, cachedTokens: 30000, outputTokens: 1500 } });
  const en = rows(view('en', usage));
  assert.equal(en['Estimated session cost'], undefined, 'replaced by the per-model rows and the total');
  assert.equal(en['Agent · glm-5-3'], '40 k sent · 1.2 k generated · 0.05 USD · estimated from the journal');
  assert.equal(en['Vision · mistral/mistral-large-4'], '2 calls · 2.5 k sent · 300 generated · 0.0060 USD · charged by the gateway');
  assert.equal(en['Session total (all models)'], '43 k sent · 1.5 k generated · 0.06 USD · sum of the models');
  const fr = rows(view('fr', usage));
  assert.equal(fr['Vision · mistral/mistral-large-4'], '2 appels · 2,5 k envoyés · 300 générés · 0,0060 USD · facturé par la passerelle');
  assert.equal(fr['Total de la session (tous modèles)'], '43 k envoyés · 1,5 k générés · 0,06 USD · somme des modèles');
});

test('an unknown cost is said, never summed as zero', () => {
  const usage = Object.assign({}, base, { costAmount: null, costSource: '', models: [Object.assign({}, agentRow, { costAmount: null, costSource: '' }), Object.assign({}, visionRow, { calls: 1, costAmount: 0.001 })] });
  const en = rows(view('en', usage));
  assert.equal(en['Vision · mistral/mistral-large-4'], '1 call · 2.5 k sent · 300 generated · 0.0010 USD · charged by the gateway');
  assert.match(en['Agent · glm-5-3'], /not provided$/);
  assert.match(en['Session total (all models)'], /not provided$/);
});

test('a vision row says how many browser verifications made its calls', () => {
  const verifyRow = Object.assign({}, visionRow, { calls: 11, requests: 11, verifications: 2, inputTokens: 38500, outputTokens: 1700, costAmount: 0.0293 });
  const usage = Object.assign({}, base, { costAmount: 0.0793, models: [agentRow, verifyRow], sessionTokens: { inputTokens: 78500, cachedTokens: 30000, outputTokens: 2900 } });
  assert.equal(rows(view('en', usage))['Vision · mistral/mistral-large-4'], '11 calls (including 2 browser verifications) · 39 k sent · 1.7 k generated · 0.03 USD · charged by the gateway');
  assert.equal(rows(view('fr', usage))['Vision · mistral/mistral-large-4'], '11 appels (dont 2 vérifications navigateur) · 39 k envoyés · 1,7 k générés · 0,03 USD · facturé par la passerelle');
  const one = Object.assign({}, usage, { models: [agentRow, Object.assign({}, verifyRow, { verifications: 1 })] });
  assert.match(rows(view('it', one))['Visione · mistral/mistral-large-4'], /^11 chiamate \(di cui 1 verifica nel browser\) · /);
  assert.match(rows(view('es', usage))['Visión · mistral/mistral-large-4'], /^11 llamadas \(incluidas 2 verificaciones en el navegador\) · /);
  assert.equal(rows(view('en', Object.assign({}, usage, { models: [agentRow, visionRow] })))['Vision · mistral/mistral-large-4'].indexOf('including'), -1, 'image-describe alone: no verification count');
});
