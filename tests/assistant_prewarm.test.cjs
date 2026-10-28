// A No Code conversation's Vibe took 11 s to start before its first answer (test-nocode). Opening the panel now starts
// one in the background for the user's next conversation, which its first message takes; nothing of it is saved
// before, and the Bridge stops it after 3 min idle without a message.
// node --test tests/assistant_prewarm.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

const source = read('js/agent_bridge_client.js');

function fixture({ clock = 1000000 } = {}) {
  const attributes = {};
  const calls = [];
  let created = 0;
  const sandbox = {
    context: { httpSession: {
      getAttribute: key => (key in attributes ? attributes[key] : null),
      setAttribute: (key, value) => { attributes[key] = value; },
      removeAttribute: key => { delete attributes[key]; }
    } },
    JSON, Object, Number, String,
    trim: value => String(value ?? '').trim(),
    now: () => sandbox.clock,
    clock,
    normalizeSkillProfile: options => (!options.userId || options.userId === 'studio' ? 'generalist' : 'nocode'),
    normalizeProvider: value => String(value || '').trim().toLowerCase(),
    normalizeThreadId: value => String(value ?? '').trim(),
    normalizeUserKey: value => 'key:' + value,
    isVibeHarness: provider => provider === 'convertigo' || provider === 'vibe',
    createState: options => ({ threadid: 'agent-' + (++created), handle: 'agent-' + created, provider: options.provider, userKey: 'key:' + options.userId }),
    ensureState: state => state,
    agentStartPayload: (state, options, provider) => ({ handle: state.handle, conversationId: state.threadid, model: options.model || '' }),
    providerSequence: (provider, action) => 'agent_vibe_' + action,
    bridgeCall: (state, sequence, payload, timeout, background) => { calls.push({ sequence, payload, timeout, background }); return { ok: true, status: 'background' }; },
    sendMark() {}
  };
  vm.runInNewContext(backendParts(['readPrewarm', 'prewarmNoCodeConversation', 'takePrewarmedConversation'],
    ['PREWARM_SESSION_KEY', 'PREWARM_REUSE_MS', 'PREWARM_TAKE_MS']), sandbox);
  return { sandbox, attributes, calls };
}

const nocode = { userId: 'forms-user', model: 'glm-5-3' };

test('opening the No Code panel starts the next conversation\'s Vibe in the background, once', () => {
  const { sandbox, attributes, calls } = fixture();
  const record = sandbox.prewarmNoCodeConversation(nocode, 'convertigo');
  assert.equal(record.threadid, 'agent-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sequence, 'agent_vibe_start');
  assert.equal(calls[0].background, true, 'the panel does not wait for it');
  assert.equal(calls[0].payload.prewarm, 'true');
  assert.equal(calls[0].payload.conversationId, 'agent-1');
  assert.equal(calls[0].payload.model, 'glm-5-3');
  assert.deepEqual(JSON.parse(attributes['lib_ConvertigoAssistant.prewarmedConversation']), { threadid: 'agent-1', provider: 'convertigo', userKey: 'key:forms-user', at: 1000000 });
  sandbox.clock += 60000;
  assert.equal(sandbox.prewarmNoCodeConversation(nocode, 'convertigo').threadid, 'agent-1', 'reopening the panel reuses it');
  assert.equal(calls.length, 1);
  sandbox.clock += 100000;
  assert.equal(sandbox.prewarmNoCodeConversation(nocode, 'convertigo').threadid, 'agent-2', 'an old one is replaced (the Bridge stops it)');
  assert.equal(calls.length, 2);
});

test('no prewarm in the Studio, without a chosen agent, or for Codex and Claude', () => {
  const { sandbox, calls } = fixture();
  assert.equal(sandbox.prewarmNoCodeConversation({ userId: 'studio' }, 'convertigo'), null);
  assert.equal(sandbox.prewarmNoCodeConversation(nocode, 'all'), null);
  assert.equal(sandbox.prewarmNoCodeConversation(nocode, ''), null);
  assert.equal(sandbox.prewarmNoCodeConversation(nocode, 'codex'), null);
  assert.equal(calls.length, 0);
});

test('the first message of a new conversation takes the prewarm, once, for the same agent and user', () => {
  const { sandbox, attributes } = fixture();
  sandbox.prewarmNoCodeConversation(nocode, 'convertigo');
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'forms-user', provider: 'convertigo', threadid: 'agent-old' }), '', 'an existing conversation');
  assert.ok(attributes['lib_ConvertigoAssistant.prewarmedConversation'], 'kept for a new one');
  sandbox.clock += 20000;
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'forms-user', provider: 'convertigo', threadid: '' }), 'agent-1');
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'forms-user', provider: 'convertigo', threadid: '' }), '', 'offered once');

  sandbox.prewarmNoCodeConversation(nocode, 'convertigo');
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'forms-user', provider: 'mistral-vibe', threadid: '' }), '', 'another agent');
  sandbox.prewarmNoCodeConversation(nocode, 'convertigo');
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'other-user', provider: 'convertigo', threadid: '' }), '', 'another user');
  sandbox.prewarmNoCodeConversation(nocode, 'convertigo');
  sandbox.clock += 181000;
  assert.equal(sandbox.takePrewarmedConversation({ userId: 'forms-user', provider: 'convertigo', threadid: '' }), '', 'stopped by the Bridge by now');
});

test('a background Bridge call returns at once and posts from its own daemon thread', () => {
  const posts = [];
  const threads = [];
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    requireBridgeCaller() {}, shouldAttachMcpTokenHandle: () => false, isOwnBridgeUrl: () => false, sendMark() {},
    defaultBridgeUrl: () => 'http://localhost/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    postForm: (...args) => { posts.push(args); return { ok: true }; },
    java: { lang: {
      Runnable: function (impl) { return impl; },
      Thread: function (runnable, name) { this.runnable = runnable; this.name = name; this.setDaemon = d => { this.daemon = d; }; this.start = () => threads.push(this); }
    } }
  };
  vm.runInNewContext(backendParts(['bridgeCall', 'startBackgroundPost']), sandbox);
  const result = sandbox.bridgeCall({ userId: 'forms-user' }, 'agent_vibe_start', { prewarm: 'true' }, 90000, true);
  assert.equal(result.status, 'background');
  assert.equal(posts.length, 0, 'the request does not wait');
  assert.equal(threads.length, 1);
  assert.equal(threads[0].daemon, true);
  threads[0].runnable.run();
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1].__sequence, 'agent_vibe_start');
  assert.equal(posts[0][1].prewarm, 'true');
  assert.equal(posts[0][2], 90000);
});

test('the panel opening prewarms, and a new conversation\'s first message takes it before anything is read', () => {
  const conversation = source.slice(source.indexOf('function createConversationSteps(options)'), source.indexOf('C8O.assistantAgentBridge.quota = function'));
  assert.match(conversation, /var previewDefaults = applyAgentSettingsDefaults\(options, previewSettings, provider\);\n\s+if \(previewSettings !== null\) \{\n\s+prewarmNoCodeConversation\(options, previewDefaults\.provider\);/);
  assert.match(conversation, /var emptyDefaults = applyAgentSettingsDefaults\(options, emptySettings, provider\);\n\s+if \(emptySettings !== null\) \{\n\s+prewarmNoCodeConversation\(options, emptyDefaults\.provider\);/);
  const send = source.slice(source.indexOf('C8O.assistantAgentBridge.sendMessage = function'), source.indexOf('C8O.assistantAgentBridge.readResponse = function'));
  assert.match(send, /var prewarmed = takePrewarmedConversation\(options\);\n\s+if \(prewarmed\.length\) \{\n\s+options\.threadid = prewarmed;\n\s+\}\n\s+var threadid = normalizeThreadId\(options\.threadid\);/);
});

// sendMessage with its collaborators faked (as in assistant_turn_running.test.cjs)
function sendWith({ taken, prompt }) {
  const ts = require('./helpers/assistant-source.cjs').ts;
  const ast = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true);
  let send;
  (function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'C8O.assistantAgentBridge.sendMessage') send = node.right.getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  const events = [];
  const sandbox = {
    Engine: { isStudioMode: () => false }, C8O: { assistantAgentBridge: {} }, JSON,
    trim: v => String(v ?? '').trim(), normalizeProvider: v => v, normalizeModel: (_p, m) => m, normalizeReasoningEffort: v => v,
    normalizeSkillProfile: () => 'nocode',
    optionsWithRequestFallbacks: v => v, enrichNoCodePrompt: v => v, extractUserMessage: v => v, buildSequencePrompt: v => v,
    normalizeThreadId: v => String(v ?? ''), readState: () => null, ensureState: v => v,
    createState: options => ({ threadid: options.threadid || 'agent-new', handle: options.threadid || 'agent-new', provider: options.provider, status: '' }),
    clearCancellationRequested() {}, firstOptionValue: () => '', noCodeConversationContext: () => null, conversationTitleFromText: v => v,
    normalizeAssistantLanguage: () => 'fr', detectLanguage: () => 'fr', enrichViewerDebugOptions() {}, collectFeedbackContextNames() {}, feedbackCatalogKey: () => '',
    addArrayValue: (a, v) => (a || []).concat([v]), agentSlashCommandName: () => '',
    shouldInstallForRun: () => false, shouldShowAgentPreparingProgress: () => false,
    isResidentProvider: () => false, isVibeHarness: () => true, providerSequence: (_p, action) => 'agent_vibe_' + action,
    callAgentSetup: () => ({ result: { ok: true, status: 'ready' } }), publicSetupReport: v => v,
    codexViewerSessionNeedsFreshThread: () => false, agentStartPayload: () => ({}), revealModeOption: () => '', attachedImagePaths: () => [],
    codexPromptRequiresStart: () => false, rememberCodexSessionFromResult() {}, existingViewerCdpEndpoint: () => '',
    lang: () => ({ starting: 'Analyse', thinking: 'Je réfléchis', startFailed: 'Échec' }),
    appendProgress() {}, appendTranscript() {}, saveState() {}, setStateBuffer() {},
    now: () => 1000000, makeRunId: v => 'run-' + v, publicState: v => v, cancellationRequested: () => false,
    recoverableBridgeError: () => false, isCodexAuthenticationError: () => false, responseForState: () => ({ AIData: {} }),
    submitTigoPrompt: () => { events.push('prompt'); return prompt(); },
    bridgeCall: (_state, sequence) => { events.push(sequence); return { ok: true, status: 'already_running', state: { sessionId: 's1' } }; },
    bridgeCallerRefusal: () => null, withCallerUserId: options => options || {}, sendMark() {},
    takePrewarmedConversation: () => taken,
    prewarmNoCodeConversation: (options, provider) => { events.push('prewarm:' + provider + ':' + (options.threadid || '')); return null; }
  };
  vm.runInNewContext('var sendMessage = ' + send + ';', sandbox);
  const response = sandbox.sendMessage({ threadid: '', Question: 'OK ?', provider: 'convertigo', userId: 'forms-user' });
  return { response, events };
}

test('a message that took the prewarm starts the next conversation\'s, once its prompt is sent', () => {
  const { response, events } = sendWith({ taken: 'agent-p1', prompt: () => ({ ok: true, requestId: 1, cursor: 3 }) });
  assert.equal(response.status, 'queued');
  assert.equal(response.threadid, 'agent-p1', 'the conversation is the prewarmed one');
  assert.deepEqual(events, ['agent_vibe_start', 'prompt', 'prewarm:convertigo:agent-p1']);
});

test('no new prewarm for a conversation that did not take one, nor when its prompt failed', () => {
  assert.deepEqual(sendWith({ taken: '', prompt: () => ({ ok: true, requestId: 1 }) }).events, ['agent_vibe_start', 'prompt']);
  const failed = sendWith({ taken: 'agent-p1', prompt: () => ({ ok: false, status: 'error', error: 'Vibe died' }) });
  assert.equal(failed.response.ok, false);
  assert.ok(!failed.events.some(event => event.startsWith('prewarm')));
});
