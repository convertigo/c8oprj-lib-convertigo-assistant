// The setup called before every Vibe message ran the Bridge's full check, vibe-acp --version twice: 7 to 10 s per
// message, warm ones too (test-nocode). Before a message it now only checks that the agent is installed; the setup
// screen and an installation keep the full check.
// node --test tests/assistant_setup_presence.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

const source = read('js/agent_bridge_client.js');

function setupCall(...args) {
  const calls = [];
  const sandbox = {
    normalizeProvider: value => value,
    providerSequence: (provider, action) => 'agent_' + provider + '_' + action,
    agentSetupPayload: (_state, _options, install) => ({ install: install ? 'true' : 'false', configure: 'true' }),
    bridgeCall: (_state, sequence, payload, timeout) => { calls.push({ sequence, payload, timeout }); return { ok: true, status: 'ready' }; }
  };
  vm.runInNewContext(backendParts(['callAgentSetup']), sandbox);
  const info = sandbox.callAgentSetup({ provider: 'vibe' }, {}, ...args);
  return { info, calls };
}

test('asked before a message, the setup is a presence check', () => {
  const { info, calls } = setupCall(false, true);
  assert.equal(info.sequence, 'agent_vibe_setup');
  assert.equal(info.result.status, 'ready');
  assert.deepEqual(calls[0].payload, { install: 'false', configure: 'true', startupPresenceOnly: 'true' });
});

test('otherwise the Bridge gets the full check, as before', () => {
  assert.equal('startupPresenceOnly' in setupCall(false).calls[0].payload, false);
  assert.equal('startupPresenceOnly' in setupCall(true, false).calls[0].payload, false);
});

test('only sending a message asks for it', () => {
  const callers = source.match(/callAgentSetup\([^)]*\)/g).filter(call => !call.startsWith('callAgentSetup(state, options, installOverride'));
  assert.deepEqual(callers.filter(call => call.endsWith(', true)')), ['callAgentSetup(state, options, installRequested, true)']);
  const send = source.slice(source.indexOf('C8O.assistantAgentBridge.sendMessage = function'), source.indexOf('C8O.assistantAgentBridge.readResponse = function'));
  assert.ok(send.includes('callAgentSetup(state, options, installRequested, true)'));
});
