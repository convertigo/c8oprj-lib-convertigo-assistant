// A runtime installed outside the panel that shows the settings (another panel of the Studio reloaded during the
// install, the Studio itself, a terminal) reaches that panel, and a settings answer read before a setup ended never
// replaces the settings that setup brought. node --test tests/agent_runtime_recheck.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');

function recheckClass() {
  const start = page.indexOf('        // The runtime of the chosen agent is in a settings answer.');
  const end = page.indexOf('        public getAgentNotReadyState() {');
  assert.ok(start > 0 && end > start);
  const source = 'class P {\n' + page.slice(start, end) + '\n}';
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  const timers = [];
  const box = { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, Date, document: { hidden: false } };
  const P = vm.runInNewContext(js + '\nP;', box);
  return { P, timers, box };
}

function make(P, state = 'install', local = {}) {
  const p = new P();
  p.local = { AgentProvider: 'convertigo', ...local };
  p.state = state;
  p.calls = [];
  p.normalizeAgentProviderValue = v => String(v || '').trim().toLowerCase();
  p.isAgentProviderReady = e => e.ready === true || e.status === 'ready';
  p.isEmbeddedNoCodeAgent = () => false;
  p.getAgentNotReadyState = () => p.state;
  p.refreshAgentSettingsAfterHostContext = (...args) => p.calls.push(args);
  return p;
}

test('a settings answer tells whether the runtime of the chosen agent is there', () => {
  const { P } = recheckClass();
  const p = make(P);
  const answer = runtime => ({ result: { settings: { providers: [{ id: 'codex', runtime: { installed: true } }, { id: 'Convertigo', status: 'authentication_required', runtime }] } } });
  assert.equal(p.isAgentRuntimeInstalledIn(answer({ installed: true, installedVersion: '3.1.0' })), true);
  assert.equal(p.isAgentRuntimeInstalledIn(answer({ installed: false })), false);
  assert.equal(p.isAgentRuntimeInstalledIn({ result: { settings: { settings: { providers: [{ id: 'convertigo', ready: true }] } } } }), true, 'nested settings, a ready agent');
  assert.equal(p.isAgentRuntimeInstalledIn({}), false);
});

test('while the chosen agent waits for its runtime, what is installed is read again every 10 s, for 10 minutes', () => {
  const { P, timers, box } = recheckClass();
  const p = make(P);
  p.scheduleAgentRuntimeRecheck();
  p.scheduleAgentRuntimeRecheck();
  assert.equal(timers.length, 1, 'one timer at a time');
  assert.equal(timers[0].ms, 10000);
  timers.shift().fn();
  assert.deepEqual(p.calls, [[false, true]], 'a light read (presence recheck)');

  // a setup of this panel, a settings read running, or a hidden panel: it waits
  for (const local of [{ AgentRuntimeLoading: true }, { AgentSettingsRefreshRunning: true }, { AgentRuntimeInstallProvider: 'convertigo' }]) {
    const q = make(P, 'install', local);
    q.scheduleAgentRuntimeRecheck();
    timers.shift().fn();
    assert.deepEqual(q.calls, [], JSON.stringify(local));
    assert.equal(timers.length, 1, 'rescheduled');
    timers.length = 0;
  }
  box.document.hidden = true;
  const hidden = make(P);
  hidden.scheduleAgentRuntimeRecheck();
  timers.shift().fn();
  assert.deepEqual(hidden.calls, []);
  timers.length = 0;
  box.document.hidden = false;

  // ready meanwhile: it stops and its window starts again next time
  const ready = make(P);
  ready.scheduleAgentRuntimeRecheck();
  ready.state = '';
  timers.shift().fn();
  assert.deepEqual(ready.calls, []);
  assert.equal(timers.length, 0);
  assert.equal(ready.agentRuntimeRecheckUntil, 0);

  // after 10 minutes, no more reads
  const late = make(P);
  late.agentRuntimeRecheckUntil = Date.now() - 1;
  late.scheduleAgentRuntimeRecheck();
  assert.equal(timers.length, 0);

  // No Code: its runtime is the server's
  const noCode = make(P);
  noCode.isEmbeddedNoCodeAgent = () => true;
  noCode.scheduleAgentRuntimeRecheck();
  assert.equal(timers.length, 0);
});

test('the settings refresh: a recheck reads presence only, an answer older than the settings of a setup is dropped', () => {
  assert.match(page, /public refreshAgentSettingsAfterHostContext\(forceFullSettings = false, presenceRecheck = false\) \{/);
  assert.match(page, /if \(forceFullSettings !== true && presenceRecheck !== true && this\.hasAgentSettingsProvidersLoaded/);
  assert.match(page, /''runtimePresenceOnly'': forceFullSettings !== true,/);
  assert.match(page, /var requestedAt = Date\.now\(\);\n\s+var settingsRequest: any;/);
  assert.match(page, /if \(settingsPageLeft\(\)\) \{ dropLeftSettingsPage\(\); return; \}\n(\s+\/\/[^\n]*\n){2}\s+if \(\(this\.local\.AgentSettingsFreshAt \|\| 0\) > requestedAt \|\| \(presenceRecheck === true && !this\.isAgentRuntimeInstalledIn\(settingsResponse\)\)\) \{\n\s+this\.local\.AgentSettingsRefreshRunning = false;\n\s+this\.local\.AgentSettingsRefreshDone = true;\n\s+this\.tick\(\);\n\s+return;/);
  // the settings a setup brings are the freshest, in the runtime section and in the setup of a conversation
  assert.match(page, /if \(settings\.providers\) \{ page\.local\.AgentSettings = settings; page\.local\.AgentSettingsFreshAt = Date\.now\(\); \}/);
  assert.match(page, /page\.local\.AgentSettings = settings;\n\s+page\.local\.AgentSettingsFreshAt = Date\.now\(\);\n\s+page\.local\.AgentProvider = provider;/);
  // the note under the agent cards starts the recheck while it says the runtime is not installed
  assert.match(page, /var state = this\.getAgentNotReadyState\(\);\n\s+if \(state !== "install"\) \{\n\s+\(this as any\)\.agentRuntimeRecheckUntil = 0;\n\s+\} else if \(this\.scheduleAgentRuntimeRecheck\) \{\n\s+this\.scheduleAgentRuntimeRecheck\(\);/);
});

test('the stack is not reinstalled while this panel installs an agent (the reinstall reloads the panel and loses it)', () => {
  assert.match(page, /public isAgentSetupRunning\(\) \{\n\s+return !!\(this\.local && this\.local\.AgentRuntimeInstallProvider\);/);
  assert.match(page, /public triggerAgentStackUpdate\(\) \{\n\s+if \(this\.isAgentSetupRunning && this\.isAgentSetupRunning\(\)\) \{\n\s+this\.local\.AgentActivationMessage = this\.t\("Agent_Stack_Wait_Agent_Setup"/);
  assert.match(page, /view\.updateDisabled \|\| this\.isAgentStackOfferTurnRunning\(\) \|\| \(this\.isAgentSetupRunning && this\.isAgentSetupRunning\(\)\)\) \{ this\.tick\(\); return false; \}/);
  assert.equal((page.match(/Agent_Stack_Wait_Agent_Setup: "[^"\n]+"/g) || []).length, 4, 'en, fr, it, es');
  // an offer never proposes a project already at the offered version
  assert.match(page, /if \(this\.compareAgentStackVersions\(installed, project\.version\) < 0\) \{\n\s+projects\.push/);
});
