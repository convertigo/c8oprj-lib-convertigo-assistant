// The model's reasoning in Tigo: the client keeps it while it streams (the thinking bubble of the conversation), then
// attaches it to the step it led to (the next comment or tool call, or the end of the turn); the work log shows it as
// an accent line with its duration and first sentence, the latest one open, and "show all" reads a long block whole.
// node --test tests/assistant_reasoning_steps.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const BACKEND = ['reasoningCaptured', 'appendReasoningChunk', 'reasoningText', 'finishedReasoning', 'mergeReasoning', 'settleReasoning',
  'holdStepReasoning', 'takeStepReasoning', 'finishTurnReasoning', 'liveReasoning', 'pushProgressEvent', 'markProgressEventsIdle',
  'appendNarrativeEvent', 'runDetailEvent', 'attachReasoningToComment', 'compactLine', 'runDetailsFile', 'reasoningFullFile',
  'keepFullReasoning', 'flushFullReasoning', 'fullReasoningParts'];

// A java.io.File stand-in: paths only, the files themselves live in a map.
class FakeFile {
  constructor(parent, name) { this.path = name === undefined ? String(parent) : (parent.path || String(parent)) + '/' + name; }
  getParentFile() { return new FakeFile(this.path.substring(0, this.path.lastIndexOf('/'))); }
  getPath() { return this.path; }
  toString() { return this.path; }
}

function backend() {
  let clock = 1000;
  const saved = [];
  const files = new Map();
  const sandbox = {
    File: FakeFile,
    trim: v => String(v ?? '').trim(),
    now: () => clock,
    isVibeHarness: p => p === 'convertigo' || p === 'vibe',
    isClaudeHarness: p => p === 'claude',
    lang: () => ({ reasoningStep: 'Réflexion du modèle.' }),
    cleanEventText: v => String(v ?? '').trim(),
    normalizeProgressLine: (_state, v) => String(v ?? ''),
    eventKeyForText: (kind, text) => kind + ':' + text,
    isOpaqueCallId: () => false,
    appendRunDetail: (_state, event) => saved.push(JSON.parse(JSON.stringify(event))),
    appendTextFile: (file, text) => {
      if (sandbox.failWrites) throw new Error('disk full');
      files.set(file.path, (files.get(file.path) || '') + text);
    }
  };
  vm.runInNewContext(backendParts(BACKEND, ['REASONING_KEEP_HEAD', 'REASONING_KEEP_TAIL', 'RUN_DETAIL_MAX_DETAIL', 'REASONING_FULL_MAX',
    'REASONING_FULL_FLUSH', 'REASONING_LIVE_CHARS']), sandbox);
  sandbox.tick = ms => { clock += ms; };
  sandbox.saved = saved;
  sandbox.files = files;
  return sandbox;
}

function vibeState() {
  return { provider: 'convertigo', runid: 'run-1', progressEvents: [], conversationFile: '/w/conv/agent-1/conversation.json' };
}

test('streamed deltas are joined as they come, and a block of 8,000 characters is kept whole, with no file', () => {
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
  assert.equal(r.full, undefined, 'nothing left out: the step has the whole text');
  assert.equal(b.files.size, 0);
  assert.equal(state.reasoningPending, null, 'settled: nothing streams any more');
});

test('a longer block keeps its first 3,000 and last 5,000 characters, and its whole text beside the run', () => {
  const b = backend();
  const state = vibeState();
  const text = 'A'.repeat(3000) + 'B'.repeat(49500) + 'C'.repeat(5000);
  for (let i = 0; i < text.length; i += 700) {
    b.appendReasoningChunk(state, text.substring(i, i + 700), false);
  }
  assert.ok(b.files.get('/w/conv/agent-1/runs/run-1.reasoning/r1.txt').length < text.length, 'written by pieces while it streams');
  const r = b.settleReasoning(state);
  assert.equal(r.chars, 57500);
  assert.equal(r.head, 'A'.repeat(3000));
  assert.equal(r.tail, 'C'.repeat(5000));
  assert.equal(r.omitted, 49500);
  assert.deepEqual(JSON.parse(JSON.stringify(r.full)), [{ run: 'run-1', f: 'r1' }]);
  assert.equal(b.files.get('/w/conv/agent-1/runs/run-1.reasoning/r1.txt'), text, 'the whole block, flushed when it settles');
  b.appendReasoningChunk(state, 'D'.repeat(9000), false);
  assert.equal(b.settleReasoning(state).full[0].f, 'r2', 'the next long block of the run gets its own file');
});

test('without a run file (no run id yet, or a write that fails) a long block keeps only its start and end', () => {
  const b = backend();
  const pending = { provider: 'convertigo', runid: 'pending', progressEvents: [], conversationFile: '/w/c/conversation.json' };
  b.appendReasoningChunk(pending, 'x'.repeat(9000), false);
  const r = b.settleReasoning(pending);
  assert.equal(r.omitted, 1000);
  assert.equal(r.full, undefined);
  const failing = backend();
  failing.failWrites = true;
  const state = vibeState();
  failing.appendReasoningChunk(state, 'y'.repeat(9000), false);
  assert.equal(failing.settleReasoning(state).full, undefined, 'a file that cannot be written is never pointed at');
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

test('two blocks for one step are merged, sizes and durations added; a long one keeps where its whole text is', () => {
  const b = backend();
  const merged = b.mergeReasoning({ head: 'one', tail: '', chars: 3, omitted: 0, ms: 1000 }, { head: 'two', tail: '', chars: 3, omitted: 0, ms: 500 });
  assert.equal(merged.head, 'one\n\ntwo');
  assert.equal(merged.chars, 6);
  assert.equal(merged.ms, 1500);
  assert.equal(merged.full, undefined);
  assert.equal(b.mergeReasoning(null, merged), merged);
  const long = { head: 'A'.repeat(3000), tail: 'C'.repeat(5000), chars: 20000, omitted: 12000, ms: 9000, full: [{ run: 'run-1', f: 'r1' }] };
  const withShort = b.mergeReasoning({ head: 'Short first.', tail: '', chars: 12, omitted: 0, ms: 100 }, long);
  assert.deepEqual(JSON.parse(JSON.stringify(withShort.full)), [{ t: 'Short first.' }, { run: 'run-1', f: 'r1' }]);
  const lost = b.mergeReasoning({ head: 'x', tail: 'y', chars: 9000, omitted: 8998, ms: 1 }, long);
  assert.equal(lost.full, undefined, 'a long block without file: its middle is lost, no "show all"');
});

test('the thinking bubble gets the last lines of the reasoning streaming now, without markdown emphasis', () => {
  const b = backend();
  const state = vibeState();
  assert.equal(b.liveReasoning(state), null);
  b.appendReasoningChunk(state, '**Planning the schema**\n\nThe schema is created and the transactions run.\n\n\nNow the write transactions, then App.declare.', false);
  let live = b.liveReasoning(state);
  assert.equal(live.text, 'Planning the schema\nThe schema is created and the transactions run.\nNow the write transactions, then App.declare.');
  assert.equal(live.since, 1000);
  b.appendReasoningChunk(state, ' ' + 'Then the pages of each lot with the list pattern. '.repeat(30) + 'Last words here.', false);
  live = b.liveReasoning(state);
  assert.ok(live.text.length <= 700, live.text.length);
  assert.ok(live.text.endsWith('Last words here.'), live.text);
  assert.ok(live.text.startsWith('Then the pages'), 'starts at a sentence: ' + live.text.substring(0, 40));
  b.settleReasoning(state);
  assert.equal(b.liveReasoning(state), null);
});

const METHODS = ['stepReasoning', 'reasoningGist', 'isLatestReasoningStep', 'toggleReasoningFull', 'getAgentRunView', 'getAgentSandboxView',
  'agentSandboxText', 'agentLayoutText', 'agentUiLanguage', 'worklogTrim', 'formatAgentDuration'];
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

test('a folded reasoning shows its duration and first sentence; its size is in the tooltip', () => {
  const p = page('fr');
  const step = { type: 'narrative', text: 'Je crée les pages.', reasoning: { head: "Je vérifie d'abord le connecteur SQL. Puis les pages.", tail: 'End.', chars: 57500, omitted: 49500, ms: 74000 } };
  const view = p.stepReasoning(step);
  assert.equal(view.label, 'Réflexion · 1 min 14 s');
  assert.equal(view.gist, "Je vérifie d'abord le connecteur SQL…");
  assert.match(view.title, /^Réflexion · 1 min 14 s · 57\s500 caractères$/);
  assert.match(view.text, /^Je vérifie d'abord le connecteur SQL\. Puis les pages\.\n\n… 49\s500 caractères omis …\n\nEnd\.$/);
  assert.equal(view.more, '', 'no file for its whole text: start and end with the marker only');
  assert.equal(view.fullParts, null);
  assert.equal(p.stepReasoning(step), view, 'cached on the step');
  assert.equal(p.stepReasoning({ type: 'narrative', text: 'x' }), null);
});

test('a group of tool calls shows the reasoning of its calls; English labels follow the language', () => {
  const p = page('en');
  const view = p.stepReasoning({ type: 'tool', calls: [{ reasoning: { head: 'Run the tests.', tail: '', chars: 14, omitted: 0, ms: 300 } }, {}] });
  assert.equal(view.label, 'Reasoning', 'under a second: no duration');
  assert.equal(view.gist, 'Run the tests.', 'a single sentence keeps its full stop');
  assert.equal(view.title, 'Reasoning · 14 characters');
  assert.equal(view.text, 'Run the tests.');
});

test('the first sentence leaves markdown out and is cut at a word near 110 characters', () => {
  const p = page('fr');
  assert.equal(p.reasoningGist('**Inspecting the project tree**\n\nThe user wants the sequences.'), 'Inspecting the project tree…');
  assert.equal(p.reasoningGist('  - `project-list` first, then the trees.'), 'project-list first, then the trees.');
  const long = p.reasoningGist('The user asks which projects are open in the Studio and wants me to count the sequences of each project and to compare them all');
  assert.ok(long.length <= 111 && long.endsWith('…') && !long.endsWith(' …'), long);
  assert.equal(p.reasoningGist('Which projects are open in the Studio? Then count.'), 'Which projects are open in the Studio?', 'a question keeps its mark');
  assert.equal(p.reasoningGist(''), '');
});

test('"show all" reads the whole text of a long reasoning once, then switches back to its start and end', async () => {
  const p = page('fr');
  const calls = [];
  p.local = { Conversation: 'agent-1' };
  p.getAgentContextUserId = () => 'studio';
  p.c8o = { callJsonObject: (name, params) => { calls.push({ name, params }); return { async: () => Promise.resolve({ response: { ok: true, texts: { 'run-1/r1': '  The whole long text.  ' } } }) }; } };
  const step = { type: 'tool', calls: [
    { reasoning: { head: 'Short.', tail: '', chars: 6, omitted: 0, ms: 100 } },
    { reasoning: { head: 'Start', tail: 'End', chars: 20000, omitted: 19992, ms: 9000, full: [{ run: 'run-1', f: 'r1' }] } }] };
  let view = p.stepReasoning(step);
  assert.equal(view.more, 'Voir tout · 20 006 caractères'.replace(' ', view.more.charAt(14)));
  p.toggleReasoningFull(step);
  assert.equal(p.stepReasoning(step).more, 'Chargement…');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'lib_ConvertigoAssistant.AgentReasoningText');
  assert.deepEqual(JSON.parse(calls[0].params.parts), [{ run: 'run-1', f: 'r1' }], 'only the files are asked for');
  assert.equal(calls[0].params.threadid, 'agent-1');
  view = p.stepReasoning(step);
  assert.equal(view.text, 'Short.\n\nThe whole long text.');
  assert.equal(view.more, 'Réduire');
  p.toggleReasoningFull(step);
  assert.match(p.stepReasoning(step).text, /^Short\.\n\n—\n\nStart\n\n… /, 'back to the start and end, no second read');
  assert.equal(calls.length, 1);
  p.c8o = { callJsonObject: () => ({ async: () => Promise.resolve({ response: { ok: true, texts: {} } }) }) };
  const missing = { type: 'narrative', reasoning: { head: 'S', tail: 'E', chars: 9000, omitted: 8998, ms: 1, full: [{ run: 'run-1', f: 'r9' }] } };
  p.toggleReasoningFull(missing);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(p.stepReasoning(missing).more, 'Texte complet indisponible, réessayer');
});

test('the latest reasoning of a turn is the one open by default', () => {
  const p = page('fr');
  const first = { type: 'narrative', reasoning: { head: 'a', tail: '', chars: 1, omitted: 0, ms: 0 } };
  const plain = { type: 'narrative', text: 'no reasoning' };
  const last = { type: 'tool', calls: [{ reasoning: { head: 'b', tail: '', chars: 1, omitted: 0, ms: 0 } }] };
  const item = { writing: true, progressNow: 1, progressItems: [first, plain, last, { type: 'narrative', text: 'after' }] };
  assert.equal(p.isLatestReasoningStep(item, last), true);
  assert.equal(p.isLatestReasoningStep(item, first), false);
  assert.equal(p.isLatestReasoningStep(item, plain), false);
  const next = { type: 'reasoning', reasoning: { head: 'c', tail: '', chars: 1, omitted: 0, ms: 0 } };
  item.progressItems = item.progressItems.concat([next]);
  item.progressNow = 2;
  assert.equal(p.isLatestReasoningStep(item, last), false, 'a newer reasoning folds the previous one');
  assert.equal(p.isLatestReasoningStep(item, next), true);
});

test('while the model reasons, the bubble shows it and the dock keeps the plan: nothing shows it twice', () => {
  const p = page('fr');
  p.isAgentBridgeMode = () => true;
  const item = { writing: true, type: 'worklog', time: '20:00', progressNow: 5000, progressStartedAt: 1000, progressItems: [],
    planView: { title: 'Plan', done: 1, total: 3, entries: [{ status: 'in_progress', content: 'Lot 3' }] },
    reasoningLive: { since: 2000, chars: 900, text: 'The RPCA pages next.\nthen the list pattern.' } };
  p.local = { Messages: [item], IsProcessing: true };
  let view = p.getAgentRunView();
  assert.equal(view.thought, 'The RPCA pages next.\nthen the list pattern.');
  assert.equal(view.liveSub, '', 'the bubble replaces the grey line');
  assert.match(view.planLine, /^Plan 1\/3 · Lot 3$/);
  assert.equal(view.dockLine, view.planLine);
  item.reasoningLive = null;
  item.progressNow = 6000;
  view = p.getAgentRunView();
  assert.equal(view.thought, '');
  assert.equal(view.liveSub, 'Étape du plan : Lot 3', 'back to the grey line once the reasoning folds into its step');
  assert.equal(view.dockLine, view.planLine);
});

test('the page wires the bubble, the open latest reasoning, the bulb line and "show all"; every text in four languages', () => {
  const yaml = read('_c8oProject/mobilePages/Page.yaml');
  assert.match(yaml, /MobileSmartSourceType: 'script:''agent-live'' \+ \(this\.getAgentRunView\(\)\.thought \? '' is-thinking'' : ''''\)'/);
  assert.match(yaml, /↓HasThought \[[^\]]+\]: \n[^\n]*\n {20}directiveName: If\n[\s\S]{0,260}script:this\.getAgentRunView\(\)\.thought\n {20}↓Thought /);
  assert.match(yaml, /attrName: '\[open\]'\n[\s\S]{0,400}script:this\.isLatestReasoningStep\(item, step\)\n {24}↓Summary /);
  assert.match(yaml, /"IconName":"plain:bulb-outline"/);
  assert.match(yaml, /page\.toggleReasoningFull\(props\.stack\.root\.scope\.step\);/);
  assert.match(yaml, /\.agent-live-thought \{[^}]*font-style: italic;[^}]*max-height: 76px;/);
  assert.match(yaml, /attrName: '\[innerText\]'\n[\s\S]{0,300}script:this\.getAgentRunView\(\)\.thought\n/, 'line breaks as br, no template white space');
  assert.match(yaml, /@media \(prefers-reduced-motion: reduce\) \{ \.agent-live\.is-thinking \{ animation: none; \} \}/);
  assert.match(yaml, /\.agent-worklog-reasoning-body \{[^}]*color: var\(--modern-text, #0f172a\);[^}]*max-height: min\(60vh, 480px\);/);
  const languages = yaml.match(/\t\t\t(fr|en|it|es): \{ turn: [^\n]+/g);
  assert.equal(languages.length, 4);
  for (const line of languages) {
    for (const key of ['reasoning', 'reasoningChars', 'reasoningOmitted', 'reasoningShowAll', 'reasoningShowLess', 'reasoningLoading', 'reasoningUnavailable']) {
      assert.match(line, new RegExp(' ' + key + ': "[^"]+"'), line.substring(3, 5) + ' ' + key);
    }
  }
  const project = read('c8oProject.yaml');
  assert.match(project, /↓AgentReasoningText \[sequences\.GenericSequence\]: 🗏 sequences\/AgentReasoningText\.yaml\n/);
  const sequence = read('_c8oProject/sequences/AgentReasoningText.yaml');
  assert.match(sequence, /C8O\.assistantAgentBridge\.reasoningText\(\{/);
  for (const variable of ['threadid', 'parts', 'userId']) {
    assert.match(sequence, new RegExp('↓' + variable + ' \\[variables\\.RequestableVariable-\\d+\\]: \\n'));
  }
});

test('the whole text is read only from the caller\'s own conversation folder, by strict file names', () => {
  const source = read('js/agent_bridge_client.js');
  const start = source.indexOf('C8O.assistantAgentBridge.reasoningText = function');
  const body = source.substring(start, source.indexOf('\n  };\n', start));
  assert.match(body, /readConversationRecord\(resolveWorkspaceRoot\(options\), normalizeUserKey\(options\.userId\), threadid, options\.provider\)/);
  assert.doesNotMatch(body, /readState\(/, 'never another session\'s state');
  assert.match(body, /\/\^r\[0-9\]\{1,6\}\$\/\.test\(id\)/);
  assert.match(body, /i < 50/);
});
