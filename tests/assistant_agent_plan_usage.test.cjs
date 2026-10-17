const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');

function load() {
  const sandbox = { trim: v => String(v ?? '').trim(), now: () => 42, isVibeHarness: p => p === 'convertigo' || p === 'vibe' };
  vm.runInNewContext(backendParts(['rememberAgentPlan', 'rememberAgentUsage', 'rememberAgentCommands', 'agentSlashCommandName']), sandbox);
  return sandbox;
}

test('a Vibe plan update becomes the task list of the run', () => {
  const s = load(), state = { runid: 'run-1' };
  s.rememberAgentPlan(state, { update: { sessionUpdate: 'plan', entries: [
    { content: 'Lire la spécification', status: 'completed', priority: 'high' },
    { content: 'Créer les transactions', status: 'in_progress' },
    { content: 'Tester', status: 'whatever' },
    { content: '   ', status: 'pending' }] } });
  assert.deepEqual(JSON.parse(JSON.stringify(state.plan)), { entries: [
    { content: 'Lire la spécification', status: 'completed', priority: 'high' },
    { content: 'Créer les transactions', status: 'in_progress', priority: '' },
    { content: 'Tester', status: 'pending', priority: '' }], runid: 'run-1', updatedAt: 42 });
});

test('a usage update keeps the context, the threshold and the session totals', () => {
  const s = load(), state = {};
  s.rememberAgentUsage(state, { autoCompactThreshold: 200000, contextWindow: 1000000, update: { used: 51200, size: 262144, cost: { amount: 0.42, currency: 'USD' },
    _meta: { steps: 12, promptTokens: 900000, completionTokens: 12000, cachedTokens: 600000, totalTokens: 912000, tokensPerSecond: 38.5, lastTurnDuration: 95.2, lastTurnTotalTokens: 51000 } } });
  assert.equal(state.usage.used, 51200);
  assert.equal(state.usage.threshold, 200000);
  assert.equal(state.usage.window, 1000000);
  assert.equal(state.usage.costAmount, 0.42);
  assert.equal(state.usage.cachedTokens, 600000);
  assert.equal(state.usage.lastTurnDuration, 95.2);
  s.rememberAgentUsage(state, { update: { used: 10 } });
  assert.equal(state.usage.threshold, null);
  assert.equal(state.usage.window, null);
  assert.equal(state.usage.costAmount, null);
});

test('cached tokens come from the Vibe journal and stay unknown without it', () => {
  const s = load(), state = {};
  s.rememberAgentUsage(state, { update: { used: 10, _meta: { cachedTokens: 0 } } });
  assert.equal(state.usage.cachedTokens, null, 'the 0 of the unified harness is not a real value');
  s.rememberAgentUsage(state, { journalUsage: { requests: 3, inputTokens: 4000, cachedTokens: 2700, cacheRate: 0.675 }, update: { used: 10, _meta: { cachedTokens: 0 } } });
  assert.equal(state.usage.cachedTokens, 2700);
  assert.equal(state.usage.inputTokens, 4000);
  assert.equal(state.usage.cacheRate, 0.675);
});

test('slash commands are recognised from the commands Vibe advertised', () => {
  const s = load(), state = { provider: 'convertigo' };
  s.rememberAgentCommands(state, { update: { availableCommands: [
    { name: 'compact', description: 'Compact conversation history', input: { hint: 'Optional instructions' } },
    { name: 'bad name' }, { name: 'help', description: 'Help' }] } });
  assert.deepEqual(JSON.parse(JSON.stringify(state.commands.map(c => c.name))), ['compact', 'help']);
  assert.equal(state.commands[0].hint, 'Optional instructions');
  assert.equal(s.agentSlashCommandName(state, '/compact keep the demo accounts'), 'compact');
  assert.equal(s.agentSlashCommandName(state, '/HELP'), 'help');
  assert.equal(s.agentSlashCommandName(state, '/reload'), '');
  assert.equal(s.agentSlashCommandName(state, 'compact /compact'), '');
  assert.equal(s.agentSlashCommandName({ provider: 'codex', commands: state.commands }, '/compact'), '');
  assert.equal(s.agentSlashCommandName({ provider: 'vibe' }, '/compact now'), 'compact');
});
