// PipelineCrm4 run (Mistral Large 4 through Vibe, 13/11): the Stop button changed nothing while the agent kept calling
// tools, and once its vibe-acp process was killed the panel stayed on "I am checking that the task is still running".
// - Stop sent no conversation id: its threadid variable had a malformed source (a missing "}"), which the Mobile Builder
//   drops; the server then looked for a running conversation of the Studio's current project only, and the agent had
//   created that project during the turn (its conversation has none): "not_found", nothing stopped.
// - A read that found the agent process exited cleared the failed-read count before counting itself: the turn never
//   reached its limit and stayed "in progress" for ever.
// node --test tests/assistant_stop_running_turn.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, read, backendParts } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const client = read('js/agent_bridge_client.js');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const texts = { closedEarly: 'The task stopped before completion.', bridgeStateRecover: 'I am checking that the task is still running.',
  bridgeProcessLost: 'The task was interrupted. You can send a new request in this conversation.', thinking: 'Thinking' };

function assignedFunction(name) {
  const ast = ts.createSourceFile('bridge.js', client, ts.ScriptTarget.Latest, true);
  let found;
  (function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === name) found = node.right.getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(found, name);
  return found;
}

test('every smart source of the project is valid JSON: the Mobile Builder drops a malformed one without a word', () => {
  const root = path.resolve(__dirname, '..', '_c8oProject');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file); else if (entry.name.endsWith('.yaml')) files.push(file);
    }
  })(root);
  const broken = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const match = /MobileSmartSourceType: ('?)source:(.*)$/.exec(line);
      if (!match) return;
      let json = match[2];
      if (match[1] === "'") json = json.replace(/'$/, '').replace(/''/g, "'");
      try { JSON.parse(json); } catch (e) { broken.push(path.relative(root, file) + ':' + (i + 1)); }
    });
  }
  assert.deepEqual(broken, []);
});

test('Stop sends the conversation whose turn runs, even after local.Conversation was reset', () => {
  const block = page.slice(page.indexOf('    ↓StopRequest [ngx.components.UIControlEvent-1781872836648]: '));
  const variable = /↓threadid \[ngx\.components\.UIControlVariable-1781872839640\]: \n[\s\S]*?MobileSmartSourceType: script:(.*)\n/.exec(block);
  assert.ok(variable, 'the threadid variable of CloseConversation is a script');
  const threadid = local => vm.runInNewContext('(function () { return ' + variable[1] + '; }).call(self)', { self: { local } });
  assert.equal(threadid({ Conversation: '', AgentRunConversation: 'agent-crm' }), 'agent-crm', 'a reset local.Conversation');
  assert.equal(threadid({ Conversation: 'agent-new', AgentRunConversation: 'agent-crm' }), 'agent-crm', 'another conversation opened');
  assert.equal(threadid({ Conversation: 'agent-open' }), 'agent-open', 'before the first read of the turn');
  assert.equal(threadid(undefined), '');
});

test('the reads of a turn keep its conversation while it runs and clear it when it ends', () => {
  const line = /\n\s+(page\.local\.AgentRunConversation = [^\n]+)\n/.exec(page);
  assert.ok(line, 'AddAssistantMessages keeps the running conversation');
  const run = (status, state, response, local) => {
    const page = { local };
    vm.runInNewContext(line[1], { page, isCompleted: status === 'completed', isFailed: ['failed', 'cancelled', 'expired'].includes(status), state, response, String });
    return page.local.AgentRunConversation;
  };
  assert.equal(run('in_progress', { threadid: 'agent-crm' }, {}, { Conversation: '' }), 'agent-crm');
  assert.equal(run('in_progress', {}, { threadid: 'agent-crm' }, { Conversation: 'agent-other' }), 'agent-crm');
  assert.equal(run('in_progress', {}, {}, { Conversation: 'agent-open' }), 'agent-open');
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.equal(run(status, { threadid: 'agent-crm' }, {}, { AgentRunConversation: 'agent-crm' }), '', status);
  }
});

// closeConversation run in a sandbox: the conversation records of the user, the saved state store (the page's reads
// write it meanwhile), and the Bridge.
function stopFixture({ records = [], stored = null, sessionCopy = null, interrupt = { ok: true, status: 'interrupted' } } = {}) {
  const calls = [], lookups = [], transcript = [], removed = [];
  let store = clone(stored), locked = false;
  const active = ['starting', 'queued', 'running', 'in_progress'];
  const sandbox = {
    bridgeCallerRefusal: () => null, withCallerUserId: o => o || {}, normalizeThreadId: v => String(v || '').trim(),
    normalizeConversationId: v => String(v || ''), resolveWorkspaceRoot: () => '/ws', normalizeUserKey: v => v || 'studio',
    normalizeSkillProfile: () => 'all', trim: v => String(v == null ? '' : v).trim(),
    latestActiveConversationRecord(_root, _user, project, provider) {
      lookups.push({ project, provider });
      return records.find(r => active.includes(r.status) && (!provider || r.provider === provider) &&
        (!project || r.primaryProject === project || (r.projectNames || []).includes(project))) || null;
    },
    readState: id => store && store.threadid === id ? clone(sessionCopy || store) : null,
    readConversationRecord: () => null, createState: () => { throw new Error('unexpected createState'); }, ensureState: v => v,
    markCancellationRequested: id => calls.push('cancel:' + id),
    bridgeCall(_state, sequence, params) { calls.push(sequence + ':' + params.handle); return sequence === 'agent_interrupt' ? interrupt : { ok: true, status: 'closed' }; },
    providerSequence: (_provider, action) => 'agent_vibe_' + action,
    latestSavedState: state => { assert.equal(locked, true, 'read under the readers lock'); return store ? clone(store) : state; },
    lockConversationRead: () => { locked = true; return 'held'; }, unlockConversationRead: held => { if (held === 'held') locked = false; },
    markProgressEventsIdle() {}, lang: () => texts,
    appendTranscript: (_state, role, content) => transcript.push({ role, content }), now: () => 5000,
    saveState: state => { assert.equal(locked, true, 'saved under the readers lock'); store = clone(state); }, removeState: id => removed.push(id), setBuffer() {},
    publicConversation: v => v, readJsonFile: () => ({}), File: function (v) { this.path = v; }
  };
  vm.runInNewContext(backendParts(['recordTurnStopped', 'isTerminalStatus']) + '\nvar closeConversation = ' + assignedFunction('C8O.assistantAgentBridge.closeConversation') + ';', sandbox);
  return { close: options => sandbox.closeConversation(options), calls, lookups, transcript, removed, saved: () => store, locked: () => locked };
}

const runningCrm = () => ({ threadid: 'agent-crm', handle: 'agent-crm', provider: 'convertigo', status: 'in_progress', runid: 'run-4',
  cursor: 1505, answer: '', progressEvents: [], conversationFile: '/ws/agent-crm/conversation.json' });

test('without a conversation id, Stop finds the running turn of the user in another project or in none', () => {
  const records = [
    { conversationId: 'agent-old', provider: 'convertigo', primaryProject: 'PipelineCrm4', status: 'completed' },
    { conversationId: 'agent-crm', provider: 'convertigo', primaryProject: '', projectNames: [], status: 'in_progress' }
  ];
  const f = stopFixture({ records, stored: runningCrm() });
  const result = f.close({ provider: 'convertigo', targetProject: 'PipelineCrm4', projectName: 'PipelineCrm4', userId: 'studio' });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.threadid, 'agent-crm');
  assert.deepEqual(f.lookups, [{ project: 'PipelineCrm4', provider: 'convertigo' }, { project: '', provider: 'convertigo' }]);
  assert.deepEqual(f.calls, ['cancel:agent-crm', 'agent_interrupt:agent-crm']);
  assert.equal(f.saved().status, 'cancelled');

  const project = stopFixture({ records: [...records, { conversationId: 'agent-p', provider: 'convertigo', primaryProject: 'PipelineCrm4', status: 'in_progress' }],
    stored: Object.assign(runningCrm(), { threadid: 'agent-p', handle: 'agent-p' }) });
  assert.equal(project.close({ provider: 'convertigo', targetProject: 'PipelineCrm4' }).threadid, 'agent-p', 'the current project first');
  assert.equal(project.lookups.length, 1);

  const other = stopFixture({ records, stored: runningCrm() });
  assert.equal(other.close({ provider: 'codex', targetProject: 'PipelineCrm4' }).status, 'not_found', 'the same provider only');
  assert.deepEqual(other.calls, []);
});

test('an interrupted turn ends as stopped on the latest saved state, not on the copy read before the wait', () => {
  const reader = Object.assign(runningCrm(), { cursor: 1620, progressLog: 'recorded by the reads during the interrupt wait' });
  const f = stopFixture({ stored: reader, sessionCopy: runningCrm() });
  const result = f.close({ threadid: 'agent-crm' });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.contextKept, true);
  const saved = f.saved();
  assert.equal(saved.status, 'cancelled');
  assert.equal(saved.cursor, 1620);
  assert.equal(saved.progressLog, reader.progressLog);
  assert.equal(saved.answer, texts.closedEarly);
  assert.equal(saved.answerIsFinal, true);
  assert.deepEqual(f.transcript, [{ role: 'assistant', content: texts.closedEarly }]);
  assert.deepEqual(f.removed, [], 'the agent and its context are kept');
  assert.equal(f.locked(), false, 'the readers lock is released');
});

test('a turn still running after the interrupt wait closes the agent and ends as stopped', () => {
  for (const interrupt of [{ ok: false, status: 'timeout' }, { ok: false, status: 'exited' }]) {
    const f = stopFixture({ stored: runningCrm(), interrupt });
    const result = f.close({ threadid: 'agent-crm' });
    assert.deepEqual(f.calls, ['cancel:agent-crm', 'agent_interrupt:agent-crm', 'agent_vibe_close:agent-crm'], interrupt.status);
    assert.equal(result.status, 'closed');
    assert.equal(f.saved().status, 'cancelled');
    assert.equal(f.saved().answer, texts.closedEarly);
    assert.deepEqual(f.removed, ['agent-crm']);
  }
});

test('a turn the reads already ended keeps its end', () => {
  const lost = Object.assign(runningCrm(), { status: 'failed', answer: texts.bridgeProcessLost, answerIsFinal: true });
  const f = stopFixture({ stored: lost, sessionCopy: runningCrm(), interrupt: { ok: false, status: 'exited' } });
  f.close({ threadid: 'agent-crm' });
  assert.equal(f.saved().status, 'failed');
  assert.equal(f.saved().answer, texts.bridgeProcessLost);
  assert.deepEqual(f.transcript, []);
});

test('a stopped turn whose agent was closed is read back as stopped, not as running', () => {
  const saved = [];
  const sandbox = { createState: options => ({ threadid: options.threadid, status: options.recordStatus, answer: '' }), lang: () => texts,
    appendProgress(state, text) { state.progressLog = (state.progressLog || '') + text; }, now: () => 1, saveState: s => saved.push(clone(s)),
    sanitizeProgressLog: v => v, trim: v => String(v == null ? '' : v).trim() };
  vm.runInNewContext(backendParts(['recoverState']), sandbox);
  const stopped = sandbox.recoverState({ recordStatus: 'cancelled' }, 'agent-crm');
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.answer, texts.closedEarly);
  assert.equal(stopped.answerIsFinal, true);
  assert.equal(sandbox.recoverState({ recordStatus: 'in_progress' }, 'agent-crm').status, 'in_progress', 'a running record still resumes');
});

// readResponse run in a sandbox: the state store shared by the reads, and the Bridge's answer to agent_events.
function readFixture(stored, events) {
  let store = clone(stored);
  const sandbox = {
    bridgeCallerRefusal: () => null, withCallerUserId: o => o || {}, normalizeThreadId: v => String(v || ''), trim: v => String(v == null ? '' : v).trim(),
    readState: () => clone(store), recoverState: () => { throw new Error('unexpected recoverState'); }, ensureState: v => v,
    isResidentProvider: () => false, keepUserGatewayKeyAlive() {}, intValue: (v, d) => d, DEFAULT_EVENT_WAIT_MS: 10000,
    bridgeCall: () => clone(events), lockConversationRead: () => ({}), unlockConversationRead() {}, latestSavedState: s => s,
    recordedByAnotherReader: () => false, lang: () => texts,
    appendProgress(state, text) { state.progressLog = (state.progressLog ? state.progressLog + '\n' : '') + text; },
    appendTranscript() {}, now: () => 1, readEarlyAgentCommands() {}, syncSubagentRuns() {}, markProgressEventsIdle() {},
    cancellationRequested: () => false, ingestFeedback() {}, completedFallbackAnswer: () => '', answerLooksIncomplete: () => false,
    saveState: s => { store = clone(s); }, setStateBuffer() {}, responseForState: s => ({ status: s.status, explanation: s.answer || s.error || '' })
  };
  vm.runInNewContext(backendParts(['readResponseOf', 'bridgeProcessGone', 'keepRunAliveAfterBridgeReadFailure', 'bridgeProcessLostMessage', 'isTerminalStatus'],
    ['MAX_TRANSIENT_READ_ERRORS']), sandbox);
  return { read: () => sandbox.readResponseOf({ threadid: 'agent-crm', runid: 'run-4' }), saved: () => store, max: sandbox.MAX_TRANSIENT_READ_ERRORS };
}

test('a turn whose agent process exited ends with the lost-process message instead of reading "still running" for ever', () => {
  const exited = { ok: true, status: 'ok', events: [], nextCursor: 1505, state: { status: 'exited', alive: false, turnActive: true } };
  const f = readFixture(runningCrm(), exited);
  const statuses = [];
  for (let i = 0; i <= f.max + 1 && !statuses.includes('failed'); i++) statuses.push(f.read().status);
  assert.equal(statuses.at(-1), 'failed', statuses.join(','));
  assert.ok(statuses.length <= f.max + 1, 'within the tolerated reads');
  assert.equal(f.saved().status, 'failed', 'the conversation record is no longer in progress');
  assert.equal(f.saved().answer, texts.bridgeProcessLost);
  assert.equal(f.read().explanation, texts.bridgeProcessLost, 'the panel gets the message and leaves its thinking state');
});

test('a turn whose agent process the Bridge no longer knows ends the same way', () => {
  const f = readFixture(runningCrm(), { ok: false, status: 'not_found' });
  const statuses = [];
  for (let i = 0; i <= f.max + 1 && !statuses.includes('failed'); i++) statuses.push(f.read().status);
  assert.equal(statuses.at(-1), 'failed', statuses.join(','));
  assert.equal(f.saved().answer, texts.bridgeProcessLost);
});

test('a live agent with no new event keeps its turn and clears the failed reads', () => {
  const f = readFixture(Object.assign(runningCrm(), { readErrors: 3 }), { ok: true, status: 'ok', events: [], nextCursor: 1505, state: { status: 'ready', alive: true, turnActive: true } });
  for (let i = 0; i < 10; i++) assert.equal(f.read().status, 'in_progress');
  assert.equal(f.saved().readErrors, 0);
});
