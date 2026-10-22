// Backend-only checks of the No Code MCP token of a user; no HTTP requests, runtime files or agent processes.
// A new user's page sends several requests together; each found no token, created one, and the file and the handle kept
// the last one, which C8Oforms had not stored (test-nocode, 22/10/2026). The resolution now runs one at a time, a
// created token is kept only once C8Oforms accepts it, and a token C8Oforms refuses later is forgotten.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');
const snippets = backendParts(['readNoCodeMcpToken', 'createNoCodeMcpToken', 'resolveNoCodeMcpToken', 'forgetNoCodeMcpToken',
  'noCodeMcpTokenHandle', 'attachMcpTokenHandle', 'loadNoCodeBaserowCatalog'],
['NOCODE_MCP_TOKEN_HANDLE_PREFIX', 'NOCODE_MCP_TOKEN_SESSION_PREFIX']);
const nocode = { skillProfile: 'nocode', userId: 'bob@x.test' };
const handleKey = 'lib_ConvertigoAssistant.nocodeMcpToken.bob_x.test';

// C8Oforms answers each creation with the next token of `created`; its validation, and the MCP catalog, accept the
// tokens of `accepted` (a test removes one to revoke it).
function fixture({ created = ['t1'], accepted = ['t1'] } = {}) {
  const files = new Map(), secrets = new Map(), locks = [], creations = [], validations = [], catalogs = [];
  const store = { get: key => secrets.get(key) ?? null, set: (key, value) => secrets.set(key, value) };
  const session = new Map();
  const context = {
    trim: value => String(value ?? '').trim(),
    normalizeSkillProfile: options => options.skillProfile,
    noCodeMcpUserId: options => options.userId,
    normalizeUserKey: userId => userId.replace('@', '_'),
    noCodeMcpTokenFile: (options, userKey) => userKey,
    readJsonFile: file => files.get(file) ?? null,
    writeNoCodeMcpToken: (options, userKey, userId, token) => files.set(userKey, { token }),
    noCodeMcpTokenLabel: options => 'Convertigo Agent Bridge - ' + options.userId,
    validateNoCodeMcpToken: token => { validations.push(token); return accepted.includes(token); },
    callLocalSequence(project, sequence, variables) {
      if (`${project}.${sequence}` === 'lib_ConvertigoMCP.tools_nocode_baserow_catalog_list') {
        catalogs.push(variables.token);
        return accepted.includes(variables.token) ? { status: 'ok', tables: [{ id: 1 }] } : { status: 'auth_required' };
      }
      assert.equal(`${project}.${sequence}`, 'C8Oforms.APIV2_McpTokenCreate');
      creations.push(variables.name);
      return { token: created[creations.length - 1] ?? '' };
    },
    unwrapSequenceResult: response => response,
    sequencePayload: response => response,
    findCatalogValue: (payload, keys) => payload[keys[0]],
    catalogArray: value => value || [],
    managedMcpTokenHandle: () => assert.fail('a No Code user never gets a Studio token'),
    sharedStorage: () => store,
    sharedSecretGet: handle => String(store.get(handle) ?? ''),
    sharedSecretSet: (handle, value) => { store.set(handle, String(value)); return true; },
    sharedSecretRemove: handle => secrets.delete(handle),
    Packages: { org: { mozilla: { javascript: { Synchronizer: function (fn, lock) { return () => { locks.push(lock); return fn(); }; } } } } },
    context: {
      httpSession: {
        getAttribute: key => session.get(key) ?? null,
        setAttribute: (key, value) => session.set(key, value),
        removeAttribute: key => session.delete(key)
      }
    }
  };
  vm.runInNewContext(snippets, context);
  const handle = () => context.noCodeMcpTokenHandle({ ...nocode });
  const newSession = () => session.clear();
  return { context, handle, newSession, files, secrets, locks, creations, validations, catalogs, store, session, accepted };
}

test('a token C8Oforms does not accept right after its creation is never kept', () => {
  const f = fixture({ created: ['lost', 'kept'], accepted: ['kept'] });
  const handle = f.handle();
  assert.ok(handle.length);
  assert.equal(f.secrets.get(handle), 'kept');
  assert.deepEqual(f.files.get('bob_x.test'), { token: 'kept' });
  assert.equal(f.creations.length, 2);
});

test('no token at all when C8Oforms accepts none of its two creations', () => {
  const f = fixture({ created: ['lost1', 'lost2', 'never'], accepted: [] });
  assert.equal(f.handle(), '');
  assert.equal(f.creations.length, 2);
  assert.equal(f.files.size, 0);
  assert.equal(f.secrets.size, 0);
});

test('the requests after the first one read the token it created, under the lock of the shared store', () => {
  const f = fixture();
  const first = f.handle();
  f.newSession();
  const second = f.handle();
  assert.equal(second, first);
  assert.equal(f.creations.length, 1, 'one creation for the user');
  assert.deepEqual(f.locks, [f.store, f.store], 'each resolution ran under the lock of bridgeCallerKey');
});

test('a session that already holds the handle neither locks nor asks C8Oforms again', () => {
  const f = fixture();
  const handle = f.handle();
  const validations = f.validations.length;
  assert.equal(f.handle(), handle);
  assert.equal(f.locks.length, 1);
  assert.equal(f.creations.length, 1);
  assert.equal(f.validations.length, validations, 'no check without verify');
});

test('a file token C8Oforms no longer accepts is replaced', () => {
  const f = fixture({ created: ['fresh'], accepted: ['fresh'] });
  f.files.set('bob_x.test', { token: 'revoked' });
  assert.equal(f.secrets.get(f.handle()), 'fresh');
  assert.deepEqual(f.files.get('bob_x.test'), { token: 'fresh' });
});

test('a catalog refused for the token the session kept forgets it and answers with a new one', () => {
  const f = fixture({ created: ['t1', 't2'], accepted: ['t1', 't2'] });
  f.handle();
  f.accepted.splice(f.accepted.indexOf('t1'), 1);
  const catalog = f.context.loadNoCodeBaserowCatalog({ ...nocode });
  assert.equal(catalog.status, 'ok');
  assert.deepEqual(catalog.tables, [{ id: 1 }]);
  assert.deepEqual(f.catalogs, ['t1', 't2']);
  assert.equal(f.secrets.get(handleKey), 't2');
  assert.deepEqual(f.files.get('bob_x.test'), { token: 't2' });
});

test('a refused catalog answers auth_required when C8Oforms accepts no new token either', () => {
  const f = fixture({ created: ['t1', 't2'], accepted: ['t1', 't2'] });
  f.handle();
  f.accepted.length = 0;
  assert.equal(f.context.loadNoCodeBaserowCatalog({ ...nocode }).status, 'auth_required');
  assert.deepEqual(f.catalogs, ['t1']);
});

test('an agent starts with a token C8Oforms still accepts', () => {
  const f = fixture({ created: ['t1', 't2'], accepted: ['t1', 't2'] });
  f.handle();
  f.accepted.splice(f.accepted.indexOf('t1'), 1);
  const payload = {};
  f.context.attachMcpTokenHandle(payload, { ...nocode });
  assert.equal(payload.nocodeMcpTokenHandle, handleKey);
  assert.equal(f.secrets.get(handleKey), 't2');
});

test('an agent start keeps a token C8Oforms accepts, after asking it once', () => {
  const f = fixture();
  f.handle();
  const validations = f.validations.length;
  const payload = {};
  f.context.attachMcpTokenHandle(payload, { ...nocode });
  assert.equal(f.secrets.get(payload.nocodeMcpTokenHandle), 't1');
  assert.equal(f.validations.length, validations + 1);
  assert.equal(f.creations.length, 1);
});

test('forgetting a refused token leaves the one another session already put in its place', () => {
  const f = fixture();
  f.handle();
  f.secrets.set(handleKey, 'other');
  f.context.forgetNoCodeMcpToken({ ...nocode }, 't1');
  assert.equal(f.secrets.get(handleKey), 'other');
  assert.equal(f.session.size, 0, 'the session handle is dropped');
});
