// Backend-only checks of the managed MCP token of a Studio panel session. It had a fixed 2 h expiry and a turn longer
// than that lost every Convertigo tool (PCA eval 29/10, GLM 2 h into its turn). It is now leased by lib_ConvertigoMCP:
// valid while a turn uses it, it ends MANAGED_MCP_TOKEN_IDLE_SECONDS after the last activity. A send reuses it while
// its lease lives, and an older lib_ConvertigoMCP, which ignores idleSeconds, keeps the fixed expiry.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');
const snippets = backendParts(['managedMcpTokenHandle', 'managedMcpTokenUsable', 'usesProtectedConvertigoMcp', 'decodeJwtPart', 'jwtExpiryMillis'],
  ['MANAGED_MCP_TOKEN_HANDLE_PREFIX', 'MANAGED_MCP_TOKEN_SESSION_HANDLE', 'MANAGED_MCP_TOKEN_SESSION_EXPIRY', 'MANAGED_MCP_TOKEN_TTL_SECONDS',
    'MANAGED_MCP_TOKEN_RENEW_SKEW_MS', 'MANAGED_MCP_TOKEN_IDLE_SECONDS', 'MANAGED_MCP_LEASES_KEY']);
const LEASES = 'lib_ConvertigoMCP.managedTokenLeases';
const minutes = n => n * 60000;
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');

class JavaString {
  constructor(bytes) { this.text = Buffer.from(bytes).toString('utf8'); }
  toString() { return this.text; }
}

// lib_ConvertigoMCP answers McpManagedTokenCreate like the current one (leased: true) or an older one (a fixed expiry).
function fixture({ leased = true } = {}) {
  const clock = { now: Date.UTC(2026, 9, 30, 8, 0, 0) };
  const secrets = new Map(), session = new Map(), shared = new Map(), creations = [];
  const store = { get: key => (shared.has(key) ? shared.get(key) : null), set: (key, value) => shared.set(key, value) };
  let counter = 0;
  const context = {
    trim: value => String(value ?? '').trim(),
    now: () => clock.now,
    normalizeSkillProfile: options => options.skillProfile || 'generalist',
    callLocalSequence(project, sequence, variables) {
      assert.equal(`${project}.${sequence}`, 'lib_ConvertigoMCP.McpManagedTokenCreate');
      creations.push({ ...variables });
      const id = 'managed_' + String(++counter).padStart(32, '0');
      const iat = Math.floor(clock.now / 1000);
      if (leased && variables.idleSeconds) {
        if (!shared.has(LEASES)) shared.set(LEASES, new Map());
        const idleMs = Number(variables.idleSeconds) * 1000;
        shared.get(LEASES).set(id, JSON.stringify({ idleMs, expiresAt: clock.now + idleMs, maxAt: clock.now + 7 * 86400000 }));
        return { status: 'ok', token: part({ kid: id }) + '.' + part({ kind: 'managed', lease: 'turn', exp: iat + 7 * 86400 }) + '.sig' };
      }
      return { status: 'ok', token: part({ kid: id }) + '.' + part({ kind: 'managed', exp: iat + Number(variables.ttlSeconds) }) + '.sig' };
    },
    unwrapSequenceResult: response => response,
    sharedStorage: () => store,
    sharedSecretGet: handle => String(secrets.get(handle) ?? ''),
    sharedSecretSet: (handle, value) => { secrets.set(handle, String(value)); return true; },
    sharedSecretRemove: handle => secrets.delete(handle),
    UUID: { randomUUID: () => 'uuid-' + (++counter) },
    StandardCharsets: { UTF_8: 'UTF-8' },
    Packages: { java: { util: { Base64: { getUrlDecoder: () => ({ decode: text => Buffer.from(String(text), 'base64url') }) } } } },
    java: { lang: { String: JavaString, Long: { valueOf: value => value } } },
    context: { httpSession: { getAttribute: key => session.get(key) ?? null, setAttribute: (key, value) => session.set(key, value) } }
  };
  vm.runInNewContext(snippets, context);
  const handle = () => context.managedMcpTokenHandle({ userId: 'studio' });
  const lease = () => {
    const token = secrets.get(session.get('lib_ConvertigoAssistant.managedMcpTokenHandle'));
    const id = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).kid;
    return { id, leases: shared.get(LEASES) };
  };
  return { clock, handle, creations, shared, lease };
}

test('the panel asks for a leased token and reuses it while its lease lives, whatever the age of the token', () => {
  const f = fixture();
  const first = f.handle();
  assert.deepEqual(f.creations, [{ label: 'Convertigo Assistant - studio', ttlSeconds: '7200', idleSeconds: '1800' }]);
  // a turn of 5 hours: the MCP and the Agent Bridge slide the lease on its activity
  for (let i = 0; i < 30; i++) {
    f.clock.now += minutes(10);
    const { id, leases } = f.lease();
    leases.set(id, JSON.stringify({ ...JSON.parse(leases.get(id)), expiresAt: f.clock.now + minutes(30) }));
  }
  assert.equal(f.handle(), first, 'still the same token 5 h after its creation');
  assert.equal(f.creations.length, 1);
});

test('a new token once the lease ends, is about to end, or is gone with a restart of the engine', () => {
  const f = fixture();
  const first = f.handle();
  f.clock.now += minutes(26);
  const second = f.handle();
  assert.notEqual(second, first, 'less than the renew skew left');
  assert.equal(f.creations.length, 2);
  f.clock.now += minutes(40);
  const third = f.handle();
  assert.notEqual(third, second, 'ended');
  f.shared.delete(LEASES);
  assert.notEqual(f.handle(), third, 'the engine restarted');
  assert.equal(f.creations.length, 4);
});

test('with an older lib_ConvertigoMCP (no lease) the token keeps its fixed 2 h expiry', () => {
  const f = fixture({ leased: false });
  const first = f.handle();
  f.clock.now += minutes(100);
  assert.equal(f.handle(), first);
  f.clock.now += minutes(16);
  assert.notEqual(f.handle(), first, 'renewed 5 min before its expiry, as before');
  assert.equal(f.creations.length, 2);
});
