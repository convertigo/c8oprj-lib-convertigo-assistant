// The model's reasoning in the Tigo work log: the client keeps it while it streams (the live line of the status dock),
// then attaches it to the step it led to (the next comment or tool call, or the end of the turn); the page shows it
// folded above that step.
// node --test tests/assistant_reasoning_steps.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const BACKEND = ['reasoningCaptured', 'appendReasoningChunk', 'reasoningText', 'finishedReasoning', 'mergeReasoning', 'settleReasoning',
  'holdStepReasoning', 'takeStepReasoning', 'finishTurnReasoning', 'liveReasoning', 'pushProgressEvent', 'markProgressEventsIdle',
  'appendNarrativeEvent', 'runDetailEvent', 'attachReasoningToComment', 'compactLine'];

function backend() {
  let clock = 1000;
  const saved = [];
  const sandbox = {
    trim: v => String(v ?? '').trim(),
    now: () => clock,
    isVibeHarness: p => p === 'convertigo' || p === 'vibe',
    isClaudeHarness: p => p === 'claude',
    lang: () => ({ reasoningStep: 'Réflexion du modèle.' }),
    cleanEventText: v => String(v ?? '').trim(),
    normalizeProgressLine: (_state, v) => String(v ?? ''),
    eventKeyForText: (kind, text) => kind + ':' + text,
    isOpaqueCallId: () => false,
    appendRunDetail: (_state, event) => saved.push(JSON.parse(JSON.stringify(event)))
  };
  vm.runInNewContext(backendParts(BACKEND, ['REASONING_KEEP_HEAD', 'REASONING_KEEP_TAIL', 'RUN_DETAIL_MAX_DETAIL']), sandbox);
  sandbox.tick = ms => { clock += ms; };
  sandbox.saved = saved;
  return sandbox;
}

function vibeState() {
  return { provider: 'convertigo', runid: 'run-1', progressEvents: [] };
}

test('streamed deltas are joined as they come, and a block of 8,000 characters is kept whole', () => {
  const b = backend();
  const state = vibeState();
  b.appendReasoningChunk(state, 'Let me', false);
  b.appendReasoningChunk(state, ' read the spec.', false);
  b.tick(2500);
  b.appendReasoningChunk(state, 'x'.repeat(8000 - 'Let me read the spec.'.length), false);
  const r = b.settleReasoning(state);
  assert.equal(r.chars, 8000);
  assert.equal(r.omitted, 0);
  assert.equal(r.head + r.tail, 'Let me read the spec.' + 'x'.repeat(8000 - 21));
  assert.equal(r.ms, 2500);
  assert.equal(state.reasoningPending, null, 'settled: nothing streams any more');
});

test('a longer block keeps its first 3,000 and last 5,000 characters and counts what is left out', () => {
  const b = backend();
  const state = vibeState();
  const text = 'A'.repeat(3000) + 'B'.repeat(49500) + 'C'.repeat(5000);
  for (let i = 0; i < text.length; i += 700) {
    b.appendReasoningChunk(state, text.substring(i, i + 700), false);
  }
  const r = b.settleReasoning(state);
  assert.equal(r.chars, 57500);
  assert.equal(r.head, 'A'.repeat(3000));
  assert.equal(r.tail, 'C'.repeat(5000));
  assert.equal(r.omitted, 49500);
});

test('Claude Code thinking blocks are kept apart by a blank line; Codex reasoning is not captured', () => {
  const b = backend();
  const state = { provider: 'claude', progressEvents: [] };
  b.appendReasoningChunk(state, 'First block.', true);
  b.appendReasoningChunk(state, 'Second block.', true);
  assert.equal(b.settleReasoning(state).head, 'First block.\n\nSecond block.');
  assert.equal(b.reasoningCaptured({ provider: 'codex' }), false);
  assert.equal(b.reasoningCaptured({ provider: 'convertigo' }), true);
});

test('the reasoning goes to the next comment only, and is saved with it in the run history', () => {
  const b = backend();
  const state = vibeState();
  b.appendReasoningChunk(state, 'Plan the schema first.', false);
  b.holdStepReasoning(state, b.settleReasoning(state));
  b.appendNarrativeEvent(state, 'Je crée le schéma.', 'progress');
  b.appendNarrativeEvent(state, 'Schéma créé.', 'progress');
  assert.equal(state.progressEvents[0].reasoning.head, 'Plan the schema first.');
  assert.equal(state.progressEvents[1].reasoning, undefined);
  assert.equal(b.saved[0].reasoning.head, 'Plan the schema first.');
  assert.equal(b.saved[1].reasoning, undefined, 'a step without reasoning saves no reasoning field');
});

test('a flushed Vibe message gives its reasoning to its own comment, not to a status line written before it', () => {
  const b = backend();
  const state = vibeState();
  b.appendNarrativeEvent(state, "J'utilise le MCP Convertigo.", 'progress');
  b.appendNarrativeEvent(state, 'Je charge le bootstrap du skill.', 'progress');
  b.appendNarrativeEvent(state, 'Puis je lis le guide.', 'progress');
  const reasoning = { head: 'Bootstrap: read convertigo://capabilities.', tail: '', chars: 42, omitted: 0, ms: 300 };
  assert.equal(b.attachReasoningToComment(state, 'Je charge le bootstrap du skill\nPuis je lis le guide.\n', reasoning), true);
  assert.equal(state.progressEvents[0].reasoning, undefined);
  assert.equal(state.progressEvents[1].reasoning.head, 'Bootstrap: read convertigo://capabilities.');
  assert.equal(b.saved[b.saved.length - 1].reasoning.chars, 42, 'saved again with its reasoning');
  assert.equal(b.attachReasoningToComment(state, 'Un texte absent.', reasoning), false, 'no comment found: the caller keeps it for the next step');
});

test('a tool call right after the reasoning takes it; an activity line never does', () => {
  const b = backend();
  const state = vibeState();
  b.appendReasoningChunk(state, 'Check the guide.', false);
  b.holdStepReasoning(state, b.settleReasoning(state));
  b.pushProgressEvent(state, { key: 'activity:x', type: 'activity', text: 'J\'analyse la demande.', status: 'running' });
  b.pushProgressEvent(state, { key: 'tool:1', type: 'tool', text: 'Outil', title: 'mcp_Convertigo.rag_query', status: 'running' });
  b.pushProgressEvent(state, { key: 'tool:1', type: 'tool', text: 'Outil', title: 'mcp_Convertigo.rag_query', status: 'completed' });
  assert.equal(state.progressEvents[0].reasoning, undefined);
  assert.equal(state.progressEvents[1].reasoning.head, 'Check the guide.');
  assert.equal(state.progressEvents[1].status, 'completed', 'the update kept the reasoning of its call');
});

test('the reasoning before the final answer closes the work log as its own step, once', () => {
  const b = backend();
  const state = vibeState();
  b.appendReasoningChunk(state, 'All lots are proven, write the summary.', false);
  state.answerReasoning = b.settleReasoning(state);
  b.finishTurnReasoning(state);
  b.finishTurnReasoning(state);
  const closing = state.progressEvents.filter(e => e.type === 'reasoning');
  assert.equal(closing.length, 1);
  assert.equal(closing[0].key, 'reasoning:final:run-1');
  assert.equal(closing[0].reasoning.head, 'All lots are proven, write the summary.');
  assert.equal(state.answerReasoning, null);
});

test('two blocks for one step are merged, sizes and durations added', () => {
  const b = backend();
  const merged = b.mergeReasoning({ head: 'one', tail: '', chars: 3, omitted: 0, ms: 1000 }, { head: 'two', tail: '', chars: 3, omitted: 0, ms: 500 });
  assert.equal(merged.head, 'one\n\ntwo');
  assert.equal(merged.chars, 6);
  assert.equal(merged.ms, 1500);
  assert.equal(b.mergeReasoning(null, merged), merged);
});

test('the live line is the end of the reasoning streaming now, about one sentence', () => {
  const b = backend();
  const state = vibeState();
  assert.equal(b.liveReasoning(state), null);
  b.appendReasoningChunk(state, 'The schema is created and the transactions run. ' + 'Now the write transactions, then App.declare, which must return writes.postesApply for the generator.', false);
  const live = b.liveReasoning(state);
  assert.ok(live.text.length <= 160, live.text);
  assert.ok(live.text.endsWith('for the generator.'), live.text);
  assert.equal(live.since, 1000);
  b.settleReasoning(state);
  assert.equal(b.liveReasoning(state), null);
});

const METHODS = ['stepReasoning', 'getAgentRunView', 'agentLayoutText', 'agentUiLanguage', 'worklogTrim', 'formatAgentDuration'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function page(language) {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.local = {};
  return p;
}

test('a step shows its reasoning folded: size, duration, then the text with what was left out', () => {
  const p = page('fr');
  const step = { type: 'narrative', text: 'Je crée les pages.', reasoning: { head: 'Start.', tail: 'End.', chars: 57500, omitted: 49500, ms: 74000 } };
  const view = p.stepReasoning(step);
  assert.match(view.label, /^Réflexion · 57\s500 caractères · /);
  assert.match(view.text, /^Start\.\n\n… 49\s500 caractères omis …\n\nEnd\.$/);
  assert.equal(p.stepReasoning(step), view, 'cached on the step');
  assert.equal(p.stepReasoning({ type: 'narrative', text: 'x' }), null);
});

test('a group of tool calls shows the reasoning of its calls; English labels follow the language', () => {
  const p = page('en');
  const view = p.stepReasoning({ type: 'tool', calls: [{ reasoning: { head: 'Run the tests.', tail: '', chars: 14, omitted: 0, ms: 300 } }, {}] });
  assert.equal(view.label, 'Reasoning · 14 characters');
  assert.equal(view.text, 'Run the tests.');
});

test('while the model reasons, the dock shows the end of its reasoning instead of the plan line', () => {
  const p = page('fr');
  p.isAgentBridgeMode = () => true;
  const item = { writing: true, type: 'worklog', time: '20:00', progressNow: 5000, progressStartedAt: 1000, progressItems: [],
    planView: { title: 'Plan', done: 1, total: 3, entries: [{ status: 'in_progress', content: 'Lot 3' }] },
    reasoningLive: { since: 2000, chars: 900, text: 'then the RPCA pages, with the list pattern.' } };
  p.local = { Messages: [item], IsProcessing: true };
  let view = p.getAgentRunView();
  assert.equal(view.dockLine, '… then the RPCA pages, with the list pattern.');
  assert.equal(view.liveSub.split(' · ')[0], '… then the RPCA pages, with the list pattern.');
  assert.match(view.planLine, /^Plan 1\/3 · Lot 3$/);
  item.reasoningLive = null;
  item.progressNow = 6000;
  view = p.getAgentRunView();
  assert.equal(view.dockLine, view.planLine, 'back to the plan once the reasoning is attached');
});
