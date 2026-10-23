// Low-code friction of Studio 8.4.6 users: "A turn is already running" (Mistral Large 4). A message sent while the agent
// still worked on the previous one reached Vibe, which refused it; the conversation then showed the running turn as
// failed and its answer was lost. The message is now refused before anything of the conversation changes.
// node --test tests/assistant_turn_running.test.cjs
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

function fixture(state, bridge) {
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
    normalizeAssistantLanguage: () => 'fr', detectLanguage: () => 'fr', enrichViewerDebugOptions() {}, collectFeedbackContextNames() {},
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
    bridgeCallerRefusal: () => null, withCallerUserId: options => options || {}, sendMark() {}, takePrewarmedConversation: () => ''
  };
  vm.runInNewContext(backendParts(['runningTurnOf', 'turnRunningResponse']) + '\nvar sendMessage = ' + send + ';', sandbox);
  const response = sandbox.sendMessage({ threadid: state.threadid, Question: 'Ajoute aussi le nombre d\'étapes', provider: 'convertigo', model: 'mistral-large-4' });
  return { response, calls, saved };
}

const running = () => ({ threadid: 'agent-1', handle: 'agent-1', status: 'in_progress', runid: 'run-1', cursor: 139, answer: 'partial',
  provider: 'convertigo', language: 'fr', externalSessionId: 'vibe-session', updatedAt: 990000 });

test('a message sent while the agent works on the previous one is refused, and the running turn goes on', () => {
  const state = running();
  const { response, calls, saved } = fixture(state, { agent_events: () => ({ ok: true, state: { alive: true, turnActive: true } }) });
  assert.equal(response.status, 'turn_running');
  assert.equal(response.ok, false);
  assert.equal(response.id, 'run-1', 'the running turn, which the page can keep reading');
  assert.equal(response.error.code, 'turn_running');
  assert.match(response.error.message, /travaille encore/);
  assert.deepEqual(calls, ['agent_events'], 'nothing reaches the agent');
  assert.equal(saved.length, 0, 'the conversation is not changed');
  assert.equal(state.status, 'in_progress');
  assert.equal(state.answer, 'partial');
});

test('a message being sent counts as a running turn; a stale state does not block the conversation', () => {
  const starting = Object.assign(running(), { status: 'starting', updatedAt: 999000 });
  const blocked = fixture(starting, {});
  assert.equal(blocked.response.status, 'turn_running');
  assert.deepEqual(blocked.calls, [], 'no Bridge call needed');
  const stale = fixture(running(), { agent_events: () => ({ ok: true, state: { alive: true, turnActive: false } }), prompt: () => ({ ok: true, requestId: 5, cursor: 140 }) });
  assert.equal(stale.response.status, 'queued', 'the agent no longer runs that turn: the message is sent');
  assert.deepEqual(stale.calls, ['agent_events', 'agent_vibe_start', 'prompt']);
  const gone = fixture(running(), { agent_events: () => ({ ok: true, state: { alive: false } }), prompt: () => ({ ok: true, requestId: 5, cursor: 0 }) });
  assert.equal(gone.response.status, 'queued');
});

test('a turn that starts between the check and the prompt: the Bridge answers busy and the conversation is restored', () => {
  const state = Object.assign(running(), { status: 'completed' });
  const { response, saved } = fixture(state, { prompt: () => ({ ok: false, status: 'busy', error: 'A turn is already running in this conversation' }) });
  assert.equal(response.status, 'turn_running');
  assert.equal(saved.at(-1).status, 'completed', 'saved as it was before the send');
  assert.equal(saved.at(-1).answer, 'partial');
});
