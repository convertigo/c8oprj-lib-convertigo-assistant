// Sub-agent runs of the turn: the client turns the run folders of the conversation into "subagent" progress events,
// and the page shows each one as its own block (profile, model, task, latest steps, report, cost).
// node --test tests/assistant_subagent_block.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const METHODS = ['getSubagentView', 'subagentProfileLabel', 'agentUiText', 'agentUiLanguage', 'formatAgentNumber', 'formatAgentTokens', 'formatAgentCost', 'formatAgentDuration'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);
function view(language, step) {
  const page = new pageSandbox.View();
  page.global = { currentLanguage: () => language };
  return JSON.parse(JSON.stringify(page.getSubagentView(step)));
}

const finished = { runId: 'verify-20261017-223124-69610cf3', profile: 'verifier', model: 'mistral/mistral-large-4', task: 'Créer Poste Qualité et vérifier son statut',
  status: 'completed', durationMs: 118805, activity: ['navigate http://localhost:49594/home', 'click button "New poste"'], verdict: 'failed',
  summary: 'Le statut enregistré est « En attente » au lieu de « À déclarer ».', modelCalls: 20, cost: 0.10356 };

test('a finished run: badge, task, model, status, duration, calls and cost, then its verdict and report', () => {
  const v = view('fr', { type: 'subagent', status: 'completed', text: 'Créer Poste Qualité', detail: JSON.stringify(finished) });
  assert.equal(v.badge, 'Sous-agent · vérificateur');
  assert.equal(v.title, 'Créer Poste Qualité et vérifier son statut');
  assert.match(v.meta, /^mistral-large-4 · terminé · .+ · 20 appels · 0,10 USD$/);
  assert.deepEqual(v.activity, finished.activity);
  assert.equal(v.report, 'Échec — Le statut enregistré est « En attente » au lieu de « À déclarer ».');
  assert.equal(v.failed, true, 'a failed verdict marks the block');
  assert.equal(v.running, false);
  const en = view('en', { type: 'subagent', status: 'completed', detail: JSON.stringify(Object.assign({}, finished, { profile: 'constructor', verdict: 'passed' })) });
  assert.equal(en.badge, 'Sub-agent · builder');
  assert.match(en.report, /^Passed — /);
  assert.equal(en.failed, false);
});

test('a running run shows its latest steps, no report; an unknown cost is left out', () => {
  const running = Object.assign({}, finished, { status: 'running', verdict: '', summary: '', cost: null, modelCalls: 0 });
  const v = view('fr', { type: 'subagent', status: 'running', detail: JSON.stringify(running) });
  assert.equal(v.running, true);
  assert.match(v.meta, /^mistral-large-4 · en cours · /);
  assert.ok(!/USD/.test(v.meta));
  assert.equal(v.report, '');
  assert.equal(view('fr', { type: 'subagent', status: 'failed', detail: '{not json' }).badge, 'Sous-agent · ');
});

test('the client turns the runs of the conversation into subagent events of the turn', () => {
  const sandbox = { trim: v => String(v ?? '').trim(), now: () => 1792269300000 };
  vm.runInNewContext(backendParts(['subagentProfileLabel', 'subagentEventDetail', 'syncSubagentRuns'], ['SUBAGENT_LABELS']), sandbox);
  const pushed = [];
  let asked = null;
  sandbox.pushProgressEvent = (state, item) => pushed.push(item);
  sandbox.C8O = { assistantAgentBridge: { readSubagentRuns: (conversation, since) => { asked = { conversation, since }; return [
    { runId: 'verify-1', profile: 'verifier', model: 'mistral/mistral-large-4', task: 'Vérifier la liste', startedAt: 1792269100000, status: 'completed',
      output: { ok: true, report: { verdict: 'passed', summary: 'Trois postes.' }, usage: { requests: 6, cost: 0.02 }, durationMs: 19000 }, activity: [{ text: 'navigate /postes' }] },
    { runId: 'verify-2', profile: 'verifier', model: 'mistral/mistral-large-4', task: 'Créer un poste', startedAt: 1792269200000, status: 'running', output: null, activity: [] }
  ]; } } };
  sandbox.syncSubagentRuns({ threadid: 'agent-e50aebd1', runid: '1792269064079-3', language: 'fr', provider: 'convertigo' });
  assert.deepEqual(asked, { conversation: 'agent-e50aebd1', since: 1792269064079 - 5000 }, 'the runs since the start of the turn');
  assert.equal(pushed.length, 2);
  assert.equal(pushed[0].key, 'subagent:verify-1');
  assert.equal(pushed[0].type, 'subagent');
  assert.equal(pushed[0].title, 'Vérificateur · mistral-large-4');
  assert.equal(pushed[0].status, 'completed');
  assert.equal(pushed[0].current, false);
  const detail = JSON.parse(pushed[0].detail);
  assert.equal(detail.verdict, 'passed');
  assert.equal(detail.summary, 'Trois postes.');
  assert.equal(detail.modelCalls, 6);
  assert.equal(detail.cost, 0.02);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.activity)), ['navigate /postes']);
  assert.equal(pushed[1].current, true);
  assert.equal(JSON.parse(pushed[1].detail).cost, null);
  pushed.length = 0;
  sandbox.syncSubagentRuns({ threadid: '', runid: '1-1' });
  assert.equal(pushed.length, 0, 'no conversation, no runs');
});
