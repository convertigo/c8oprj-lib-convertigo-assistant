// Two defects of the 27/11 TigoAccess triage, on the read of a running turn (readResponseOf):
// - e1349aa7, 1ffa451a (Toulouse, 24/11): the managed MCP token of a Vibe process ended with its lease and Vibe kept it,
//   so its Convertigo tools answered "MCP token expired" and then disappeared. The Agent Bridge cannot create a token;
//   this read runs in the user's session, which can: when the Bridge's state says mcpTokenRenewal "needed", the handle of
//   a live token goes with an agent_events read, and the Bridge restarts Vibe with it within the turn.
// - 9c3d8e62 (ACOSS, 26/11): every error event of the stream failed the run and was reported, including the answers of
//   other requests than its prompt (a setting Vibe refused during its turn, a second prompt), and one failed prompt counted
//   twice (its turn/error, then its acp/response_error). A turn Vibe refused as busy is told as such, not as a defect.
// node --test tests/assistant_mcp_token_renewal.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const texts = { closedEarly: 'The task stopped before completion.', bridgeStateRecover: 'I am checking that the task is still running.',
  bridgeProcessLost: 'The task was interrupted.', thinking: 'Thinking', toolRetry: 'retry',
  turnBusy: 'Tigo was still finishing a previous turn of this conversation, so your message was not sent. Send it again in a moment.' };
const running = () => ({ threadid: 'agent-t', handle: 'vibe-t', provider: 'convertigo', userId: 'studio', status: 'in_progress', runid: 'run-7',
  cursor: 10, answer: '', progressEvents: [], warnings: [], runErrorRequestIds: [] });

// readResponseOf in a sandbox: the Bridge answers each agent_events read with the next of `answers`.
function fixture(stored, answers, { tokens = ['h-new'] } = {}) {
  let store = clone(stored);
  const calls = [], reported = [], created = [];
  const sandbox = {
    bridgeCallerRefusal: () => null, withCallerUserId: o => o || {}, normalizeThreadId: v => String(v || ''), trim: v => String(v == null ? '' : v).trim(),
    readState: () => clone(store), recoverState: () => { throw new Error('unexpected recoverState'); }, ensureState: v => v,
    isResidentProvider: () => false, keepUserGatewayKeyAlive() {}, intValue: (v, d) => d, DEFAULT_EVENT_WAIT_MS: 10000,
    bridgeCall: (_state, sequence, params) => { calls.push({ sequence, params: clone(params) }); return clone(answers.length > 1 ? answers.shift() : answers[0]); },
    lockConversationRead: () => ({}), unlockConversationRead() {}, latestSavedState: s => s, recordedByAnotherReader: () => false, lang: () => texts,
    appendProgress(state, text) { state.progressLog = (state.progressLog ? state.progressLog + '\n' : '') + text; },
    appendProgressLine() {}, appendTranscript() {}, now: () => 1, readEarlyAgentCommands() {}, syncSubagentRuns() {}, markProgressEventsIdle() {},
    cancellationRequested: () => false, ingestFeedback() {}, completedFallbackAnswer: () => '', answerLooksIncomplete: () => false,
    saveState: s => { store = clone(s); }, setStateBuffer() {}, responseForState: s => ({ status: s.status, explanation: s.answer || s.error || '' }),
    finishTurnReasoning() {}, rememberBridgeWarning() {}, collectFeedbackMcpConnect() {},
    collectFeedbackRuntimeError: (_state, message) => reported.push(message),
    extractAgentErrorText: data => (data && data.error && data.error.message) || '',
    isBudgetError: () => false, gatewayRateLimitIsBudget: () => false, userGatewayKeyRejected: () => false, isCodexAuthenticationError: () => false,
    userFacingAgentError: (_state, data) => 'Agent error: ' + ((data && data.error && data.error.message) || ''),
    managedMcpTokenHandle: state => {
      created.push(state.userId);
      if (!tokens.length) throw new Error('Unable to create the managed Convertigo MCP token: WEB_ADMIN authentication is required');
      return tokens.shift();
    },
    log: { warn() {} }
  };
  vm.runInNewContext(backendParts(['readResponseOf', 'bridgeProcessGone', 'keepRunAliveAfterBridgeReadFailure', 'bridgeProcessLostMessage', 'isTerminalStatus',
    'endTurnOnLostAgent', 'handMcpTokenRenewal', 'mcpTokenRenewalHandle', 'agentErrorEndsRun', 'rememberRunErrorRequest'],
    ['MAX_TRANSIENT_READ_ERRORS']), sandbox);
  return { read: () => sandbox.readResponseOf({ threadid: 'agent-t' }), saved: () => store, calls, reported, created };
}
const live = (extra) => Object.assign({ status: 'running', alive: true, turnActive: true }, extra || {});
const read = (events, state, nextCursor) => ({ ok: true, status: 'ok', events, nextCursor: nextCursor || 12, state: live(state) });

test('the Bridge asks for a new MCP token: the same read hands one, created in this session, without moving the cursor', () => {
  const expired = { index: 10, type: 'warning', data: { phase: 'mcp/auth', reason: 'mcp_token_expired', resume: true } };
  const f = fixture(running(), [read([expired], { mcpTokenRenewal: 'needed' }, 11), read([], { mcpTokenRenewal: 'received' }, 11)]);
  assert.equal(f.read().status, 'in_progress', 'the turn goes on');
  assert.deepEqual(f.created, ['studio']);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].params.mcpBearerTokenHandle, undefined, 'the first read did not know yet');
  assert.deepEqual(f.calls[1], { sequence: 'agent_events', params: { handle: 'vibe-t', cursor: '11', limit: '1', waitMs: '0', mcpBearerTokenHandle: 'h-new' } });
  assert.equal(f.saved().cursor, 11);
  assert.equal(f.saved().mcpTokenRenewal, '', 'nothing more to give');
});

test('a renewal that did not reach the Bridge goes with the next read', () => {
  const f = fixture(running(), [read([], { mcpTokenRenewal: 'needed' }), read([], { mcpTokenRenewal: 'needed' }), read([], {})], { tokens: ['h-1', 'h-2'] });
  f.read();
  assert.equal(f.saved().mcpTokenRenewal, 'needed');
  f.read();
  assert.equal(f.calls[2].params.mcpBearerTokenHandle, 'h-2', 'the next read carries it from its start');
  assert.equal(f.calls.length, 3, 'no second hand-over in the same read');
  assert.equal(f.saved().mcpTokenRenewal, '');
});

test('a session that cannot create a token gives none, and the turn goes on until the Bridge ends it', () => {
  const f = fixture(running(), [read([], { mcpTokenRenewal: 'needed' })], { tokens: [] });
  assert.equal(f.read().status, 'in_progress');
  assert.equal(f.calls.length, 1, 'no hand-over without a token');
  assert.equal(f.saved().mcpTokenRenewal, 'needed');
});

test('the errors of other requests than the prompt do not end the run', () => {
  const events = [
    { index: 10, type: 'acp/response_error', data: { id: 41, method: 'session/set_config_option', response: { error: { message: 'A turn is already running: turn-3' } } } },
    { index: 11, type: 'turn/error', data: { requestId: 42, otherRequest: true, error: { message: 'A turn is already running' } } },
    { index: 12, type: 'answer/chunk', data: { text: 'Voici la liste.' } }
  ];
  const f = fixture(running(), [read(events, {}, 13)]);
  f.read();
  assert.equal(f.saved().status, 'in_progress');
  assert.deepEqual(f.reported, [], 'nothing reported');
});

test('a failed prompt ends the run once and is reported once (its turn/error, then its acp/response_error)', () => {
  const events = [
    { index: 10, type: 'turn/error', data: { requestId: 5, method: 'session/prompt', error: { message: 'Internal error' } } },
    { index: 11, type: 'acp/response_error', data: { id: 5, method: 'session/prompt', response: { error: { message: 'Internal error' } } } }
  ];
  const f = fixture(running(), [read(events, { turnActive: false }, 12)]);
  f.read();
  assert.equal(f.saved().status, 'failed');
  assert.deepEqual(f.reported, ['Internal error']);
  assert.deepEqual(f.saved().runErrorRequestIds, ['5']);
});

test('a turn Vibe refused as busy says so and is no defect', () => {
  const busy = { index: 10, type: 'turn/error', data: { requestId: 6, method: 'session/prompt', busy: true, error: { code: 'turn_busy', message: 'Tigo was still finishing' } } };
  const f = fixture(running(), [read([busy], { turnActive: false }, 11)]);
  const response = f.read();
  assert.equal(f.saved().status, 'failed');
  assert.equal(response.explanation, texts.turnBusy);
  assert.deepEqual(f.reported, []);
});
