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
