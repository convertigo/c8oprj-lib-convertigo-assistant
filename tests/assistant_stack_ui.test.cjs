const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');

const ast = ts.createSourceFile('stack-ui.ts', pageClass(), ts.ScriptTarget.Latest, true);
const names = ['t', 'refreshAgentSettingsAfterHostContext', 'refreshAgentStackRelease',
  'normalizeAgentStackRelease', 'getEmbeddedAgentStackRelease', 'getAgentActivationProjects',
  'refreshAgentStackServerStatus', 'getAgentStackServerStatus', 'getInstalledAgentStackVersion',
  'isAgentStackUpdateAllowed', 'isAgentStackUpdateAvailable', 'compareAgentStackVersions',
  'getAgentStackVersionText', 'getAgentStackStatusText', 'getAgentStackStatusClass',
  'getAgentStackRestrictedText', 'openAgentSettingsPage', 'triggerAgentStackUpdate'];
const methods = ast.statements[0].members.filter(m => m.name && names.includes(m.name.getText(ast)));
assert.equal(methods.length, names.length);
const compiled = ts.transpileModule('class Page {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Page = Page;', {
  reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020 }
});
assert.deepEqual(compiled.diagnostics, []);
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const status = (overrides = {}) => ({
  surface: 'server', localAgentStackUpdateAllowed: true, localAgentStackUpdatePolicy: 'authenticated',
  localAgentStackUpdateReason: 'authenticated', localAgentStackState: 'missing',
  localAssistantVersion: '1.4.18', localMcpVersion: '', localAgentBridgeVersion: '',
  projects: [
    { name: 'lib_ConvertigoMCP', installed: false, version: '' },
    { name: 'lib_ConvertigoAgentBridge', installed: false, version: '' },
    { name: 'lib_ConvertigoAssistant', installed: true, version: '1.4.18' }
  ], ...overrides
});

function fixture({ studio = false, language = 'fr', request } = {}) {
  const calls = [], timers = new Map();
  let timerId = 0;
  const sandbox = { Promise, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(compiled.outputText, sandbox);
  const page = new sandbox.Page();
  Object.assign(page, {
    local: {}, global: {}, translate: { currentLang: language },
    isEmbeddedNoCodeAgent: () => !studio, isServerAgentSurface: () => !studio,
    isServerManagedAgentStack: () => !studio, hasLocalAgentBridgeCapability: () => studio,
    getAgentHostContextObject: () => ({ localAssistantVersion: '1.4.18', localMcpVersion: '0.2.8', localAgentBridgeVersion: '0.4.10', localAgentStackUpdateAllowed: true }),
    normalizeAgentHostContextValue: v => String(v ?? '').trim(),
    getAgentContextUserId: () => studio ? 'studio' : 'test-user',
    getC8OformsText: key => key, tick() {}, setEnableChat() {}, syncFooterPlaceholder() {},
    setAgentSettingsUrlState() {}, requestAgentHostContext() {},
    c8o: { log: { warn() {} }, callJsonObject(name, payload) {
      calls.push({ name, payload });
      return { async: () => {
        if (request) { const custom = request(name); if (custom !== undefined) return custom; }
        if (name.endsWith('.AgentStackStatus')) return Promise.resolve({ result: status() });
        if (name.endsWith('.GetManifest')) return Promise.resolve({ result: page.getEmbeddedAgentStackRelease() });
        // A missing Bridge fails settings and automatically opens configuration.
        return Promise.resolve({ result: { ok: false } });
      } };
    } }
  });
  return { page, calls, timers, fire(delay) {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
  } };
}

test('automatic NoCode configuration checks the stack even when the Bridge is missing', async () => {
  const f = fixture();
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  assert.equal(f.page.local.ShowAgentConfigPanel, true);
  assert.equal(f.calls.filter(c => c.name.endsWith('.AgentStackStatus')).length, 1);
  assert.equal(f.calls.filter(c => c.name.endsWith('.GetManifest')).length, 1);
  assert.equal(f.page.isAgentStackUpdateAllowed(), true);
  assert.match(f.page.getAgentStackVersionText(), /Assistant 1\.4\.18/);
  assert.match(f.page.getAgentStackVersionText(), /MCP non installé/);
  assert.match(f.page.getAgentStackStatusText(), /MCP.*Bridge/);
  assert.doesNotMatch(f.page.getAgentStackStatusText(), /administrateur|versions/);
  assert.equal(f.calls.some(c => /Install|Setup/.test(c.name)), false, 'diagnostic never installs software');
  assert.equal(f.timers.size, 0);
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  assert.equal(f.calls.filter(c => c.name.endsWith('.AgentStackStatus')).length, 1, 'no host-context polling loop');
});

test('automatic Convertigo runtime preparation cannot click the stack reinstall button', () => {
  const method = methods.find(m => m.name.getText(ast) === 'refreshAgentSettingsAfterHostContext').getText(ast);
  assert.match(method, /querySelector\(['"]\.agent-runtime-settings:not\(\.agent-stack-settings\) ion-button\.agent-runtime-action['"]\)/);
});

test('unknown, loading and failed checks never masquerade as an administrator restriction', async () => {
  let complete;
  const f = fixture({ request: name => name.endsWith('.AgentStackStatus') ? new Promise(resolve => { complete = resolve; }) : undefined });
  assert.match(f.page.getAgentStackRestrictedText(), /pas encore vérifi/);
  f.page.refreshAgentStackServerStatus();
  assert.match(f.page.getAgentStackStatusText(), /Vérification/);
  assert.equal(f.page.isAgentStackUpdateAllowed(), false);
  f.page.refreshAgentStackServerStatus();
  assert.equal(f.calls.length, 1, 'single flight');
  f.fire(15000); await flush();
  assert.equal(f.page.local.AgentStackServerStatusLoading, false);
  assert.match(f.page.getAgentStackStatusText(), /Impossible de vérifier.*serveur/);
  assert.match(f.page.getAgentStackStatusClass(), /error/);
  complete({ result: status() }); await flush();
  assert.equal(f.page.isAgentStackUpdateAllowed(), false, 'late results cannot unlock installation');
});

test('network, malformed and HTTP-200 engine failures clear stale authorization; explicit reopening retries', async () => {
  for (const response of [Promise.reject(new Error('network')), Promise.resolve({}),
    Promise.resolve({ document: { error: { message: 'engine failure' } } })]) {
    let failed = true;
    const f = fixture({ request: name => name.endsWith('.AgentStackStatus') && failed ? response : undefined });
    f.page.local.AgentStackServerStatus = status();
    f.page.refreshAgentStackRelease(true); await flush();
    assert.equal(f.page.isAgentStackUpdateAllowed(), false);
    assert.match(f.page.getAgentStackStatusText(), /Impossible de vérifier/);
    f.page.refreshAgentStackRelease(); await flush();
    assert.equal(f.calls.filter(c => c.name.endsWith('.AgentStackStatus')).length, 1);
    failed = false;
    f.page.openAgentSettingsPage(); await flush();
    assert.equal(f.calls.filter(c => c.name.endsWith('.AgentStackStatus')).length, 2);
    assert.equal(f.page.isAgentStackUpdateAllowed(), true);
    assert.equal(f.timers.size, 0);
  }
});

test('cached release metadata does not skip an uninitialized server status', async () => {
  const f = fixture();
  f.page.local.AgentStackRelease = f.page.getEmbeddedAgentStackRelease();
  f.page.refreshAgentStackRelease(); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.page.isAgentStackUpdateAllowed(), true);
});

test('verified restrictions and missing dependencies are explicit in each supported language', () => {
  for (const language of ['fr', 'en', 'it', 'es']) {
    const f = fixture({ language });
    for (const reason of ['admin_required', 'authentication_required', 'disabled', 'source_managed']) {
      f.page.local.AgentStackServerStatus = status({ localAgentStackUpdateAllowed: false, localAgentStackUpdateReason: reason });
      assert.equal(f.page.isAgentStackUpdateAllowed(), false);
      const text = f.page.getAgentStackStatusText();
      assert.ok(text.length > 20);
      if (reason === 'authentication_required') assert.doesNotMatch(text, /admin/i);
    }
    f.page.local.AgentStackServerStatus = status();
    assert.match(f.page.getAgentStackStatusText(), /MCP.*Bridge/);
  }
});

test('Studio retains host capabilities and does not query server diagnostics at startup', async () => {
  const f = fixture({ studio: true });
  f.page.refreshAgentSettingsAfterHostContext(); await flush();
  assert.deepEqual(f.calls.map(c => c.name), ['lib_ConvertigoAssistant.AgentSettings']);
  assert.equal(f.page.isAgentStackUpdateAllowed(), true);
  assert.match(f.page.getAgentStackVersionText(), /MCP 0\.2\.8/);
  f.page.openAgentSettingsPage(); await flush();
  assert.equal(f.calls.some(c => c.name.endsWith('.AgentStackStatus')), false);
  let activation;
  f.page.triggerAgentOnboardingAction = force => { activation = force; };
  f.page.triggerAgentStackUpdate();
  assert.equal(activation, true, 'Studio activation path remains unchanged');
});
