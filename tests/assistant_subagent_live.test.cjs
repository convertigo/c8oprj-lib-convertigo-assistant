// A sub-agent at work (browser-verify, subagent-run) in the live card of the turn: the client reads what it says it checks
// (activity lines of kind "thought", MCP 0.3.0-beta.20) and its latest steps from its run folder at each read; the page
// shows them in the live card, the bubble of the main agent's reasoning now six lines high.
// node --test tests/assistant_subagent_live.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const backend = {};
vm.runInNewContext(backendParts(['subagentSteps', 'subagentThought', 'subagentEventDetail', 'subagentDurationMs']), Object.assign(backend, {
  trim: v => String(v ?? '').trim(),
  now: () => 100000
}));

const activity = [
  { id: 'N1', at: 1, turn: 0, text: 'Network /convertigo/projects/X/.json: HTTP 200' },
  { id: 'T1', kind: 'thought', at: 2, turn: 1, text: 'I open the login page first.' },
  { id: 'A1', at: 3, turn: 1, text: 'navigate http://localhost:28080/login' },
  { id: 'T2', kind: 'thought', at: 4, turn: 2, text: 'I sign in with the demo account.', reasoning: 'Wrong credentials gave the expected banner. ' + 'x'.repeat(600) + '. The real password comes next.' },
  { id: 'A2', at: 5, turn: 2, text: 'fill ion-input input >> nth=0' },
  { id: 'N2', at: 6, turn: 2, text: 'Network /convertigo/projects/X/.json: HTTP 500' },
  { id: 'A3', at: 7, turn: 2, text: 'click button "Sign in"' }
];

test('the steps of a sub-agent leave out its thoughts and the successful network lines, failures stay', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(backend.subagentSteps(activity))), [
    'navigate http://localhost:28080/login', 'fill ion-input input >> nth=0', 'Network /convertigo/projects/X/.json: HTTP 500', 'click button "Sign in"']);
});

test('its latest thought: the end of its reasoning, then what it says it checks, the newest last', () => {
  const thought = backend.subagentThought(activity);
  assert.equal(thought.at, 4);
  assert.ok(thought.text.endsWith('The real password comes next.\nI sign in with the demo account.'), thought.text);
  assert.ok(thought.text.length <= 700);
  assert.ok(!thought.text.startsWith('Wrong credentials'), 'only the end of a long reasoning');
  assert.deepEqual(JSON.parse(JSON.stringify(backend.subagentThought([{ id: 'T1', kind: 'thought', at: 9, text: 'Only what it says.' }]))), { text: 'Only what it says.', at: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(backend.subagentThought([{ id: 'A1', text: 'click' }]))), { text: '', at: 0 });
});

test('the block detail carries the thought while the run goes on, never once it is over', () => {
  const run = { runId: 'verify-20261113-145516-3fff203f', profile: 'verifier', model: 'mistral/mistral-large-4', task: 'Sign in', startedAt: 1000, activity };
  const running = JSON.parse(backend.subagentEventDetail(Object.assign({ status: 'running' }, run)));
  assert.match(running.thought, /I sign in with the demo account\.$/);
  assert.equal(running.thoughtAt, 4);
  assert.deepEqual(running.activity.slice(-1), ['click button "Sign in"']);
  const done = JSON.parse(backend.subagentEventDetail(Object.assign({ status: 'completed', output: { durationMs: 5000, report: { verdict: 'passed' } } }, run)));
  assert.equal(done.thought, '');
});

const METHODS = ['getAgentRunView', 'getSubagentView', 'subagentShots', 'subagentProfileLabel', 'agentUiText', 'agentLayoutText', 'agentUiLanguage',
  'getAgentSandboxView', 'agentSandboxText', 'worklogTrim', 'formatAgentDuration', 'formatAgentNumber', 'formatAgentTokens', 'formatAgentCost'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function runView(language, subagentStatus, thought) {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.isAgentBridgeMode = () => true;
  const detail = { runId: 'verify-1', profile: 'verifier', model: 'mistral/mistral-large-4', task: 'Sign in', status: subagentStatus, durationMs: 42000,
    activity: ['navigate http://localhost:28080/login', 'fill ion-input input >> nth=0', 'click button "Sign in"'], thought: thought || '' };
  const item = { writing: true, type: 'worklog', time: '15:00', progressNow: 5000, progressStartedAt: 1000,
    planView: { title: 'Plan', done: 1, total: 3, entries: [{ status: 'in_progress', content: 'Verify the login' }] },
    progressItems: [{ type: 'subagent', status: subagentStatus, current: subagentStatus === 'running', text: 'Sign in', detail: JSON.stringify(detail) }] };
  p.local = { Messages: [item], IsProcessing: true };
  return JSON.parse(JSON.stringify(p.getAgentRunView()));
}

test('a sub-agent at work takes the live card: its title, what it says it checks and its two latest steps', () => {
  const view = runView('fr', 'running', 'I sign in with the demo account.');
  assert.equal(view.liveTitle, 'Sous-agent vérificateur au travail · mistral-large-4');
  assert.equal(view.subagent.thought, 'I sign in with the demo account.');
  assert.deepEqual(view.subagent.steps, ['fill ion-input input >> nth=0', 'click button "Sign in"']);
  assert.equal(view.liveSub, '', 'no grey line under it');
  assert.equal(view.dockLine, view.planLine, 'the dock keeps the plan');
  assert.equal(runView('en', 'running', '').liveTitle, 'Sub-agent verifier at work · mistral-large-4');
  assert.equal(runView('en', 'running', '').subagent.thought, '');
  const over = runView('fr', 'completed', 'ignored');
  assert.equal(over.subagent, null, 'a finished run leaves the card');
  assert.equal(over.liveTitle, "Tigo réfléchit à l'étape suivante");
});

test('the page wires the sub-agent into the live card, the bubble six lines high, the title in four languages', () => {
  const yaml = read('_c8oProject/mobilePages/Page.yaml');
  assert.match(yaml, /'' is-subagent'' : ''''\)'/);
  assert.match(yaml, /↓HasSubagent \[[^\]]+\]: \n[^\n]*\n {20}directiveName: If\n[\s\S]{0,260}script:this\.getAgentRunView\(\)\.subagent\n/);
  assert.match(yaml, /attrName: '\[innerText\]'\n[\s\S]{0,300}script:this\.getAgentRunView\(\)\.subagent\.thought\n/);
  assert.match(yaml, /directiveItemName: subStepText\n[\s\S]{0,300}script:this\.getAgentRunView\(\)\.subagent\.steps\n/);
  assert.match(yaml, /\.agent-live-thought \{[^}]*max-height: 114px;/);
  assert.match(yaml, /\.agent-live-subagent-step \{[^}]*white-space: nowrap;/);
  const languages = yaml.match(/\t\t\t(fr|en|it|es): \{ turn: [^\n]+/g);
  assert.equal(languages.length, 4);
  for (const line of languages) {
    assert.match(line, / subagentWorking: "[^"]*\{profile\}[^"]*"/, line.substring(3, 5));
  }
});
