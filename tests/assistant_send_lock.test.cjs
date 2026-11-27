// Two sends of one conversation at once (two tabs, a double send), headless bench 27/11: both found no running turn and
// both wrote the conversation; the Agent Bridge admitted one, and the other's busy answer put back the state from before
// it, over the turn the first had started, whose answer was never recorded. A send now holds the conversation's send
// lock from its check of a running turn to its first save ("starting"); a second send meanwhile is told a turn runs.
// node --test tests/assistant_send_lock.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, backendParts } = require('./helpers/assistant-source.cjs');

const ast = ts.createSourceFile('bridge.js', read('js/agent_bridge_client.js'), ts.ScriptTarget.Latest, true);
let send;
(function visit(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'C8O.assistantAgentBridge.sendMessage') send = node.right.getText(ast);
  ts.forEachChild(node, visit);
})(ast);
assert.ok(send);

function fixture(state, bridge, lock) {
  const calls = [];
  const saved = [];
  const sandbox = {
    Engine: { isStudioMode: () => true },
    C8O: { assistantAgentBridge: { refreshTigoAccess: () => ({ status: 'ok' }) } },
    JSON,
    trim: v => String(v ?? '').trim(), normalizeProvider: v => v, normalizeModel: (_p, m) => m, normalizeReasoningEffort: v => v,
    normalizeSkillProfile: () => 'generalist',
    optionsWithRequestFallbacks: v => v, enrichNoCodePrompt: v => v, extractUserMessage: v => v, buildSequencePrompt: v => v,
    normalizeThreadId: v => v, readState: () => state, createState: () => ({ threadid: 'new', status: '' }), ensureState: v => v,
    clearCancellationRequested() {}, firstOptionValue: () => '', noCodeConversationContext: () => null, conversationTitleFromText: v => v,
    normalizeAssistantLanguage: () => 'fr', detectLanguage: () => 'fr', enrichViewerDebugOptions() {}, collectFeedbackContextNames() {}, feedbackCatalogKey: () => '',
    addArrayValue: (a, v) => (a || []).concat([v]), agentSlashCommandName: () => '',
    shouldInstallForRun: () => false, shouldShowAgentPreparingProgress: () => false,
    isResidentProvider: () => true, isVibeHarness: () => true, providerSequence: (_p, action) => 'agent_vibe_' + action,
    codexViewerSessionNeedsFreshThread: () => false, agentStartPayload: () => ({}), revealModeOption: () => '', attachedImagePaths: () => [],
    codexPromptRequiresStart: () => false, rememberCodexSessionFromResult() {}, existingViewerCdpEndpoint: () => '',
    callAgentSetup: () => { calls.push('setup'); return { result: { ok: false, status: 'authentication_required' } }; },
    publicSetupReport: v => v, setupRequiredAnswer: () => 'setup',
    lang: () => ({ starting: 'Analyse', thinking: 'Je réfléchis', turnRunning: 'Tigo travaille encore sur votre message précédent.' }),
    appendProgress() {}, appendTranscript() {}, saveState: s => saved.push(JSON.parse(JSON.stringify(s))), setStateBuffer() {},
    now: () => 1000000, makeRunId: v => 'run-' + v,
    publicState: v => v, cancellationRequested: () => false, recoverableBridgeError: () => false,
    submitTigoPrompt: () => { calls.push('prompt'); return bridge.prompt(); },
    bridgeCall: (_state, sequence, params) => { calls.push(sequence); return bridge[sequence] ? bridge[sequence](params) : { ok: true }; },
    lockConversationSend: () => lock.take(), unlockConversationRead: held => lock.release(held), latestSavedState: s => lock.latest ? lock.latest(s) : s,
    CONVERSATION_SEND_BUSY: 'busy',
    bridgeCallerRefusal: () => null, noCodeAgentRefusal: () => null, withNoCodeServerSettings: options => options, noCodeAgentChanged: () => null, convertigoTurnRefusal: () => null, editProfileApplies: () => false, normalizeEditProfile: () => '', withCallerUserId: options => options || {}, sendMark() {}, takePrewarmedConversation: () => ''
  };
  vm.runInNewContext(backendParts(['runningTurnOf', 'turnRunningResponse']) + '\nvar sendMessage = ' + send + ';', sandbox);
  const response = sandbox.sendMessage({ threadid: state.threadid, Question: 'Ajoute aussi le nombre d\'étapes', provider: 'convertigo', model: 'mistral-large-4' });
  return { response, calls, saved };
}

const completed = () => ({ threadid: 'agent-1', handle: 'agent-1', status: 'completed', runid: 'run-1', cursor: 139, answer: 'A2.',
  provider: 'convertigo', language: 'fr', externalSessionId: 'vibe-session', updatedAt: 990000, conversationFile: '/ws/agent-1/conversation.json' });

test('a send while another send of the conversation holds its lock is told a turn runs, and changes nothing', () => {
  const lock = { taken: 0, released: [], take() { this.taken++; return 'busy'; }, release(held) { this.released.push(held); } };
  const { response, calls, saved } = fixture(completed(), {}, lock);
  assert.equal(response.status, 'turn_running');
  assert.equal(response.error.code, 'turn_running');
  assert.deepEqual(calls, [], 'nothing reaches the Bridge');
  assert.equal(saved.length, 0, 'the conversation is not written');
  assert.deepEqual(lock.released, [], 'a lock it never held is not released');
});

test('a send holds the lock until its first save, reads what the previous holder saved, and releases it on every way out', () => {
  const held = { name: 'held' };
  const order = [];
  const lock = { take() { order.push('take'); return held; }, release(h) { order.push(h === held ? 'release' : 'release?'); },
    latest(s) { order.push('latest'); return Object.assign({}, s, { status: 'in_progress', runid: 'run-B', updatedAt: 999500 }); } };
  // the other send saved its turn while this one waited for the lock: this one sees it and is refused
  const blocked = fixture(completed(), { agent_events: () => ({ ok: true, state: { alive: true, turnActive: true } }) }, lock);
  assert.equal(blocked.response.status, 'turn_running');
  assert.equal(blocked.response.id, 'run-B');
  assert.deepEqual(order, ['take', 'latest', 'release']);
  assert.equal(blocked.saved.length, 0);
  // no other send: the turn starts, the lock goes once "starting" is saved, before the agent starts
  order.length = 0;
  lock.latest = s => { order.push('latest'); return s; };
  const sent = fixture(completed(), { prompt: () => ({ ok: true, requestId: 7, cursor: 140 }), agent_vibe_start: () => { order.push('start'); return { ok: true }; } }, lock);
  assert.equal(sent.response.status, 'queued');
  assert.equal(sent.saved[0].status, 'starting');
  assert.deepEqual(order, ['take', 'latest', 'release', 'start'], 'released before the agent starts');
});
