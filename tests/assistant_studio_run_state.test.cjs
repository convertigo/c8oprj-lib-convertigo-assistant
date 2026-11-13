// The web and desktop Studio follow the agent while it works: the Tigo panel tells it when a turn starts and when it ends
// (convertigo:assistant-run), once each, and only there (not in the Eclipse Studio nor in No Code Studio).
// node --test tests/assistant_studio_run_state.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');

function make({ web = true, framed = true } = {}) {
  const start = page.indexOf('        \tpublic notifyStudioAgentRun(runid, running) {');
  const end = page.indexOf('        \tpublic endAgentHostTurn(runid) {');
  assert.ok(start > 0 && end > start);
  const posted = [];
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  const win = {};
  win.parent = framed ? parent : win;
  const sandbox = { window: win, document: { documentElement: { classList: { contains: c => web && c === 'tigo-studio-web' } } } };
  const js = ts.transpileModule('class P {\n' + page.slice(start, end) + '\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  const P = vm.runInNewContext(js + '\nP;', sandbox);
  const p = new P();
  p.local = { Conversation: 'agent-1' };
  return { p, posted };
}

test('a turn that starts and ends is told to the web Studio once each', () => {
  const { p, posted } = make();
  assert.equal(p.notifyStudioAgentRun('run-1', true), true);
  assert.equal(p.notifyStudioAgentRun('run-1', true), false, 'the next reads of the same running turn say nothing');
  assert.equal(p.notifyStudioAgentRun('run-1', false), true);
  assert.equal(p.notifyStudioAgentRun('run-1', false), false);
  assert.deepEqual(posted.map(x => JSON.parse(JSON.stringify(x.message))), [
    { type: 'convertigo:assistant-run', running: true, runid: 'run-1', conversation: 'agent-1' },
    { type: 'convertigo:assistant-run', running: false, runid: 'run-1', conversation: 'agent-1' }
  ]);
  assert.equal(p.notifyStudioAgentRun('', true), false, 'no run id');
});

test('only in the web Studio: not in the Eclipse Studio, not outside a frame', () => {
  const eclipse = make({ web: false });
  assert.equal(eclipse.p.notifyStudioAgentRun('run-1', true), false);
  assert.equal(eclipse.posted.length, 0);
  const alone = make({ framed: false });
  assert.equal(alone.p.notifyStudioAgentRun('run-1', true), false);
  assert.equal(alone.posted.length, 0);
});

test('the read of a turn calls it with the running state', () => {
  assert.match(page, /page\.local\.RunID = "" \+ runid;\n\s+\}\n\s+\/\/ The web Studio follows the agent while a turn runs[^\n]*\n\s+if \(page\.notifyStudioAgentRun\) \{ page\.notifyStudioAgentRun\(runid, !\(isCompleted \|\| isFailed\)\); \}/);
});
