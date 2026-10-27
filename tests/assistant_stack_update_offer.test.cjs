// Studio only: when the reviewed Tigo stack of the chosen channel (stable by default, or the reviewed pre-releases too)
// is newer than what is installed, one card of the panel offers it. The Eclipse view installs through its host
// (activateLocalAgent), the Web Studio through AgentStackInstall on its engine.
// The manifests here are fake ones: a real check needs a release newer than the installed stack.
// node --test tests/assistant_stack_update_offer.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const pageYaml = read('_c8oProject/mobilePages/Page.yaml');
const ast = ts.createSourceFile('offer.ts', pageClass(), ts.ScriptTarget.Latest, true);
const names = ['t', 'agentUiLanguage', 'agentStackOfferText', 'isAgentStackOfferSurface', 'isOfficialAgentStackRelease',
  'getAgentStackChannel', 'setAgentStackChannel', 'getAgentStackChannelView', 'mergeAgentStackOfferReleases',
  'normalizeAgentStackRelease', 'normalizeAgentStackOfferRelease', 'scheduleAgentStackOfferCheck', 'refreshAgentStackOfferRelease',
  'refreshAgentStackOfferPolicy', 'getAgentStackOfferProjects', 'getAgentStackOfferKey', 'getAgentStackOfferRestriction',
  'isAgentStackOfferTurnRunning', 'getAgentStackOfferView', 'installAgentStackOffer', 'postponeAgentStackOffer',
  'compareAgentStackVersions', 'isServerManagedAgentStack', 'getAgentStackServerStatus', 'refreshAgentStackServerStatus',
  'getInstalledAgentStackVersion', 'isAgentStackUpdateAllowed', 'getAgentStackRestrictedText', 'installAgentStackOnServer',
  'triggerAgentOnboardingAction', 'applyAgentActivationStatus'];
const methods = ast.statements[0].members.filter(m => m.name && names.includes(m.name.getText(ast)));
assert.deepEqual(methods.map(m => m.name.getText(ast)).sort(), [...names].sort());
const compiled = ts.transpileModule('class Page {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Page = Page;', {
  reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020 }
});
assert.deepEqual(compiled.diagnostics, []);
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));

const REPOSITORIES = { lib_ConvertigoMCP: 'c8oprj-lib-c8o-mcp', lib_ConvertigoAgentBridge: 'c8oprj-lib-convertigo-agent-bridge', lib_ConvertigoAssistant: 'c8oprj-lib-convertigo-assistant' };
const carUrl = (name, version) => name + '=https://github.com/convertigo/' + REPOSITORIES[name] + '/releases/download/v' + version + '/' + name + '.car';
function manifest({ mcp = '0.2.29', bridge = '0.4.29', assistant = '1.5.7' } = {}, channel = 'stable') {
  const project = (name, version) => ({ name, version, tag: 'v' + version, importUrl: carUrl(name, version) });
  return { schemaVersion: 1, channel, projects: [project('lib_ConvertigoMCP', mcp), project('lib_ConvertigoAgentBridge', bridge), project('lib_ConvertigoAssistant', assistant)] };
}
const installed = { localMcpVersion: '0.2.27', localAgentBridgeVersion: '0.4.27', localAssistantVersion: '1.5.5' };
const serverStatus = (versions = installed, overrides = {}) => ({
  surface: 'studio', localAgentStackUpdateAllowed: true, localAgentStackUpdatePolicy: 'admin', localAgentStackUpdateReason: 'admin',
  localAgentStackState: 'ready', ...versions,
  projects: [['lib_ConvertigoMCP', 'localMcpVersion'], ['lib_ConvertigoAgentBridge', 'localAgentBridgeVersion'], ['lib_ConvertigoAssistant', 'localAssistantVersion']]
    .map(([name, key]) => ({ name, installed: true, version: versions[key], gitCheckout: false })),
  ...overrides
});

// surface: 'eclipse' (the Studio view, its host installs), 'web' (the Web Studio, serverAgent=1) or 'nocode'.
function fixture({ surface = 'eclipse', language = 'fr', context = {}, storage = new Map(), clock = { now: 1_800_000_000_000 },
  stable = manifest(), preview = manifest({ mcp: '0.2.30-beta.1', bridge: '0.4.30-beta.2', assistant: '1.5.8-beta.3' }, 'preview'),
  policy = 'admin', status = serverStatus(), onboarding = 'ready', install } = {}) {
  const calls = [], posted = [], timers = new Map();
  let timerId = 0, reloads = 0;
  const schedule = repeat => (fn, delay) => { timers.set(++timerId, { fn, delay, repeat }); return timerId; };
  const sandbox = {
    Promise, JSON, Array, Number, Error, RegExp,
    Date: class extends Date { static now() { return clock.now; } },
    setTimeout: schedule(false), setInterval: schedule(true), clearTimeout: id => timers.delete(id),
    window: {
      localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
      location: { reload: () => { reloads++; } }
    }
  };
  vm.runInNewContext(compiled.outputText, sandbox);
  const page = new sandbox.Page();
  const hostContext = surface === 'eclipse'
    ? { assistantSurface: 'studio', assistantRuntime: 'local', localAgentStackUpdateAllowed: true, localAgentBridgeAvailable: true, ...installed, ...context }
    : { assistantSurface: surface === 'web' ? 'studio' : 'nocode', ...context };
  Object.assign(page, {
    local: {}, global: { currentLanguage: () => language, isAssistantAgentReleaseEnabled: () => true, agentActivationAssistantPath: () => '/convertigo/projects/lib_ConvertigoAssistant/DisplayObjects/mobile/' },
    translate: { currentLang: language },
    isAgentBridgeMode: () => true,
    isEmbeddedInC8Oforms: () => surface === 'nocode',
    getAgentSkillProfile: () => (surface === 'nocode' ? 'nocode' : ''),
    getAssistantSurfaceHint: () => (surface === 'nocode' ? 'nocode' : 'studio'),
    isStudioAssistantSurface: () => surface !== 'nocode',
    isServerAgentSurface: () => surface !== 'eclipse',
    getAgentOnboardingState: () => onboarding,
    getAgentHostContextObject: () => hostContext,
    normalizeAgentHostContextValue: v => String(v ?? '').trim(),
    getEffectiveProjectName: () => 'demo',
    postAgentHostMessage: message => { posted.push(plain(message)); return true; },
    openAgentExternalUrl() {}, tick() {},
    c8o: { callJsonObject(name, payload) {
      calls.push({ name, payload: plain(payload) });
      return { async: () => {
        if (name.endsWith('.GetManifest')) return typeof stable === 'function' ? stable() : Promise.resolve({ result: stable });
        if (name.endsWith('.GetPreviewManifest')) return typeof preview === 'function' ? preview() : Promise.resolve({ result: preview });
        if (name.endsWith('.AgentStackStatus')) {
          if (surface === 'eclipse') return Promise.resolve({ result: { ...serverStatus(), localAgentStackUpdateReason: policy, localAgentStackUpdateAllowed: policy !== 'disabled' } });
          return Promise.resolve({ result: status });
        }
        if (name.endsWith('.AgentStackInstall')) return Promise.resolve({ result: install || { status: 'success', installedCount: 1, assistantUpdated: false } });
        return Promise.reject(new Error('unexpected ' + name));
      } };
    } }
  });
  return {
    page, calls, posted, timers, storage, clock, hostContext, reloads: () => reloads,
    names: () => calls.map(c => c.name.replace('lib_ConvertigoAssistant.', '')),
    async open() {
      // The host context arrives, then the delayed check runs.
      page.scheduleAgentStackOfferCheck();
      for (const [id, timer] of [...timers]) if (timer.delay === 4000) { timers.delete(id); timer.fn(); }
      await flush();
    },
    async hourly() {
      for (const [, timer] of [...timers]) if (timer.delay === 3600000) timer.fn();
      await flush();
    }
  };
}

test('the Eclipse view offers a newer stable stack, with the versions concerned, and its host installs it', async () => {
  const f = fixture();
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackRelease.GetManifest', 'AgentStackStatus'], 'the stable manifest, then the engine symbol once');
  const view = f.page.getAgentStackOfferView();
  assert.equal(view.title, 'Une mise à jour de Tigo est disponible');
  assert.equal(view.versions, 'MCP 0.2.27 → 0.2.29 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  assert.deepEqual([view.canUpdate, view.updateDisabled, view.note, view.updateText, view.laterText], [true, false, '', 'Mettre à jour', 'Plus tard']);
  assert.equal(f.page.getAgentStackOfferView(), view, 'one object per state, for change detection');

  assert.equal(f.page.installAgentStackOffer(), true);
  assert.equal(f.posted.length, 1);
  const message = f.posted[0];
  assert.equal(message.type, 'lib_ConvertigoAssistant.activateLocalAgent');
  assert.equal(message.payload.forceUpdate, true);
  assert.deepEqual(message.payload.projects, manifest().projects, 'dependencies first, the Assistant last, official CARs only');
  assert.equal(f.calls.some(c => /Install|Preview/.test(c.name)), false, 'the host installs; the preview manifest is never read');
  const installing = f.page.getAgentStackOfferView();
  assert.deepEqual([installing.installing, installing.updateDisabled, installing.note], [true, true, 'Mise à jour de la stack...']);

  // The host reports its progress; on success it reloads the view, whose new context brings the new versions.
  f.page.applyAgentActivationStatus({ status: 'running', message: 'Mise à jour de lib_ConvertigoMCP...' });
  assert.equal(f.page.getAgentStackOfferView().note, 'Mise à jour de lib_ConvertigoMCP...');
  Object.assign(f.hostContext, { localMcpVersion: '0.2.29', localAgentBridgeVersion: '0.4.29', localAssistantVersion: '1.5.7' });
  assert.equal(f.page.getAgentStackOfferView(), null, 'up to date: no card');
});

test('a failed host install says why on the card and lets the user try again', async () => {
  const f = fixture();
  await f.open();
  f.page.installAgentStackOffer();
  f.page.applyAgentActivationStatus({ status: 'error', message: 'Activation impossible : 404', done: true });
  const view = f.page.getAgentStackOfferView();
  assert.deepEqual([view.error, view.installing, view.updateDisabled, view.note], [true, false, false, 'Activation impossible : 404']);
});

test('the stable manifest is read at most once a day; a failed read waits an hour', async () => {
  const storage = new Map(), clock = { now: 1_800_000_000_000 };
  let f = fixture({ storage, clock });
  await f.open();
  assert.equal(f.names().filter(n => n.endsWith('GetManifest')).length, 1);
  const cached = JSON.parse(storage.get('lib_ConvertigoAssistant.AgentStackStableCheck'));
  assert.equal(cached.checkedAt, clock.now);

  clock.now += 23 * 3600000;
  f = fixture({ storage, clock });
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackStatus'], 'a panel opened the same day reads the cache');
  assert.ok(f.page.getAgentStackOfferView());
  await f.hourly();
  assert.equal(f.names().filter(n => n.endsWith('GetManifest')).length, 0);
  clock.now += 2 * 3600000;
  await f.hourly();
  assert.equal(f.names().filter(n => n.endsWith('GetManifest')).length, 1, 'a panel left open checks again the next day');

  let fail = true;
  f = fixture({ storage: new Map(), clock, stable: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve({ result: manifest() })) });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView(), null);
  fail = false;
  clock.now += 30 * 60000;
  await f.hourly();
  assert.equal(f.names().filter(n => n.endsWith('GetManifest')).length, 1, 'no retry within the hour');
  clock.now += 31 * 60000;
  await f.hourly();
  assert.equal(f.names().filter(n => n.endsWith('GetManifest')).length, 2);
  assert.ok(f.page.getAgentStackOfferView());
});

test('the comparison is semver: a pre-release newer than the stable one is kept, never downgraded', async () => {
  let f = fixture({ stable: manifest({ mcp: '0.2.27', bridge: '0.4.27', assistant: '1.5.5' }), context: { localAssistantVersion: '1.5.6-beta.15', localAgentBridgeVersion: '0.4.28-beta.16', localMcpVersion: '0.2.28-beta.12' } });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView(), null, 'pre-releases newer than the stable stack');
  assert.deepEqual(f.names(), ['AgentStackRelease.GetManifest'], 'nothing to offer: the engine policy is not read');

  f = fixture({ stable: manifest({ mcp: '0.2.27', bridge: '0.4.27', assistant: '1.5.5' }), context: { localAssistantVersion: '1.5.6-beta.16', localMcpVersion: '0.2.26' } });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView().versions, 'MCP 0.2.26 → 0.2.27');
  f.page.installAgentStackOffer();
  assert.deepEqual(f.posted[0].payload.projects.map(p => p.name + '@' + p.version), ['lib_ConvertigoMCP@0.2.27'], 'the newer Assistant is not reimported');

  f = fixture({ context: { localAssistantVersion: '1.5.7-beta.3', localAgentBridgeVersion: '0.4.29', localMcpVersion: '0.2.29' } });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView().versions, 'Assistant 1.5.7-beta.3 → 1.5.7', 'a pre-release of the stable version takes the release');

  f = fixture({ context: { localMcpVersion: '' } });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView(), null, 'versions not known yet: the settings deal with it');
});

test('only a stable manifest of official release CARs is offered', async () => {
  const forged = manifest();
  forged.projects[2].importUrl = 'lib_ConvertigoAssistant=https://evil.example/lib_ConvertigoAssistant.car';
  const mismatch = manifest();
  mismatch.projects[0].version = '0.2.30';
  const missing = manifest();
  missing.projects.pop();
  for (const stable of [manifest({}, 'preview'), forged, mismatch, missing]) {
    const f = fixture({ stable });
    await f.open();
    assert.equal(f.page.getAgentStackOfferView(), null);
    assert.equal(f.storage.has('lib_ConvertigoAssistant.AgentStackStableCheck'), false);
    assert.equal(f.names().some(n => /Preview|Status/.test(n)), false);
  }
  const f = fixture({ stable: { response: { document: manifest() } } });
  await f.open();
  assert.ok(f.page.getAgentStackOfferView(), 'the connector may wrap the manifest');
});

test('"Later" is remembered for that stable release; a newer one is offered again', async () => {
  const storage = new Map(), clock = { now: 1_800_000_000_000 };
  let f = fixture({ storage, clock });
  await f.open();
  f.page.postponeAgentStackOffer();
  assert.equal(f.page.getAgentStackOfferView(), null);
  assert.equal(storage.get('lib_ConvertigoAssistant.AgentStackUpdateLater'), 'lib_ConvertigoMCP@0.2.29,lib_ConvertigoAgentBridge@0.4.29,lib_ConvertigoAssistant@1.5.7');

  f = fixture({ storage, clock });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView(), null, 'the next panel remembers it');

  storage.delete('lib_ConvertigoAssistant.AgentStackStableCheck');
  f = fixture({ storage, clock, stable: manifest({ assistant: '1.5.8' }) });
  await f.open();
  assert.match(f.page.getAgentStackOfferView().versions, /Assistant 1\.5\.5 → 1\.5\.8/);
});

test('never while a turn runs: the card waits for its end', async () => {
  const f = fixture({ language: 'en' });
  await f.open();
  f.page.local.IsProcessing = true;
  let view = f.page.getAgentStackOfferView();
  assert.deepEqual([view.updateDisabled, view.note], [true, 'You can update once the current turn ends.']);
  assert.equal(f.page.installAgentStackOffer(), false);
  assert.equal(f.posted.length, 0);

  f.page.local.IsProcessing = false;
  f.page.local.AgentConversations = [{ conversationId: 'c-2', status: 'in_progress', updatedAt: f.clock.now - 60000 }];
  assert.equal(f.page.getAgentStackOfferView().updateDisabled, true, 'another conversation runs');
  f.page.local.AgentConversations = [{ conversationId: 'c-2', status: 'in_progress', updatedAt: f.clock.now - 2 * 3600000 }];
  view = f.page.getAgentStackOfferView();
  assert.deepEqual([view.updateDisabled, view.note], [false, ''], 'a record left running by a closed Studio does not block');
  assert.equal(f.page.installAgentStackOffer(), true);
});

test('when the update is not allowed, the card says why and offers no update', async () => {
  let f = fixture({ context: { localAgentStackUpdateAllowed: false } });
  await f.open();
  let view = f.page.getAgentStackOfferView();
  assert.deepEqual([view.canUpdate, view.note], [false, 'Ces projets proviennent de sources locales et ne sont pas remplacés automatiquement.']);
  assert.equal(f.page.installAgentStackOffer(), false);
  assert.equal(f.posted.length, 0);

  f = fixture({ policy: 'disabled', language: 'it' });
  await f.open();
  view = f.page.getAgentStackOfferView();
  assert.deepEqual([view.canUpdate, view.note], [false, 'Gli aggiornamenti automatici sono disattivati (simbolo assistant.stack.selfupdate).']);

  f = fixture({ policy: 'admin_required' });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView().canUpdate, true, 'the session policy is the server one: the Studio host installs');
});

test('the Web Studio reads the versions on its engine and installs there, skipping what is up to date', async () => {
  const f = fixture({ surface: 'web' });
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest']);
  const view = f.page.getAgentStackOfferView();
  assert.equal(view.versions, 'MCP 0.2.27 → 0.2.29 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  f.page.installAgentStackOffer();
  await flush();
  const install = f.calls.find(c => c.name.endsWith('.AgentStackInstall'));
  assert.equal(install.payload.forceUpdate, 'false');
  assert.deepEqual(JSON.parse(install.payload.projects), manifest().projects);
  assert.equal(f.posted.length, 0, 'no Eclipse host');
  assert.equal(f.page.getAgentStackOfferView().note, 'Stack mise à jour sur le serveur. Rechargement de l\'Assistant...');
  for (const [, timer] of [...f.timers]) if (timer.delay === 2500) timer.fn();
  assert.equal(f.reloads(), 1, 'the panel reloads with the new versions');

  for (const [reason, text] of [['disabled', /désactivée.*assistant\.stack\.selfupdate/], ['source_managed', /sources locales/], ['admin_required', /administrateur/]]) {
    const g = fixture({ surface: 'web', status: serverStatus(installed, { localAgentStackUpdateAllowed: false, localAgentStackUpdateReason: reason }) });
    await g.open();
    const restricted = g.page.getAgentStackOfferView();
    assert.equal(restricted.canUpdate, false, reason);
    assert.match(restricted.note, text);
  }
});

test('a Web Studio served by a server engine (No Code or not) is never offered to update its shared stack', async () => {
  const f = fixture({ surface: 'web', status: serverStatus(installed, { surface: 'server' }) });
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackStatus'], 'the engine says it is a server: the manifest is not read');
  f.page.local.AgentStackOfferRelease = f.page.normalizeAgentStackOfferRelease(manifest(), 'stable');
  assert.equal(f.page.getAgentStackOfferView(), null);
  assert.equal(f.page.installAgentStackOffer(), false);
  assert.equal(f.calls.some(c => c.name.endsWith('.AgentStackInstall')), false);

  // The settings may be reading the status already: the check comes back once it is known.
  const g = fixture({ surface: 'web' });
  g.page.local.AgentStackServerStatusLoading = true;
  await g.open();
  assert.deepEqual(g.names(), []);
  g.page.local.AgentStackServerStatusLoading = false;
  g.page.local.AgentStackServerStatus = serverStatus();
  for (const [, timer] of [...g.timers]) if (timer.delay === 5000) timer.fn();
  await flush();
  assert.deepEqual(g.names(), ['AgentStackRelease.GetManifest']);
  assert.ok(g.page.getAgentStackOfferView());
});

test('No Code and a Studio view without its local stack never check nor offer', async () => {
  for (const options of [{ surface: 'nocode' }, { onboarding: 'local-install' }, { onboarding: 'remote-activation' }]) {
    const f = fixture(options);
    await f.open();
    f.page.refreshAgentStackOfferRelease(true);
    await flush();
    assert.deepEqual(f.calls, [], JSON.stringify(options));
    assert.equal(f.page.getAgentStackOfferView(), null);
    assert.equal(f.timers.size, 0);
  }
});

test('stable is the default channel; the pre-release channel offers the reviewed preview stack, kept by this Studio', async () => {
  const storage = new Map();
  let f = fixture({ storage });
  assert.equal(f.page.getAgentStackChannel(), 'stable');
  await f.open();
  assert.equal(f.page.getAgentStackChannelView().hint, 'Seules les versions stables sont proposées.');
  assert.equal(f.page.getAgentStackOfferView().title, 'Une mise à jour de Tigo est disponible');

  f.page.setAgentStackChannel('preview');
  await flush();
  assert.equal(storage.get('lib_ConvertigoAssistant.AgentStackChannel'), 'preview');
  assert.deepEqual(f.names().slice(-2), ['AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest'], 'read at once');
  const view = f.page.getAgentStackOfferView();
  assert.equal(view.title, 'Une pré-release de Tigo est disponible');
  assert.equal(view.versions, 'MCP 0.2.27 → 0.2.30-beta.1 · Bridge 0.4.27 → 0.4.30-beta.2 · Assistant 1.5.5 → 1.5.8-beta.3');
  const channel = f.page.getAgentStackChannelView();
  assert.deepEqual([channel.channel, channel.label, channel.stableText, channel.previewText], ['preview', 'Canal de mise à jour', 'Stable', 'Pré-releases']);
  assert.match(channel.hint, /ne rétrograde rien/);
  f.page.installAgentStackOffer();
  assert.deepEqual(f.posted[0].payload.projects.map(p => p.importUrl),
    [carUrl('lib_ConvertigoMCP', '0.2.30-beta.1'), carUrl('lib_ConvertigoAgentBridge', '0.4.30-beta.2'), carUrl('lib_ConvertigoAssistant', '1.5.8-beta.3')]);

  f = fixture({ storage });
  assert.equal(f.page.getAgentStackChannel(), 'preview', 'the next panel of this Studio keeps the channel');
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackStatus'], 'from the pre-release channel daily read');
  assert.match(f.page.getAgentStackOfferView().versions, /1\.5\.8-beta\.3/);
});

test('the pre-release channel takes, per project, the higher of the stable and preview manifests', async () => {
  // A preview manifest left behind a newer stable: the stable comes.
  let f = fixture({ preview: manifest({ mcp: '0.2.27', bridge: '0.4.27', assistant: '1.5.5' }, 'preview') });
  f.page.setAgentStackChannel('preview');
  await flush();
  f.page.refreshAgentStackOfferPolicy(); await flush();
  let view = f.page.getAgentStackOfferView();
  assert.equal(view.versions, 'MCP 0.2.27 → 0.2.29 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  assert.equal(view.title, 'Une mise à jour de Tigo est disponible', 'only stable versions on the card');

  f = fixture({ preview: manifest({ mcp: '0.2.30-beta.1', bridge: '0.4.27', assistant: '1.5.6' }, 'preview') });
  f.page.setAgentStackChannel('preview');
  await flush();
  view = f.page.getAgentStackOfferView();
  assert.equal(view.versions, 'MCP 0.2.27 → 0.2.30-beta.1 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  assert.equal(view.title, 'Une pré-release de Tigo est disponible');
});

test('a preview manifest that cannot be read leaves the stable one, without caching, and is read again within the hour', async () => {
  const storage = new Map(), clock = { now: 1_800_000_000_000 };
  let failing = true;
  const f = fixture({ storage, clock, preview: () => (failing ? Promise.reject(new Error('404')) : Promise.resolve({ result: manifest({ assistant: '1.5.8-beta.3' }, 'preview') })) });
  f.page.setAgentStackChannel('preview');
  await flush();
  assert.equal(f.page.getAgentStackOfferView().versions, 'MCP 0.2.27 → 0.2.29 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  assert.equal(storage.has('lib_ConvertigoAssistant.AgentStackPreviewCheck'), false);
  failing = false;
  clock.now += 61 * 60000;
  f.page.refreshAgentStackOfferRelease();
  await flush();
  assert.match(f.page.getAgentStackOfferView().versions, /Assistant 1\.5\.5 → 1\.5\.8-beta\.3/);
  assert.ok(storage.has('lib_ConvertigoAssistant.AgentStackPreviewCheck'));

  const forged = manifest({ assistant: '1.5.8-beta.3' }, 'preview');
  forged.projects[2].importUrl = 'lib_ConvertigoAssistant=https://evil.example/lib_ConvertigoAssistant.car';
  for (const preview of [forged, manifest({ assistant: '1.5.8-beta.3' }, 'stable')]) {
    const g = fixture({ preview });
    g.page.setAgentStackChannel('preview');
    await flush();
    assert.equal(g.page.getAgentStackOfferView().versions, 'MCP 0.2.27 → 0.2.29 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7', 'a forged or mislabelled preview is ignored');
  }
});

test('back to stable: nothing is downgraded, the next newer stable is offered', async () => {
  const storage = new Map();
  storage.set('lib_ConvertigoAssistant.AgentStackChannel', 'preview');
  const f = fixture({ storage, context: { localMcpVersion: '0.2.30-beta.1', localAgentBridgeVersion: '0.4.30-beta.2', localAssistantVersion: '1.5.8-beta.3' } });
  await f.open();
  assert.equal(f.page.getAgentStackOfferView(), null, 'the preview stack is installed');
  f.page.setAgentStackChannel('stable');
  await flush();
  assert.equal(storage.get('lib_ConvertigoAssistant.AgentStackChannel'), 'stable');
  assert.equal(f.page.getAgentStackOfferView(), null, 'the stable 1.5.7 is older than 1.5.8-beta.3');
  // Say the Assistant goes back to 1.5.6: its next host context reads the engine policy, then the card shows.
  f.hostContext.localAssistantVersion = '1.5.6';
  f.page.scheduleAgentStackOfferCheck();
  await flush();
  assert.equal(f.page.getAgentStackOfferView().versions, 'Assistant 1.5.6 → 1.5.7');
});

test('a channel changed during a read shows the new channel only', async () => {
  let release;
  const f = fixture({ stable: () => new Promise(resolve => { release = resolve; }) });
  await f.open();
  f.page.setAgentStackChannel('preview');
  assert.equal(f.names().filter(n => n.endsWith('GetPreviewManifest')).length, 0, 'one read at a time');
  release({ result: manifest() });
  await flush();
  assert.equal(f.storage.has('lib_ConvertigoAssistant.AgentStackStableCheck'), true, 'the stable read is kept for its channel');
  assert.equal(f.names().filter(n => n.endsWith('GetPreviewManifest')).length, 1, 'then the pre-release channel is read');
});

test('the channel is a Studio setting: not shown elsewhere', async () => {
  assert.equal(fixture({ surface: 'nocode' }).page.getAgentStackChannelView(), null);
  assert.equal(fixture({ onboarding: 'local-install' }).page.getAgentStackChannelView(), null);
  assert.equal(fixture({ surface: 'web' }).page.getAgentStackChannelView().channel, 'stable');
});

test('the four Assistant languages have every text of the card and of the channel', () => {
  const keys = ['title', 'titlePreview', 'update', 'later', 'installing', 'turnRunning', 'disabled',
    'channel', 'channelStable', 'channelPreview', 'stableHint', 'previewHint'];
  const en = fixture({ language: 'en' }).page;
  for (const language of ['fr', 'it', 'es']) {
    const page = fixture({ language }).page;
    for (const key of keys) {
      assert.notEqual(page.agentStackOfferText(key), key, language + ' ' + key);
      if (!(language === 'fr' && key === 'channelStable')) {
        assert.notEqual(page.agentStackOfferText(key), en.agentStackOfferText(key), language + ' ' + key + ' is translated');
      }
    }
  }
});

test('the page shows the card under the toolbar, wires its buttons and checks from the host context', () => {
  const header = pageYaml.indexOf('↓FormsContextNotice [ngx.components.UIControlDirective-');
  const offer = pageYaml.indexOf('↓StackUpdateOffer [ngx.components.UIControlDirective-1793500000001]: \n');
  const content = pageYaml.indexOf('↓Content [ngx.components.UIDynamicElement-1772100000030]: ');
  assert.ok(header > 0 && header < offer && offer < content, 'in the header, after the No Code notice');
  assert.match(pageYaml, /\n  ↓StackUpdateOffer \[ngx\.components\.UIControlDirective-1793500000001\]: \n    directiveName: If\n/);
  assert.match(pageYaml, /MobileSmartSourceType: script:!!this\.getAgentStackOfferView\(\)\n/);
  assert.match(pageYaml, /MobileSmartSourceType: script:this\.getAgentStackOfferView\(\)\?\.canUpdate === true\n/);
  assert.match(pageYaml, /"Disabled": "script:this\.getAgentStackOfferView\(\)\?\.updateDisabled !== false"/);
  assert.match(pageYaml, /if \(page\.installAgentStackOffer\) \{ page\.installAgentStackOffer\(\); \}\n\s+resolve\(\);/);
  assert.match(pageYaml, /if \(page\.postponeAgentStackOffer\) \{ page\.postponeAgentStackOffer\(\); \}\n\s+resolve\(\);/);
  assert.match(pageYaml, /↓AgentStackOfferStyle \[ngx\.components\.UIStyle-1793500000031\]: \n[\s\S]*\.agent-stack-offer \{/);
  assert.match(pageYaml, /this\.scheduleAgentSettingsRefreshAfterHostContext\(\);\n\s+if \(this\.scheduleAgentStackOfferCheck\) \{ this\.scheduleAgentStackOfferCheck\(\); \}/);
  assert.match(pageYaml, /projects: projects && projects\.length \? projects : \(this\.getAgentActivationProjects \? this\.getAgentActivationProjects\(\) : \[\]\),/);
  const stackAction = pageYaml.indexOf('↓StackAction [ngx.components.UIDynamicElement-1787742888362]: ');
  const channel = pageYaml.indexOf('↓ChannelIf [ngx.components.UIControlDirective-1793500000032]: ');
  const runtime = pageYaml.indexOf('↓RuntimeSettings [ngx.components.UIDynamicElement-1785253202525]: ');
  assert.ok(stackAction > 0 && stackAction < channel && channel < runtime, 'the channel closes the stack settings');
  assert.match(pageYaml, /\n {24}↓ChannelIf \[ngx\.components\.UIControlDirective-1793500000032\]: \n {26}directiveName: If\n/);
  assert.match(pageYaml, /if \(page\.setAgentStackChannel\) \{ page\.setAgentStackChannel\("stable"\); \}\n\s+resolve\(\);/);
  assert.match(pageYaml, /if \(page\.setAgentStackChannel\) \{ page\.setAgentStackChannel\("preview"\); \}\n\s+resolve\(\);/);
  assert.match(pageYaml, /\.agent-stack-channel-options ion-button\.is-selected \{/);
  // Each bean of the card is new to the project.
  for (const id of pageYaml.match(/-17935000000\d\d\]/g)) assert.equal(pageYaml.split(id).length, 2, id);
});
