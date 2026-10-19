const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');

function load() {
  const sandbox = { trim: v => String(v ?? '').trim(), now: () => 42, isVibeHarness: p => p === 'convertigo' || p === 'vibe', isClaudeHarness: p => p === 'claude', agentCommandsFor: st => (st && st.commands) || [] };
  vm.runInNewContext(backendParts(['rememberAgentPlan', 'rememberAgentUsage', 'agentUsageModels', 'agentUsageMetrics', 'rememberAgentCommands', 'agentSlashCommandName']), sandbox);
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
  s.rememberAgentUsage(state, { journalUsage: { cachedTokens: 2700, inputTokens: 4000, costAmount: 20.39, costCurrency: 'USD' }, update: { used: 10, cost: { amount: 29.7, currency: 'USD' } } });
  assert.equal(state.usage.costAmount, 20.39, 'the journal cost replaces the Vibe cost that ignores the cache');
  assert.equal(state.usage.costSource, 'journal');
  s.rememberAgentUsage(state, { update: { used: 10, cost: { amount: 1.5, currency: 'USD' } } });
  assert.equal(state.usage.costSource, 'vibe');
});

test('every model of the session is kept with its cost source, agent first', () => {
  const s = load(), state = { model: 'glm-5-3' };
  s.rememberAgentUsage(state, { update: { used: 10 } });
  assert.deepEqual(JSON.parse(JSON.stringify(state.usage.models)), [], 'no journal: no model rows');
  assert.equal(state.usage.model, 'glm-5-3');
  s.rememberAgentUsage(state, { journalUsage: { requests: 3, inputTokens: 4000, cachedTokens: 2700, outputTokens: 300, cacheRate: 0.675, costAmount: 0.056, costCurrency: 'USD',
    sessionTokens: { inputTokens: 6500, cachedTokens: 2700, outputTokens: 600 },
    models: {
      'subagent:verifier|mistral/mistral-large-4': { model: 'mistral/mistral-large-4', kind: 'subagent', profile: 'verifier', runs: 1, calls: 20, requests: 20, inputTokens: 140000, cachedTokens: 0, outputTokens: 6600, reasoningTokens: 0, costAmount: 0.104, costSource: 'gateway' },
      'mistral/mistral-large-4': { model: 'mistral/mistral-large-4', kind: 'vision', calls: 2, requests: 2, inputTokens: 2500, cachedTokens: 0, outputTokens: 300, reasoningTokens: 0, costAmount: 0.006, costSource: 'gateway' },
      'glm-5-3': { model: 'glm-5-3', kind: 'agent', requests: 3, inputTokens: 4000, cachedTokens: 2700, outputTokens: 300, costAmount: 0.05, costSource: 'journal' } } },
    update: { used: 10, cost: { amount: 0.09, currency: 'USD' } } });
  assert.equal(state.usage.outputTokens, 300);
  assert.equal(state.usage.costAmount, 0.056, 'the session cost of the Bridge, every model included');
  assert.equal(state.usage.costSource, 'journal');
  assert.deepEqual(JSON.parse(JSON.stringify(state.usage.models)), [
    { model: 'glm-5-3', kind: 'agent', profile: '', runs: null, calls: null, requests: 3, inputTokens: 4000, cachedTokens: 2700, outputTokens: 300, costAmount: 0.05, costSource: 'journal' },
    { model: 'mistral/mistral-large-4', kind: 'vision', profile: '', runs: null, calls: 2, requests: 2, inputTokens: 2500, cachedTokens: 0, outputTokens: 300, costAmount: 0.006, costSource: 'gateway' },
    { model: 'mistral/mistral-large-4', kind: 'subagent', profile: 'verifier', runs: 1, calls: 20, requests: 20, inputTokens: 140000, cachedTokens: 0, outputTokens: 6600, costAmount: 0.104, costSource: 'gateway' }], 'agent, vision, then sub-agent rows');
  assert.deepEqual(JSON.parse(JSON.stringify(state.usage.sessionTokens)), { inputTokens: 6500, cachedTokens: 2700, outputTokens: 600 });
  s.rememberAgentUsage(state, { journalUsage: { models: { 'vision:x': { kind: 'vision', calls: 1, costAmount: null, costSource: '' } } }, update: { used: 10 } });
  assert.equal(state.usage.models[0].model, 'x', 'the key prefix is not shown as a model name');
  assert.equal(state.usage.models[0].costAmount, null, 'an unknown cost stays unknown');
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

test('Claude Code commands are sent as typed, from its announced list or its built-in ones', () => {
  const s = load(), state = { provider: 'claude' };
  assert.equal(s.agentSlashCommandName(state, '/context'), 'context');
  assert.equal(s.agentSlashCommandName(state, '/cost'), 'cost');
  assert.equal(s.agentSlashCommandName(state, '/compact keep the plan'), 'compact');
  assert.equal(s.agentSlashCommandName(state, '/help'), '');
  s.rememberAgentCommands(state, { update: { availableCommands: [
    { name: 'compact', description: 'Clear history but keep a summary' }, { name: 'convertigo-generalist', description: 'Skill' }] } });
  assert.equal(s.agentSlashCommandName(state, '/convertigo-generalist build it'), 'convertigo-generalist');
  assert.equal(s.agentSlashCommandName(state, '/context'), '');
  assert.equal(s.agentSlashCommandName({ provider: 'claude' }, 'please /context'), '');
});

test('a run event saved for the history keeps its call and truncates a long detail', () => {
  const sandbox = { trim: v => String(v ?? '').trim(), RUN_DETAIL_MAX_DETAIL: 10 };
  vm.runInNewContext(backendParts(['runDetailEvent']), sandbox);
  const saved = sandbox.runDetailEvent({ key: 'tool:1', type: 'tool', title: 'bash: ls', status: 'completed', detail: '0123456789abcdef', callId: 'c1', at: 5, completedAt: 9, current: true });
  assert.equal(saved.detail, '0123456789\n…');
  assert.equal(saved.callId, 'c1');
  assert.equal(saved.completedAt, 9);
  assert.equal(saved.current, undefined, 'a saved event is never running');
});

test('the session measures of the Bridge are kept in the usage, eight tools at most', () => {
  const s = load(), state = {};
  const tools = Array.from({ length: 10 }, (_, i) => ({ name: 'tool' + i, calls: 10 - i, failures: i === 0 ? 1 : 0, durationMs: 1000 }));
  s.rememberAgentUsage(state, { journalUsage: { cachedTokens: 1, inputTokens: 2, metrics: { activeMs: 60000, wallMs: 90000, requests: 7, toolCalls: 4, toolFailures: 1, tools, sleeps: { count: 1, durationMs: 3000 }, builderWaits: { count: 0, durationMs: 0 }, compactions: null } }, update: { used: 10 } });
  assert.equal(state.usage.metrics.requests, 7);
  assert.equal(state.usage.metrics.tools.length, 8);
  assert.equal(state.usage.metrics.tools[0].failures, 1);
  assert.equal(state.usage.metrics.sleeps.durationMs, 3000);
  assert.equal(state.usage.metrics.compactions, null, 'an unknown compaction count is not 0');
});
