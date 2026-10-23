// A new No Code conversation waited 8 to 11 s in the Assistant before the Bridge started Vibe (test-nocode). Sending a
// message, creating a conversation and reading the settings now write what each step takes, one JSON line per call in
// agents/assistant/send-timings.ndjson; each call to the Bridge is a step named after its sequence.
// node --test tests/assistant_send_timings.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

const source = read('js/agent_bridge_client.js');

function fixture(extra = {}) {
  const lines = [];
  let clock = 1000;
  class FakeFile {
    constructor(parent, child) { this.p = child === undefined ? String(parent) : path.join(String(parent.p || parent), String(child)); }
    isFile() { return false; }
    toPath() { return this.p; }
  }
  const sandbox = Object.assign({
    File: FakeFile,
    ensureDir() {},
    now: () => clock,
    trim: value => String(value ?? '').trim(),
    resolveWorkspaceRoot: () => '/default',
    Files: { write: (file, bytes) => { lines.push({ file, text: String(bytes) }); } },
    StandardOpenOption: {},
    StandardCharsets: {},
    java: { lang: { String: function (text) { this.getBytes = () => text; } } },
    advance: ms => { clock += ms; }
  }, extra);
  vm.runInNewContext(backendParts(['sendTimer', 'sendMark', 'timedCall', 'writeSendTimings'].concat(extra.parts || []),
    ['SEND_TIMINGS_FILE', 'SEND_TIMINGS_MAX_BYTES', 'activeSendTimer']), sandbox);
  return { sandbox, lines };
}

test('a timed call writes one line with the time of each step, its conversation and its total', () => {
  const { sandbox, lines } = fixture();
  const result = sandbox.timedCall('send', () => {
    sandbox.advance(40); sandbox.sendMark('nocode-context');
    sandbox.advance(60); sandbox.sendMark('state/create', { threadid: 'agent-1', provider: 'convertigo', workspaceRoot: '/workspace' });
    // a call inside the timed one is part of it
    return sandbox.timedCall('send', () => {
      sandbox.advance(7000); sandbox.sendMark('agent_vibe_setup');
      sandbox.advance(10); return { ok: true, status: 'queued' };
    });
  });
  assert.equal(result.status, 'queued');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].file, '/workspace/agents/assistant/send-timings.ndjson');
  const line = JSON.parse(lines[0].text);
  assert.equal(line.kind, 'send');
  assert.equal(line.outcome, 'queued');
  assert.equal(line.totalMs, 7110);
  assert.equal(line.threadid, 'agent-1');
  assert.equal(line.provider, 'convertigo');
  assert.deepEqual(line.steps, [{ step: 'nocode-context', ms: 40 }, { step: 'state/create', ms: 60 }, { step: 'agent_vibe_setup', ms: 7000 }]);
});

test('a failed call is written too; a step outside a timed call writes nothing', () => {
  const { sandbox, lines } = fixture();
  assert.throws(() => sandbox.timedCall('settings', () => { sandbox.advance(5); sandbox.sendMark('settings'); throw new Error('Bridge down'); }), /Bridge down/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].file, '/default/agents/assistant/send-timings.ndjson', 'no conversation yet: the default workspace');
  assert.equal(JSON.parse(lines[0].text).outcome, 'error');
  assert.doesNotThrow(() => sandbox.sendMark('settings'));
  assert.equal(lines.length, 1);
});

test('each call to the Bridge is a step named after its sequence, after the preparation of its payload', () => {
  const { sandbox, lines } = fixture({
    parts: ['bridgeCall'],
    requireBridgeCaller() {}, shouldAttachMcpTokenHandle: () => false, isOwnBridgeUrl: () => false, normalizeSkillProfile: () => 'nocode',
    defaultBridgeUrl: () => 'http://localhost/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    postForm() { sandbox.advance(11500); return { ok: true }; }
  });
  sandbox.timedCall('send', () => {
    sandbox.advance(300);
    return sandbox.bridgeCall({ threadid: 'agent-1' }, 'agent_vibe_start', {}, 90000);
  });
  assert.deepEqual(JSON.parse(lines[0].text).steps, [{ step: 'agent_vibe_start/payload', ms: 300 }, { step: 'agent_vibe_start', ms: 11500 }]);
});

test('sending a message, creating a conversation and reading the settings are timed, after the caller checks', () => {
  assert.match(source, /C8O\.assistantAgentBridge\.sendMessageFromSequenceScope = function \(scope\) \{\n\s+return timedCall\("send", function \(\) \{\n\s+return sendMessageFromScope\(scope\);/);
  assert.match(source, /options = withCallerUserId\(options\);\n\s+return timedCall\("conversation", function \(\) \{\n\s+return createConversationSteps\(options\);/);
  assert.match(source, /options = withCallerUserId\(optionsWithRequestFallbacks\(options\)\);\n\s+return timedCall\("settings", function \(\) \{\n\s+return settingsSteps\(options\);/);
  const send = source.slice(source.indexOf('C8O.assistantAgentBridge.sendMessage = function'), source.indexOf('C8O.assistantAgentBridge.readResponse = function'));
  for (const step of ['nocode-context', 'state/read', 'state/create', 'prompt', 'state/save', 'tigo-access', 'resources', 'setup', 'start-payload']) {
    assert.ok(send.includes('sendMark("' + step + '"'), step);
  }
});
