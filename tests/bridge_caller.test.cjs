// Bridge caller rules of the Assistant: who may reach lib_ConvertigoAgentBridge through it, and where the caller key goes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, backendParts } = require('./helpers/assistant-source.cjs');

const ENTRY_POINTS = ['createConversation', 'settings', 'setupAgent', 'sendMessage', 'readResponse',
  'resumeConversation', 'deleteConversation', 'closeConversation'];

class FakeUri {
  constructor(text) { this.url = new URL(text); }
  getScheme() { return this.url.protocol.replace(/:$/, ''); }
  getHost() { return this.url.hostname; }
  getPort() { return this.url.port ? Number(this.url.port) : -1; }
  getPath() { return this.url.pathname; }
  normalize() { return this; }
  toString() { return this.url.href; }
}

function fixture({ studio = true, admin = false, user = '', localPort = 18086, configured = 'http://localhost:18086/convertigo' } = {}) {
  const calls = [];
  const sandbox = {
    DEFAULT_BRIDGE_PROJECT: 'lib_ConvertigoAgentBridge',
    trim: value => String(value ?? '').trim(),
    java: { net: { URI: FakeUri }, util: { UUID: { randomUUID: () => 'uuid' } } },
    Packages: { com: { twinsoft: { convertigo: { engine: { AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN' } } } } } } },
    Engine: {
      isStudioMode: () => studio,
      authenticatedSessionManager: { hasRole: (session, role) => role === 'WEB_ADMIN' && session.admin === true }
    },
    context: {
      httpSession: { admin },
      getAuthenticatedUser: () => user || null,
      httpServletRequest: { getLocalPort: () => localPort, getContextPath: () => '/convertigo' }
    },
    configuredConvertigoBaseUrl: () => configured,
    defaultBridgeUrl: () => configured + '/projects/lib_ConvertigoAgentBridge/.json',
    bridgeCallerKey: () => 'engine-key',
    normalizeSkillProfile: () => 'generalist',
    shouldAttachMcpTokenHandle: () => false,
    response: { result: { ok: true } },
    postForm(...args) { calls.push(args); return sandbox.response; }
  };
  vm.runInNewContext(backendParts(['requireBridgeCaller', 'bridgeCallerRefusal', 'isOwnBridgeUrl', 'bridgeCall'],
    ['BRIDGE_CALLER_KEY_HEADER', 'BRIDGE_JSON_PATH']), sandbox);
  return { sandbox, calls };
}

test('Studio: only a WEB_ADMIN session reaches the Bridge, with the wording the Tigo UI renews on', () => {
  assert.doesNotThrow(() => fixture({ admin: true }).sandbox.requireBridgeCaller());
  for (const caller of [{}, { user: 'someone' }]) {
    assert.throws(() => fixture(caller).sandbox.requireBridgeCaller(), /^Error: authentication_required: A WEB_ADMIN session is required$/);
  }
});

test('Server: WEB_ADMIN or an authenticated user, never an anonymous caller', () => {
  assert.doesNotThrow(() => fixture({ studio: false, user: 'forms-user' }).sandbox.requireBridgeCaller());
  assert.doesNotThrow(() => fixture({ studio: false, admin: true }).sandbox.requireBridgeCaller());
  assert.throws(() => fixture({ studio: false }).sandbox.requireBridgeCaller(), /authentication_required: Authenticated Assistant session required/);
});

test('A refused caller gets a plain failure, without an exception', () => {
  const refusal = fixture().sandbox.bridgeCallerRefusal();
  assert.equal(refusal.ok, false);
  assert.equal(refusal.status, 'failed');
  assert.equal(refusal.error.code, 'authentication_required');
  assert.equal(fixture({ admin: true }).sandbox.bridgeCallerRefusal(), null);
});

test('The caller key goes only to the Bridge of this engine', () => {
  const { sandbox } = fixture({ admin: true });
  const own = [
    'http://localhost:18086/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    'http://127.0.0.1:18086/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    'http://[::1]:18086/convertigo/projects/lib_ConvertigoAgentBridge/.json'
  ];
  const foreign = [
    'http://evil.example:18086/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    'http://192.168.1.20:18086/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    'http://127.0.0.1:9999/convertigo/projects/lib_ConvertigoAgentBridge/.json',
    'http://localhost:18086/convertigo/projects/lib_ConvertigoAssistant/.json',
    'file:///etc/passwd',
    'not a url'
  ];
  for (const url of own) assert.equal(sandbox.isOwnBridgeUrl(url), true, url);
  for (const url of foreign) assert.equal(sandbox.isOwnBridgeUrl(url), false, url);
  const server = fixture({ admin: true, localPort: 28080, configured: 'https://c8o.example.com/convertigo' }).sandbox;
  assert.equal(server.isOwnBridgeUrl('https://c8o.example.com/convertigo/projects/lib_ConvertigoAgentBridge/.json'), true);
  assert.equal(server.isOwnBridgeUrl('https://c8o.example.com.evil/convertigo/projects/lib_ConvertigoAgentBridge/.json'), false);
});

test('bridgeCall checks the caller first, sends the key to its own Bridge only and surfaces a Bridge refusal', () => {
  const refused = fixture();
  assert.throws(() => refused.sandbox.bridgeCall({}, 'agent_events', { handle: 'h' }), /authentication_required/);
  assert.equal(refused.calls.length, 0, 'nothing is posted for a refused caller');

  const { sandbox, calls } = fixture({ admin: true });
  sandbox.bridgeCall({}, 'agent_events', { handle: 'h' });
  assert.equal(JSON.stringify(calls[0][3]), JSON.stringify({ 'X-Convertigo-Agent-Bridge-Key': 'engine-key' }));
  sandbox.bridgeCall({ bridgeBaseUrl: 'http://evil.example/convertigo/projects/lib_ConvertigoAgentBridge/.json' }, 'agent_events', {});
  assert.equal(JSON.stringify(calls[1][3]), '{}', 'a caller-chosen Bridge URL never receives the key');

  sandbox.response = { error: { message: 'An exception occured while executing step',
    details: 'EngineException: agent_bridge_caller_refused: a WEB_ADMIN session or the Assistant of this engine is required' } };
  assert.throws(() => sandbox.bridgeCall({}, 'agent_status', {}), /agent_bridge_caller_refused/);
});

test('Every Assistant entry point that reaches the Bridge refuses first, before reading or writing a conversation', () => {
  const source = read('js/agent_bridge_client.js');
  const ast = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true);
  const first = {};
  (function visit(node) {
    if (ts.isBinaryExpression(node) && /^C8O\.assistantAgentBridge\.\w+$/.test(node.left.getText(ast)) && ts.isFunctionExpression(node.right)) {
      first[node.left.getText(ast).split('.').pop()] = node.right.body.statements[0]?.getText(ast) || '';
    }
    ts.forEachChild(node, visit);
  })(ast);
  for (const name of ENTRY_POINTS) {
    assert.equal(first[name], 'var refused = bridgeCallerRefusal();', name);
  }
  assert.match(source, /function bridgeCall\(options, sequence, params, timeoutMs\) \{\n    requireBridgeCaller\(\);/);
});
