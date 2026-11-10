// The Tigo budget and the No Code per-user keys in the Assistant (tigo-nocode-contract.md sections 5, 6 and 8):
// a Convertigo turn is refused before anything is written when the effective balance is zero or below (Studio and No
// Code); on a No Code server whose C8Oforms issues user keys, the user's key is asked to C8Oforms without a log and
// only its handle goes to the Bridge; a turn the gateway stopped on a used-up budget ends with its level and reset
// date read again, or a generic sentence; the No Code quota arc reads the user's C8Oforms quota.
// node --test tests/tigo_budget_gate.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { backendParts, ts, pageClass } = require('./helpers/assistant-source.cjs');

const src = fs.readFileSync(path.resolve(__dirname, '../js/agent_bridge_client.js'), 'utf8');
function assignment(name) {
  const start = src.indexOf('  C8O.assistantAgentBridge.' + name + ' = function');
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(start, k + 2);
  }
}

const NAMES = ['c8oformsSequenceAvailable', 'userGatewayKeysOn', 'usesConvertigoGateway', 'gatewayKeyHandleOf', 'callLocalSequenceQuietly',
  'userGatewayKeyHandle', 'forgetUserGatewayKey', 'userTigoQuota', 'usdValue', 'tigoBudgetScope', 'effectiveTigoBalance', 'twoDigits',
  'formatResetDate', 'budgetExhaustedMessage', 'userKeyRefusalMessage', 'convertigoTurnRefusalResponse', 'convertigoTurnRefusal',
  'readConvertigoBalance', 'isBudgetError', 'budgetErrorAnswer', 'gatewayRateLimitIsBudget', 'bridgeRefusalAnswer', 'attachGatewayKeyHandle',
  'lang', 'extractAgentErrorText', 'purgeUserGatewayKeys'];
const CONSTANTS = ['USER_KEY_SEQUENCE', 'USER_QUOTA_SEQUENCE', 'USER_KEY_SERVER_SYMBOL', 'GATEWAY_KEY_HANDLE_PREFIX', 'GATEWAY_KEY_TTL_MS', 'GATEWAY_KEY_PATTERN',
  'GATEWAY_KEY_TURN_MARGIN_MS', 'GATEWAY_KEY_PURGE_MS', 'GATEWAY_KEY_INDEX',
  'TIGO_BUDGET_SCOPES', 'AGENT_ACCESS_PROJECT', 'TRANSLATIONS'];
const USER_KEY = 'sk-user-' + 'a'.repeat(32);

function load({ studio = false, sequences = ['APIV2_TigoUserKey', 'APIV2_TigoUserQuota'], key = { status: 'ok', key: USER_KEY, generation: 2 },
  quota = null, tigoAccess = { status: 'ok', state: 'ready', quota: null }, tigoStatus = null, nolog = null, registered = true } = {}) {
  const calls = [];
  const mdc = [];
  let mdcValue = nolog;
  const store = new Map();
  let clock = 1_000_000;
  const sandbox = {
    trim: value => String(value ?? '').trim(),
    log: { warn() {} },
    now: () => clock,
    hashShort: value => require('node:crypto').createHash('sha256').update(String(value)).digest('hex').slice(0, 16),
    normalizeProvider: value => String(value || 'vibe').trim().toLowerCase(),
    normalizeSkillProfile: options => (options && options.skillProfile === 'nocode' ? 'nocode' : 'generalist'),
    sharedSecretGet: handle => store.get(handle) || '',
    sharedSecretSet: (handle, value) => store.set(handle, String(value)),
    sharedSecretRemove: handle => store.delete(handle),
    unwrapSequenceResult: response => response && response.document && response.document.result,
    Packages: { org: { apache: { log4j: { MDC: { get: () => mdcValue, put: (k, v) => { mdcValue = v; mdc.push(['put', k, v]); },
      remove: k => { mdcValue = null; mdc.push(['remove', k]); } } } } } },
    Engine: {
      isStudioMode: () => studio,
      theApp: { databaseObjectsManager: {
        getOriginalProjectByName: name => (name === 'C8Oforms' ? { getSequenceByName: sequence => (sequences.includes(sequence) ? {} : null) } : null),
        symbolsGetValue: name => (name === 'C8Oforms.tigo.server.id' && registered ? 'server-test' : null)
      } }
    },
    callLocalSequence(project, sequence, variables) {
      calls.push({ project, sequence, variables, nolog: mdc.length > 0 && mdc[mdc.length - 1][0] === 'put' });
      if (sequence === 'APIV2_TigoUserKey') {
        if (key instanceof Error) throw key;
        return { document: { result: key } };
      }
      if (sequence === 'APIV2_TigoUserQuota') {
        if (quota instanceof Error) throw quota;
        return { document: { result: quota } };
      }
      if (sequence === 'TigoAccessStatus') {
        if (tigoStatus instanceof Error) throw tigoStatus;
        return { document: { response: tigoStatus } };
      }
      throw new Error('unexpected ' + sequence);
    },
    C8O: { assistantAgentBridge: { refreshTigoAccess: () => { calls.push({ sequence: 'TigoAccessBootstrap' }); if (tigoAccess instanceof Error) throw tigoAccess; return tigoAccess; } } }
  };
  vm.runInNewContext(backendParts(NAMES, CONSTANTS) + '\n' + assignment('noCodeTigoQuota'), sandbox);
  return { sandbox, calls, mdc, store, tick: ms => { clock += ms; } };
}

const NOCODE = { skillProfile: 'nocode', userId: 'ann@example.com', provider: 'convertigo', model: 'glm-5-3', language: 'en', threadid: 't1' };
const STUDIO = { skillProfile: 'generalist', userId: 'studio', provider: 'convertigo', model: 'glm-5-3', language: 'fr', threadid: 't2' };
const contractQuota = (balanceUsd, extra = {}) => ({ status: 'ok', quota: {
  member: { budgetUsd: 5, spentUsd: 5 - (balanceUsd ?? 0), balanceUsd, resetAt: '2026-12-01T00:00:00Z' },
  team: { envelopeUsd: 100, spentUsd: 40, balanceUsd: 60, resetAt: '2026-12-01T00:00:00Z' },
  effective: Object.assign({ balanceUsd, resetAt: '2026-12-01T00:00:00Z', scope: 'member' }, extra),
  key: { state: 'active', generation: 2 } } });

test('the effective balance: the contract shape, TigoAccess getQuota, unknown and unlimited are never zero', () => {
  const { sandbox } = load();
  const of = q => JSON.parse(JSON.stringify(sandbox.effectiveTigoBalance(q)));
  assert.deepEqual(of(contractQuota(0).quota), { balanceUsd: 0, resetAt: '2026-12-01T00:00:00Z', scope: 'member', exhausted: true });
  assert.equal(of(contractQuota(-0.4).quota).exhausted, true, 'crossed by reservations');
  assert.equal(of(contractQuota(1.5).quota).exhausted, false);
  assert.equal(of(contractQuota(null).quota).exhausted, false, 'unknown');
  assert.equal(of(contractQuota('').quota).balanceUsd, null, 'an empty XML value is unknown');
  assert.equal(of(contractQuota('0').quota).exhausted, true, 'a text zero from the XML answer is a real zero');
  assert.equal(of(contractQuota(0, { unlimited: 'true' }).quota).exhausted, false, 'unlimited');
  assert.equal(of(contractQuota(0, { scope: 'Team=x' }).quota).scope, 'unknown', 'only the contract scopes');
  // TigoAccess (Studio)
  assert.deepEqual(of({ activeScope: 'personal', balanceUsd: 0, keyState: 'exhausted' }), { balanceUsd: 0, resetAt: '', scope: 'key', exhausted: true });
  const team = { budgetUsd: 1000, balanceUsd: 900, member: { balanceUsd: 0, budgetUsd: 50, budgetResetAt: '2026-11-30T00:00:00Z' } };
  assert.deepEqual(of({ activeScope: 'team', balanceUsd: 900, keyState: 'active', team }), { balanceUsd: 0, resetAt: '2026-11-30T00:00:00Z', scope: 'member', exhausted: true });
  assert.equal(of({ activeScope: 'team', balanceUsd: 0, keyState: 'active', team: Object.assign({}, team, { balanceUsd: 0, member: { balanceUsd: 3 } }) }).scope, 'team');
  assert.equal(of({ activeScope: 'team', balanceUsd: 900, team: Object.assign({}, team, { member: { balanceUsd: 0, budgetReported: false } }) }).exhausted, false,
    'a member cap that was not reported is not a zero');
  assert.equal(of({ activeScope: 'personal', balanceUsd: 4, team: Object.assign({}, team) }).exhausted, false, 'the team only counts when it is the active scope');
  assert.equal(of({}).balanceUsd, null);
});

test('Studio: a Convertigo turn on an exhausted TigoAccess quota is refused before anything is written', () => {
  const exhausted = { status: 'ok', state: 'ready', quota: { activeScope: 'team', balanceUsd: 10, keyState: 'active',
    team: { balanceUsd: 10, member: { balanceUsd: 0, budgetResetAt: '2026-11-30T00:00:00Z' } } } };
  const { sandbox, calls } = load({ studio: true, tigoAccess: exhausted });
  const options = {};
  const refused = sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO), options);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 'failed');
  assert.equal(refused.error.code, 'budget_exceeded');
  assert.equal(refused.error.scope, 'member');
  assert.equal(refused.error.retryable, false);
  assert.equal(refused.error.message, 'Votre budget Tigo est épuisé. Il sera renouvelé le 30/11/2026.');
  assert.equal(options.tigoAccessResult, exhausted, 'the refresh is not made twice');
  assert.equal(calls.filter(call => call.sequence === 'TigoAccessBootstrap').length, 1);
  // a balance left, a manual key (no quota), another agent: the turn goes
  assert.equal(load({ studio: true, tigoAccess: { status: 'ok', state: 'ready', quota: { activeScope: 'personal', balanceUsd: 3 } } }).sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO), {}), null);
  assert.equal(load({ studio: true, tigoAccess: { status: 'ok', state: 'external_key' } }).sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO), {}), null);
  const codex = load({ studio: true, tigoAccess: exhausted });
  assert.equal(codex.sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO, { provider: 'codex' }), {}), null);
  assert.equal(codex.calls.length, 0, 'no TigoAccess call for an agent off the gateway');
  // a failed refresh is left to the turn, which stops on it as before (kept in tigoAccessResult)
  const failed = { status: 'error', code: 'service_unavailable', error: 'down' };
  const kept = {};
  assert.equal(load({ studio: true, tigoAccess: failed }).sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO), kept), null);
  assert.equal(kept.tigoAccessResult, failed);
});

test('No Code: the user key is asked to C8Oforms without a log, kept behind a handle, and the turn refused at zero', () => {
  const { sandbox, calls, mdc, store } = load({ quota: contractQuota(2) });
  const options = { userId: NOCODE.userId };
  assert.equal(sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), options), null);
  assert.match(options.gatewayKeyHandle, /^lib_ConvertigoAssistant\.gatewayKey\.[0-9a-f]{16}$/);
  const keyCall = calls.find(call => call.sequence === 'APIV2_TigoUserKey');
  assert.equal(keyCall.project, 'C8Oforms');
  assert.equal(JSON.stringify(keyCall.variables), '{}', 'the user of the session, never a page value');
  assert.equal(keyCall.nolog, true, 'under the MDC nolog');
  assert.deepEqual(mdc, [['put', 'nolog', true], ['remove', 'nolog']]);
  const silent = load({ nolog: true });
  silent.sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, true);
  assert.deepEqual(silent.mdc.slice(-1), [['put', 'nolog', true]], 'a request already silent stays so');
  const stored = JSON.parse(store.get(options.gatewayKeyHandle));
  assert.equal(stored.key, USER_KEY);
  assert.equal(stored.owner, 'ann@example.com', 'the Bridge checks the owner');
  assert.doesNotMatch(JSON.stringify(options), /sk-/, 'only the handle leaves server memory');
  // zero: refused with the level and the reset date
  const zero = load({ quota: contractQuota(0) });
  const refused = zero.sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId });
  assert.equal(refused.error.code, 'budget_exceeded');
  assert.equal(refused.error.message, 'Your Tigo budget is used up. It renews on 2026-12-01.');
  // an unknown balance or an unread quota lets the turn go: the gateway enforces
  assert.equal(load({ quota: contractQuota(null) }).sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId }), null);
  assert.equal(load({ quota: new Error('down') }).sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId }), null);
  // the Studio, a C8Oforms without user keys, a server not registered with TigoAccess yet: no key asked
  for (const fixture of [load({ studio: true }), load({ sequences: [] }), load({ registered: false })]) {
    fixture.sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId });
    assert.equal(fixture.calls.filter(call => call.sequence === 'APIV2_TigoUserKey').length, 0);
  }
});

test('No Code: a refused key ends the turn with its reason, never another key', () => {
  const messages = {};
  for (const code of ['agent_not_allowed', 'email_missing', 'not_configured', 'key_revoked', 'member_blocked', 'member_limit_reached', 'service_unavailable', 'stale_request', 'revocation_pending']) {
    const { sandbox, store } = load({ key: { status: 'error', error: { code, message: 'TigoAccess said ' + code } } });
    const refused = sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId });
    assert.equal(refused.error.code, code);
    assert.doesNotMatch(refused.error.message, /TigoAccess said/, 'the raw answer is not shown');
    assert.equal(store.size, 0);
    messages[code] = refused.error.message;
  }
  assert.match(messages.agent_not_allowed, /^agent_not_allowed: /);
  assert.match(messages.email_missing, /email address/);
  assert.match(messages.not_configured, /not set up on this server/);
  assert.equal(messages.key_revoked, messages.member_blocked);
  assert.match(messages.member_limit_reached, /full/);
  assert.equal(messages.service_unavailable, messages.stale_request);
  assert.equal(messages.revocation_pending, messages.service_unavailable, 'retry later, like a rate limit');
  // an answer without a usable key, or an exception: no key
  assert.equal(load({ key: { status: 'ok', key: 'not-a-key' } }).sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId }).error.code, 'service_unavailable');
  const thrown = load({ key: new Error('boom ' + USER_KEY) });
  assert.equal(thrown.sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), { userId: NOCODE.userId }).error.code, 'service_unavailable');
  assert.deepEqual(thrown.mdc.slice(-1), [['remove', 'nolog']], 'the guard is removed after a failure');
});

test('the key handle: memory for a few minutes, one per user, forgotten on refusal', () => {
  const { sandbox, calls, store, tick } = load();
  assert.equal(sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, false).ok, false, 'no fetch: memory only');
  const first = sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, true);
  assert.equal(sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, true).handle, first.handle);
  assert.equal(calls.length, 1, 'kept in memory');
  assert.notEqual(sandbox.userGatewayKeyHandle({ userId: 'bob@example.com' }, true).handle, first.handle);
  tick(6 * 60 * 1000);
  sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, true);
  assert.equal(calls.length, 2, 'still in its lifetime for a start');
  sandbox.userGatewayKeyHandle({ userId: 'ann@example.com' }, true, 5 * 60 * 1000);
  assert.equal(calls.filter(call => call.sequence === 'APIV2_TigoUserKey').length, 3, 'a turn needs 5 minutes of it left: asked again');
  // a user gone: forgotten two hours after the end of its lifetime, at the next key asked
  tick(2 * 60 * 60 * 1000 + 11 * 60 * 1000);
  const bob = sandbox.gatewayKeyHandleOf('bob@example.com');
  assert.equal(store.has(bob), true);
  sandbox.userGatewayKeyHandle({ userId: 'carl@example.com' }, true);
  assert.equal(store.has(bob), false, 'purged');
  assert.deepEqual(Object.keys(JSON.parse(store.get('lib_ConvertigoAssistant.gatewayKey.index'))).length, 1);
  sandbox.forgetUserGatewayKey({ userId: 'ann@example.com' });
  assert.equal(store.has(first.handle), false);
  assert.equal(sandbox.userGatewayKeyHandle({}, true).code, 'authentication_required');
});

test('no key is asked for an agent off the gateway (it would enrol the user), nor by a prewarm', () => {
  const { sandbox, calls } = load();
  const payload = {};
  sandbox.attachGatewayKeyHandle(payload, Object.assign({}, NOCODE, { provider: 'codex' }), 'agent_codex_start');
  assert.equal(payload.gatewayKeyHandle, undefined);
  const prewarm = { prewarm: 'true' };
  sandbox.attachGatewayKeyHandle(prewarm, Object.assign({}, NOCODE), 'agent_vibe_start');
  assert.equal(prewarm.gatewayKeyHandle, undefined, 'the panel opening never waits for TigoAccess');
  assert.equal(calls.length, 0);
});

test("TigoAccess's getQuota of a managed team's key: its contract shape decides, a revoked key is not a budget", () => {
  const { sandbox } = load();
  const of = q => JSON.parse(JSON.stringify(sandbox.effectiveTigoBalance(q)));
  const legacy = { activeScope: 'team', balanceUsd: 3, keyState: 'active', team: { balanceUsd: 40, member: { balanceUsd: 3 } } };
  const contract = { member: { budgetUsd: 5, spentUsd: 5, balanceUsd: 0, resetAt: '2026-12-01T00:00:00Z' },
    team: { envelopeUsd: 100, spentUsd: 60, balanceUsd: 40, resetAt: null }, effective: { balanceUsd: 0, resetAt: '2026-12-01T00:00:00Z', scope: 'member' },
    key: { state: 'active', generation: 1 } };
  assert.deepEqual(of(Object.assign({}, legacy, { surface: 'server', contract })), { balanceUsd: 0, resetAt: '2026-12-01T00:00:00Z', scope: 'member', exhausted: true });
  const revoked = Object.assign({}, contract, { key: { state: 'revoked', generation: 1 } });
  assert.equal(of(Object.assign({}, legacy, { contract: revoked })).exhausted, false);
  assert.equal(of(revoked).exhausted, false, 'the No Code quota too');
});

test('a conversation of another account, a revoked key, a failed refresh: never a budget refusal by mistake', () => {
  const { sandbox, calls } = load({ quota: contractQuota(2) });
  const foreign = sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE, { userId: 'bob@example.com' }), { userId: 'ann@example.com' });
  assert.equal(foreign.error.code, 'conversation_not_owned');
  assert.equal(calls.length, 0, 'no key asked for it');
  assert.equal(sandbox.convertigoTurnRefusal(Object.assign({}, NOCODE), {}).error.code, 'conversation_not_owned', 'no caller');
  const { sandbox: studio } = load();
  for (const keyState of ['revoked', 'blocked', 'expired']) {
    assert.equal(studio.effectiveTigoBalance({ activeScope: 'team', balanceUsd: 0, keyState, team: { balanceUsd: 0 } }).exhausted, false, keyState);
  }
  const thrown = load({ studio: true, tigoAccess: new Error('TigoAccess down') });
  const options = {};
  assert.equal(thrown.sandbox.convertigoTurnRefusal(Object.assign({}, STUDIO), options), null);
  assert.equal(options.tigoAccessResult.status, 'error', 'the turn stops on it as before');
});

test('the Bridge calls carry the handle: a start or setup asks for the key, a prompt or a settings read uses memory', () => {
  const { sandbox, calls } = load();
  const state = Object.assign({}, NOCODE);
  const prompt = {};
  sandbox.attachGatewayKeyHandle(prompt, state, 'agent_vibe_prompt');
  assert.equal(prompt.gatewayKeyHandle, undefined, 'nothing in memory yet');
  const start = {};
  sandbox.attachGatewayKeyHandle(start, state, 'agent_vibe_start');
  assert.match(start.gatewayKeyHandle, /^lib_ConvertigoAssistant\.gatewayKey\./);
  for (const sequence of ['agent_vibe_prompt', 'agent_claude_prompt', 'agent_settings', 'agent_vibe_setup']) {
    const payload = {};
    sandbox.attachGatewayKeyHandle(payload, state, sequence);
    assert.equal(payload.gatewayKeyHandle, start.gatewayKeyHandle, sequence);
  }
  assert.equal(calls.filter(call => call.sequence === 'APIV2_TigoUserKey').length, 1);
  const other = {};
  sandbox.attachGatewayKeyHandle(other, state, 'agent_events');
  assert.equal(other.gatewayKeyHandle, undefined, 'not on the event reads');
  const studio = load({ studio: true });
  const studioPayload = {};
  studio.sandbox.attachGatewayKeyHandle(studioPayload, state, 'agent_vibe_start');
  assert.equal(studioPayload.gatewayKeyHandle, undefined);
  assert.equal(studio.calls.length, 0);
});

test('a turn the gateway stopped on a used-up budget ends with its level and reset date, or the generic sentence', () => {
  const { sandbox, calls } = load({ quota: contractQuota(0, { scope: 'team' }) });
  const state = Object.assign({ runid: 'r1' }, NOCODE);
  const event = { code: 'budget_exceeded', scope: 'member', retryable: false, message: 'budget_exceeded: The Tigo budget is used up.' };
  assert.equal(sandbox.isBudgetError(event), true);
  assert.equal(sandbox.isBudgetError({ budget: { code: 'budget_exceeded', scope: 'key' } }), true);
  assert.equal(sandbox.isBudgetError({ message: 'Rate limit exceeded' }), false);
  assert.equal(sandbox.budgetErrorAnswer(state, event), "Your team's Tigo budget is used up. It renews on 2026-12-01.", 'the quota read again says team');
  assert.equal(sandbox.budgetErrorAnswer(state, event), state.budgetAnswer, 'once per run');
  assert.equal(calls.filter(call => call.sequence === 'APIV2_TigoUserQuota').length, 1);
  assert.equal(state.errorCode, 'budget_exceeded');
  const unread = load({ quota: new Error('down') });
  assert.equal(unread.sandbox.budgetErrorAnswer(Object.assign({ runid: 'r2' }, NOCODE), event), 'Your Tigo budget is used up.', 'the generic sentence');
  // Studio: TigoAccess's quota
  const studio = load({ studio: true, tigoStatus: { status: 'ok', quota: { activeScope: 'personal', balanceUsd: 0, keyState: 'exhausted' } } });
  assert.equal(studio.sandbox.budgetErrorAnswer(Object.assign({ runid: 'r3' }, STUDIO), event), 'Le crédit Tigo de cette clé est épuisé.');
  // a rate limit is a budget only when the quota says so
  const rate = { error: { code: -31001, message: 'Rate limit exceeded for convertigo (model: glm-5-3).' } };
  assert.equal(load({ quota: contractQuota(0) }).sandbox.gatewayRateLimitIsBudget(Object.assign({ runid: 'r4' }, NOCODE), rate), true);
  const left = load({ quota: contractQuota(3) });
  const leftState = Object.assign({ runid: 'r5' }, NOCODE);
  assert.equal(left.sandbox.gatewayRateLimitIsBudget(leftState, rate), false);
  assert.equal(left.sandbox.gatewayRateLimitIsBudget(leftState, rate), false);
  assert.equal(left.calls.length, 1, 'one quota read per run');
  assert.equal(left.sandbox.gatewayRateLimitIsBudget(Object.assign({}, leftState, { provider: 'codex', runid: 'r6' }), rate), false);
});

test('a start or prompt the Bridge refused reads as a sentence', () => {
  const { sandbox, store } = load({ quota: new Error('down') });
  const state = Object.assign({ runid: 'r1' }, NOCODE);
  store.set(sandbox.gatewayKeyHandleOf('ann@example.com'), '{}');
  assert.equal(sandbox.bridgeRefusalAnswer(state, 'Error: gateway_credential_missing: The Tigo key of this account is not available.'),
    'The Tigo key of your account could not be obtained. Try again in a moment.');
  assert.equal(store.size, 0, 'the next turn asks C8Oforms again');
  assert.match(sandbox.bridgeRefusalAnswer(state, 'Error: agent_isolation_unavailable: ...'), /cannot run on this server with per-user Tigo keys/);
  assert.equal(sandbox.bridgeRefusalAnswer(state, 'Error: budget_exceeded: The Tigo budget is used up.'), 'Your Tigo budget is used up.');
  assert.equal(sandbox.bridgeRefusalAnswer(state, 'Error: something else'), '');
});

test('the No Code quota arc reads the user\'s C8Oforms quota as the Studio arc reads TigoAccess', () => {
  const { sandbox } = load({ quota: contractQuota(0) });
  const answer = JSON.parse(JSON.stringify(sandbox.C8O.assistantAgentBridge.noCodeTigoQuota({ userId: 'ann@example.com' })));
  assert.equal(answer.status, 'ok');
  const q = answer.quota;
  assert.equal(q.provider, 'convertigo');
  assert.equal(q.kind, 'credit');
  assert.equal(q.available, true);
  assert.equal(q.activeScope, 'team');
  assert.equal(q.keyState, 'exhausted');
  assert.equal(q.team.member.balanceUsd, 0);
  assert.equal(q.team.member.budgetResetAt, '2026-12-01T00:00:00Z');
  assert.equal(q.team.budgetUsd, 100);
  assert.doesNotMatch(JSON.stringify(answer), /sk-|ann@example|generation/, 'no key, email or key generation');
  assert.equal(load({ studio: true }).sandbox.C8O.assistantAgentBridge.noCodeTigoQuota({}), null, 'the Studio keeps TigoAccessStatus');
  assert.equal(load({ sequences: ['APIV2_TigoUserKey'] }).sandbox.C8O.assistantAgentBridge.noCodeTigoQuota({}), null, 'a C8Oforms without the quota');
  const down = JSON.parse(JSON.stringify(load({ quota: new Error('down') }).sandbox.C8O.assistantAgentBridge.noCodeTigoQuota({})));
  assert.equal(down.status, 'error');
  assert.equal(down.quota.available, false, 'the arc stays neutral');
  // the panel draws it with the Studio's rules: an exhausted member is a full red arc
  const code = ts.transpileModule(pageClass(), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const box = {};
  vm.runInNewContext(code + ';this.Page=Page;', box);
  const page = new box.Page();
  page.global = { language: 'fr' }; page.translate = { currentLang: 'fr' };
  page.local = { Conversation: 'c', AgentQuotaConversation: 'c', AgentQuota: q };
  page.isAgentBridgeMode = () => true; page.getAgentProvider = () => 'convertigo'; page.getAgentProviderLabel = () => 'Tigo';
  const view = page.getAgentQuotaView();
  assert.equal(view.percent, 100);
  assert.equal(view.color, '#ef4444');
  assert.match(view.summary, /Crédit épuisé/);
});

test('every place keeps its guard: before the turn is written, on the error events, on a refused start, in the arc and the page', () => {
  assert.match(src, /var convertigoRefusal = convertigoTurnRefusal\(state, options\);\n    if \(convertigoRefusal !== null\) \{\n      return convertigoRefusal;\n    \}\n    state\.status = "starting";/);
  assert.match(src, /var tigoAccess = options\.tigoAccessResult \|\| C8O\.assistantAgentBridge\.refreshTigoAccess\(\);/);
  assert.match(src, /if \(isBudgetError\(data\) \|\| gatewayRateLimitIsBudget\(state, data\)\) \{\n\s+state\.error = budgetErrorAnswer\(state, data\);/);
  assert.match(src, /if \(userGatewayKeysOn\(state\) && agentHttpErrorStatus\(data, 0\) === 401\) \{\n\s+forgetUserGatewayKey\(state\);/);
  assert.match(src, /state\.error = bridgeRefusalAnswer\(state, String\(e\)\) \|\| String\(e\);/);
  assert.match(src, /attachMcpTokenHandle\(payload, options\);\n    \}\n    attachGatewayKeyHandle\(payload, options, sequence\);/);
  const quota = fs.readFileSync(path.resolve(__dirname, '../_c8oProject/sequences/AgentQuota.yaml'), 'utf8');
  assert.match(quota, /if\(provider==="convertigo"&&!studio\)\{include\("js\/agent_bridge_client\.js"\);var noCodeQuota=C8O\.assistantAgentBridge\.noCodeTigoQuota\(\{userId:trustedUserId\}\);/);
  const page = fs.readFileSync(path.resolve(__dirname, '../_c8oProject/mobilePages/Page.yaml'), 'utf8');
  assert.match(page, /if \(vars\.error && vars\.error\.code === "budget_exceeded" && typeof page\.requestAgentQuota === "function"\) \{\n\s+page\.requestAgentQuota\(true\);/);
  for (const language of ['fr', 'en']) {
    const block = src.slice(src.indexOf('    ' + language + ': {', src.indexOf('var TRANSLATIONS')));
    for (const name of ['budgetExhausted', 'budgetTeamExhausted', 'budgetKeyExhausted', 'budgetRenews', 'userKeyUnavailable', 'userKeyEmailMissing',
      'userKeyNotConfigured', 'userKeyRevoked', 'userKeyTeamFull', 'agentIsolationUnavailable']) {
      assert.match(block.slice(0, block.indexOf('\n    }')), new RegExp('\\n      ' + name + ': "'), language + ' ' + name);
    }
  }
});
