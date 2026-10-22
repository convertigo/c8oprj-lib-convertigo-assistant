// Backend-only checks of the No Code MCP token of a user; no HTTP requests, runtime files or agent processes.
// A new user's page sends several requests together; each found no token, created one, and the file and the handle kept
// the last one, which C8Oforms had not stored (test-nocode, 22/10/2026). The resolution now runs one at a time, and a
// created token is kept only once C8Oforms accepts it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');
const snippets = backendParts(['readNoCodeMcpToken', 'createNoCodeMcpToken', 'resolveNoCodeMcpToken', 'noCodeMcpTokenHandle'],
  ['NOCODE_MCP_TOKEN_HANDLE_PREFIX', 'NOCODE_MCP_TOKEN_SESSION_PREFIX']);

// C8Oforms answers each creation with the next token of `created`; `accepted` lists the tokens its validation accepts.
function fixture({ created = ['t1'], accepted = ['t1'] } = {}) {
  const files = new Map(), secrets = new Map(), locks = [], creations = [];
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
    validateNoCodeMcpToken: token => accepted.includes(token),
    callLocalSequence(project, sequence, variables) {
      assert.equal(`${project}.${sequence}`, 'C8Oforms.APIV2_McpTokenCreate');
      creations.push(variables.name);
      return { token: created[creations.length - 1] ?? '' };
    },
    unwrapSequenceResult: response => response,
    sharedStorage: () => store,
    sharedSecretGet: handle => String(store.get(handle) ?? ''),
    sharedSecretSet: (handle, value) => { store.set(handle, String(value)); return true; },
    Packages: { org: { mozilla: { javascript: { Synchronizer: function (fn, lock) { return () => { locks.push(lock); return fn(); }; } } } } },
    context: { httpSession: { getAttribute: key => session.get(key) ?? null, setAttribute: (key, value) => session.set(key, value) } }
  };
  vm.runInNewContext(snippets, context);
  const handle = (userId = 'bob@x.test') => context.noCodeMcpTokenHandle({ skillProfile: 'nocode', userId });
  const newSession = () => session.clear();
  return { context, handle, newSession, files, secrets, locks, creations, store };
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
  assert.equal(f.handle(), handle);
  assert.equal(f.locks.length, 1);
  assert.equal(f.creations.length, 1);
});

test('a file token C8Oforms no longer accepts is replaced', () => {
  const f = fixture({ created: ['fresh'], accepted: ['fresh'] });
  f.files.set('bob_x.test', { token: 'revoked' });
  assert.equal(f.secrets.get(f.handle()), 'fresh');
  assert.deepEqual(f.files.get('bob_x.test'), { token: 'fresh' });
});
