// The Tigo right of the No Code Studio: C8Oforms decides, for the user of the session, whether Tigo may start, set up
// or prompt an agent (C8Oforms.APIV2_AgentAccess, right tigo_rights). node --test tests/nocode-tigo-right.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

function fixture({ studio = false, desktop, admin = false, user = 'alice@example.com', c8oforms = true, sequence = true, answer = { status: 'ok', tigo: true } } = {}) {
  const calls = [];
  const attributes = new Map();
  const project = c8oforms ? {
    getSequenceByName: (name) => {
      if (!sequence || name !== 'APIV2_AgentAccess') throw new Error('no sequence ' + name);
      return {};
    }
  } : null;
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    log: { warn() {} },
    Packages: { com: { twinsoft: { convertigo: { engine: { AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN' } } } } } } },
    Engine: {
      isStudioMode: () => studio,
      ...(desktop === undefined ? {} : { isDesktopStudio: () => desktop }),
      authenticatedSessionManager: { hasRole: (session, role) => role === 'WEB_ADMIN' && session.admin === true },
      theApp: { databaseObjectsManager: { getOriginalProjectByName: (name) => (name === 'C8Oforms' ? project : null) } }
    },
    context: {
      httpSession: { admin },
      getAuthenticatedUser: () => user || null,
      httpServletRequest: { getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value) }
    },
    callLocalSequence(projectName, sequenceName, variables) {
      calls.push([projectName, sequenceName, variables]);
      if (answer instanceof Error) throw answer;
      return { document: { result: answer } };
    },
    unwrapSequenceResult: response => response.document.result,
    C8O: { assistantAgentBridge: {} },
    bridgeCallerRefusal: () => null
  };
  vm.runInNewContext(backendParts(['agentAccessSequenceAvailable', 'truthyAccess', 'agentAccessOfSession', 'isWebAdminSession', 'noCodeAgentRefusal'],
    ['AGENT_ACCESS_PROJECT', 'AGENT_ACCESS_SEQUENCE', 'AGENT_ACCESS_REQUEST_ATTRIBUTE']), sandbox);
  return { sandbox, calls };
}

test('a No Code user with the right reaches the agent, a user without it is refused with agent_not_allowed', () => {
  assert.equal(fixture().sandbox.noCodeAgentRefusal(), null);
  assert.equal(fixture({ answer: { status: 'ok', tigo: 'true' } }).sandbox.noCodeAgentRefusal(), null, 'a text value from the XML answer');
  const refused = fixture({ answer: { status: 'ok', tigo: false } }).sandbox.noCodeAgentRefusal();
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 'failed');
  assert.equal(refused.error.code, 'agent_not_allowed');
  assert.match(refused.error.message, /^agent_not_allowed: Tigo is not enabled for this account/);
});

test('C8Oforms decides for the user of the session, once per request, without any page value', () => {
  const { sandbox, calls } = fixture();
  sandbox.noCodeAgentRefusal();
  sandbox.noCodeAgentRefusal();
  assert.equal(calls.length, 1, 'cached on the request');
  assert.deepEqual(calls[0].slice(0, 2), ['C8Oforms', 'APIV2_AgentAccess']);
  assert.equal(JSON.stringify(calls[0][2]), '{}', 'no user is named: C8Oforms reads the session');
});

test('not concerned: the Studio, a WEB_ADMIN session, a server without C8Oforms or with a C8Oforms older than the right', () => {
  for (const caller of [{ studio: true, answer: { status: 'ok', tigo: false } }, { admin: true, answer: { status: 'ok', tigo: false } },
    { desktop: true, answer: { status: 'ok', tigo: false } }, { c8oforms: false }, { sequence: false }, { user: '' }]) {
    const { sandbox, calls } = fixture(caller);
    assert.equal(sandbox.noCodeAgentRefusal(), null, JSON.stringify(caller));
    if (caller.studio || caller.desktop || caller.admin || caller.user === '') assert.equal(calls.length, 0, 'C8Oforms is not asked');
  }
  // a server engine (isDesktopStudio false) or an 8.4 engine (no isDesktopStudio) keeps asking C8Oforms
  for (const desktop of [false, undefined]) {
    assert.equal(fixture({ desktop, answer: { status: 'ok', tigo: false } }).sandbox.noCodeAgentRefusal().error.code, 'agent_not_allowed');
  }
});

test('a right that cannot be checked refuses, with a code the panel can retry on', () => {
  for (const answer of [new Error('CouchDB down'), { status: 'error' }, {}]) {
    const refused = fixture({ answer }).sandbox.noCodeAgentRefusal();
    assert.equal(refused.error.code, answer instanceof Error || answer.status !== 'ok' ? 'agent_access_unavailable' : 'agent_not_allowed');
  }
});

test('the entry points that start, set up or prompt an agent, and the No Code context catalog, check the right', () => {
  const source = read('js/agent_bridge_client.js');
  for (const name of ['createConversation', 'settings', 'setupAgent', 'sendMessage']) {
    assert.match(source, new RegExp(`C8O\\.assistantAgentBridge\\.${name} = function \\(options\\) \\{\\n    var refused = bridgeCallerRefusal\\(\\) \\|\\| noCodeAgentRefusal\\(${['createConversation', 'settings'].includes(name) ? 'true' : ''}\\);`), name);
  }
  const catalog = source.slice(source.indexOf('function noCodeContextCatalogFromScope(scope) {'));
  assert.match(catalog, /^function noCodeContextCatalogFromScope\(scope\) \{\n    var refused = bridgeCallerRefusal\(\) \|\| noCodeAgentRefusal\(\);/);
  assert.match(catalog.slice(0, 1500), /options = withCallerUserId\(options\);/, 'the catalog lists the forms and uses the token of the user of the session');
  // the token of a No Code agent is a Tigo token: C8Oforms refuses to create or validate it without the right
  assert.match(source, /callLocalSequence\("C8Oforms", "APIV2_McpTokenCreate", \{\n\s+name: label,\n\s+client: "tigo"\n\s+\}\)/);
  // closing and interrupting a running agent stay possible without the right
  for (const name of ['closeConversation', 'readResponse']) {
    assert.match(source, new RegExp(`C8O\\.assistantAgentBridge\\.${name} = function \\(options\\) \\{\\n    var refused = bridgeCallerRefusal\\(\\);`), name);
  }
});

test('the former chat sequences stay open where no C8Oforms knows the right: the Studio and the hosted Assistant', () => {
  const source = read('js/agent_bridge_client.js');
  assert.match(source, /C8O\.assistantAgentBridge\.requireAgentAccess = function \(\) \{\n    if \(isLocalStudio\(\) \|\| !agentAccessSequenceAvailable\(\)\) \{\n      return;\n    \}\n    requireBridgeCaller\(\);/);
  for (const sequence of ['SendMessage', 'CreateConversation', 'ReadResponse', 'UploadFiles', 'GetMessages', 'LRagQuery']) {
    assert.match(read(`_c8oProject/sequences/${sequence}.yaml`), /C8O\.assistantAgentBridge\.requireAgentAccess\(\);/, sequence);
  }
});

test('one C8Oforms call answers the right and the administration of a request', () => {
  const { sandbox, calls } = fixture({ answer: { status: 'ok', tigo: true, admin: true } });
  assert.equal(sandbox.noCodeAgentRefusal(true), null);
  assert.equal(sandbox.noCodeAgentRefusal(false), null);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ withAdmin: 'true' }));
});
