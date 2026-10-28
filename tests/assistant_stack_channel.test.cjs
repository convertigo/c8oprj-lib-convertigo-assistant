// Update channel of the Tigo stack, set for a whole server by the global symbol assistant.stack.channel (AgentStackStatus):
// a server shows it read-only in its stack settings and lists the versions of that channel; a Studio uses it as the
// default of the choice made in its panel. A server is never offered the update card.
// node --test tests/assistant_stack_channel.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const pageYaml = read('_c8oProject/mobilePages/Page.yaml');
const ast = ts.createSourceFile('channel.ts', pageClass(), ts.ScriptTarget.Latest, true);
const names = ['t', 'agentUiLanguage', 'agentStackOfferText', 'isAgentStackOfferSurface', 'isOfficialAgentStackRelease',
  'getAgentStackChannelChoice', 'getAgentStackServerChannel', 'isAgentStackChannelFixed', 'getAgentStackChannel',
  'setAgentStackChannel', 'getAgentStackChannelView', 'mergeAgentStackOfferReleases', 'normalizeAgentStackRelease',
  'normalizeAgentStackOfferRelease', 'scheduleAgentStackOfferCheck', 'refreshAgentStackOfferRelease', 'refreshAgentStackOfferPolicy',
  'refreshAgentStackEngineStatus', 'getAgentStackOfferProjects', 'getAgentStackOfferKey', 'getAgentStackOfferRestriction',
  'isAgentStackOfferTurnRunning', 'getAgentStackOfferView', 'compareAgentStackVersions', 'isServerManagedAgentStack',
  'getAgentStackServerStatus', 'refreshAgentStackServerStatus', 'getInstalledAgentStackVersion', 'isAgentStackUpdateAllowed',
  'getAgentStackRestrictedText', 'installAgentStackOnServer', 'triggerAgentOnboardingAction', 'refreshAgentStackRelease',
  'getEmbeddedAgentStackRelease', 'getAgentActivationProjects', 'isAgentStackUpdateAvailable', 'getAgentStackVersionText',
  'getAgentStackStatusText', 'getAgentStackStatusClass', 'triggerAgentStackUpdate'];
const methods = ast.statements[0].members.filter(m => m.name && names.includes(m.name.getText(ast)));
assert.deepEqual(methods.map(m => m.name.getText(ast)).sort(), [...names].sort());
const compiled = ts.transpileModule('class Page {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}\nthis.Page = Page;', {
  reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020 }
});
assert.deepEqual(compiled.diagnostics, []);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));

const REPOSITORIES = { lib_ConvertigoMCP: 'c8oprj-lib-c8o-mcp', lib_ConvertigoAgentBridge: 'c8oprj-lib-convertigo-agent-bridge', lib_ConvertigoAssistant: 'c8oprj-lib-convertigo-assistant' };
const carUrl = (name, version) => name + '=https://github.com/convertigo/' + REPOSITORIES[name] + '/releases/download/v' + version + '/' + name + '.car';
function manifest({ mcp = '0.2.27', bridge = '0.4.27', assistant = '1.5.5' } = {}, channel = 'stable') {
  const project = (name, version) => ({ name, version, tag: 'v' + version, importUrl: carUrl(name, version) });
  return { schemaVersion: 1, channel, projects: [project('lib_ConvertigoMCP', mcp), project('lib_ConvertigoAgentBridge', bridge), project('lib_ConvertigoAssistant', assistant)] };
}
const betas = { mcp: '0.2.28-beta.13', bridge: '0.4.28-beta.16', assistant: '1.5.6-beta.17' };
const installed = { localMcpVersion: '0.2.27', localAgentBridgeVersion: '0.4.27', localAssistantVersion: '1.5.5' };
// What AgentStackStatus answers: channel undefined = an engine whose status has no channel (before the symbol).
function engineStatus({ surface = 'server', channel, source = 'symbol', versions = installed, allowed = true, reason = 'admin' } = {}) {
  return {
    surface, localAgentStackUpdateAllowed: allowed, localAgentStackUpdatePolicy: 'admin', localAgentStackUpdateReason: reason,
    localAgentStackSelfUpdateSymbol: 'assistant.stack.selfupdate', localAgentStackState: 'ready', ...versions,
    ...(channel ? { localAgentStackChannel: channel, localAgentStackChannelSource: source, localAgentStackChannelSymbol: 'assistant.stack.channel' } : {}),
    projects: [['lib_ConvertigoMCP', 'localMcpVersion'], ['lib_ConvertigoAgentBridge', 'localAgentBridgeVersion'], ['lib_ConvertigoAssistant', 'localAssistantVersion']]
      .map(([name, key]) => ({ name, installed: true, version: versions[key], gitCheckout: false }))
  };
}

// surface: 'nocode' (C8Oforms), 'server' (a server-agent integration), 'web' (a Web Studio, served by a Studio engine or not)
// or 'eclipse' (the Studio view, its host installs). status: what AgentStackStatus answers, or a function.
function fixture({ surface = 'nocode', language = 'fr', storage = new Map(), stable = manifest(), preview = manifest(betas, 'preview'),
  status = engineStatus(), context = {} } = {}) {
  const calls = [], posted = [], timers = new Map();
  let timerId = 0;
  const schedule = repeat => (fn, delay) => { timers.set(++timerId, { fn, delay, repeat }); return timerId; };
  const sandbox = {
    Promise, JSON, Array, Number, Error, RegExp, Date,
    setTimeout: schedule(false), setInterval: schedule(true), clearTimeout: id => timers.delete(id),
    window: {
      localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
      location: { reload() {} }
    }
  };
  vm.runInNewContext(compiled.outputText, sandbox);
  const page = new sandbox.Page();
  const hostContext = surface === 'eclipse'
    ? { assistantSurface: 'studio', assistantRuntime: 'local', localAgentStackUpdateAllowed: true, localAgentBridgeAvailable: true, ...installed, ...context }
    : { assistantSurface: surface === 'web' ? 'studio' : surface, ...context };
  const answer = value => (typeof value === 'function' ? value() : Promise.resolve({ result: value }));
  Object.assign(page, {
    local: {}, global: { currentLanguage: () => language, isAssistantAgentReleaseEnabled: () => true, agentActivationAssistantPath: () => '/convertigo/projects/lib_ConvertigoAssistant/DisplayObjects/mobile/' },
    translate: { currentLang: language },
    isAgentBridgeMode: () => true,
    isEmbeddedInC8Oforms: () => surface === 'nocode',
    getAgentSkillProfile: () => (surface === 'nocode' ? 'nocode' : ''),
    getAssistantSurfaceHint: () => (surface === 'eclipse' || surface === 'web' ? 'studio' : surface),
    isStudioAssistantSurface: () => surface === 'eclipse' || surface === 'web',
    isServerAgentSurface: () => surface !== 'eclipse',
    getAgentOnboardingState: () => 'ready',
    getAgentHostContextObject: () => hostContext,
    normalizeAgentHostContextValue: v => String(v ?? '').trim(),
    getEffectiveProjectName: () => 'demo',
    postAgentHostMessage: message => { posted.push(plain(message)); return true; },
    openAgentExternalUrl() {}, tick() {},
    c8o: { callJsonObject(name, payload) {
      calls.push({ name, payload: plain(payload) });
      return { async: () => {
        if (name.endsWith('.GetManifest')) return answer(stable);
        if (name.endsWith('.GetPreviewManifest')) return answer(preview);
        if (name.endsWith('.AgentStackStatus')) return answer(status);
        if (name.endsWith('.AgentStackInstall')) return Promise.resolve({ result: { status: 'success', installedCount: 0, assistantUpdated: false } });
        return Promise.reject(new Error('unexpected ' + name));
      } };
    } }
  });
  return {
    page, calls, posted, storage, hostContext,
    names: () => calls.map(c => c.name.replace('lib_ConvertigoAssistant.', '')),
    // The settings, as the host context and the settings page read them.
    async settings(force = false) { page.refreshAgentStackRelease(force); await flush(); },
    // The card: the host context arrives, then the delayed check runs.
    async open() {
      page.scheduleAgentStackOfferCheck();
      for (const [id, timer] of [...timers]) if (timer.delay === 4000) { timers.delete(id); timer.fn(); }
      await flush();
    }
  };
}

test('a server on the preview channel lists, per project, the higher of its stable and preview manifests', async () => {
  const f = fixture({ status: engineStatus({ channel: 'preview' }) });
  await f.settings();
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest'],
    'the channel comes with the status, then the manifests of that channel');
  assert.equal(f.page.getAgentStackChannel(), 'preview');
  assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.27 → 0.2.28-beta.13 · Bridge 0.4.27 → 0.4.28-beta.16 · Assistant 1.5.5 → 1.5.6-beta.17');
  assert.equal(f.page.getAgentStackStatusText(), 'Une mise à jour de la stack est disponible.');
  assert.equal(f.page.local.AgentStackReleaseError, '');

  // A preview manifest left behind a newer stable: the stable comes.
  const g = fixture({ status: engineStatus({ channel: 'preview' }), stable: manifest({ mcp: '0.2.29', bridge: '0.4.29', assistant: '1.5.7' }),
    preview: manifest({ mcp: '0.2.30-beta.1', bridge: '0.4.28-beta.16', assistant: '1.5.6-beta.17' }, 'preview') });
  await g.settings();
  assert.equal(g.page.getAgentStackVersionText(), 'MCP 0.2.27 → 0.2.30-beta.1 · Bridge 0.4.27 → 0.4.29 · Assistant 1.5.5 → 1.5.7');
  await g.settings();
  assert.equal(g.names().length, 3, 'read once until the settings are opened again');
});

test('a server shows its channel read-only, with the name of the symbol, and its panel cannot change it', async () => {
  const f = fixture({ status: engineStatus({ channel: 'preview' }) });
  assert.equal(f.page.getAgentStackChannelView(), null, 'nothing until the status is known');
  await f.settings();
  const view = f.page.getAgentStackChannelView();
  assert.deepEqual([view.readOnly, view.channel, view.label, view.valueText], [true, 'preview', 'Canal de mise à jour', 'Pré-releases']);
  assert.equal(view.hint, 'Réglé pour tout le serveur par son administrateur (symbole assistant.stack.channel).');
  assert.equal(f.page.getAgentStackChannelView(), view, 'one object per state, for change detection');
  f.page.setAgentStackChannel('stable');
  await flush();
  assert.equal(f.page.getAgentStackChannel(), 'preview');
  assert.equal(f.storage.size, 0, 'no choice is kept on a server');
  assert.equal(f.names().length, 3);

  // A choice left in this browser by a Studio panel does not apply to a server.
  const stored = fixture({ status: engineStatus({ channel: 'preview' }), storage: new Map([['lib_ConvertigoAssistant.AgentStackChannel', 'stable']]) });
  await stored.settings();
  assert.equal(stored.page.getAgentStackChannel(), 'preview');

  for (const [language, hint] of [['en', /^Set for the whole server by its administrator \(symbol assistant\.stack\.channel\)\.$/],
    ['it', /simbolo assistant\.stack\.channel/], ['es', /símbolo assistant\.stack\.channel/]]) {
    const other = fixture({ language, status: engineStatus({ channel: 'stable' }) });
    await other.settings();
    assert.match(other.page.getAgentStackChannelView().hint, hint);
  }
});

test('a server is on the stable channel by default: no preview manifest, the symbol is named', async () => {
  for (const status of [engineStatus({ channel: 'stable', source: 'default' }), engineStatus()]) {
    const f = fixture({ status });
    await f.settings();
    assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest']);
    const view = f.page.getAgentStackChannelView();
    assert.deepEqual([view.readOnly, view.channel, view.valueText], [true, 'stable', 'Stable']);
    assert.equal(view.hint, 'Canal par défaut du serveur. Son administrateur peut le changer avec le symbole assistant.stack.channel.');
    assert.equal(f.page.getAgentStackStatusText(), 'La stack locale est à jour.');
  }
});

test('a manifest or a status that cannot be read breaks nothing: the stable channel stands', async () => {
  // The preview manifest fails: the stable versions, said in the settings, and no error.
  let f = fixture({ status: engineStatus({ channel: 'preview' }), preview: () => Promise.reject(new Error('404')) });
  await f.settings();
  assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.27 · Bridge 0.4.27 · Assistant 1.5.5');
  assert.equal(f.page.local.AgentStackReleaseError, '');
  assert.equal(f.page.getAgentStackStatusText(), 'La stack locale est à jour.');
  assert.match(f.page.getAgentStackChannelView().hint, /n’a pas pu être lu : seules les versions stables/);
  // A forged or mislabelled preview manifest is ignored the same way.
  const forged = manifest(betas, 'preview');
  forged.projects[0].importUrl = 'lib_ConvertigoMCP=https://evil.example/lib_ConvertigoMCP.car';
  for (const preview of [forged, manifest(betas, 'stable')]) {
    f = fixture({ status: engineStatus({ channel: 'preview' }), preview });
    await f.settings();
    assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.27 · Bridge 0.4.27 · Assistant 1.5.5');
  }
  // Opening the settings again reads both again.
  let failing = true;
  f = fixture({ status: engineStatus({ channel: 'preview' }), preview: () => (failing ? Promise.reject(new Error('404')) : Promise.resolve({ result: manifest(betas, 'preview') })) });
  await f.settings();
  failing = false;
  await f.settings(true);
  assert.match(f.page.getAgentStackVersionText(), /Assistant 1\.5\.5 → 1\.5\.6-beta\.17/);
  assert.doesNotMatch(f.page.getAgentStackChannelView().hint, /n’a pas pu/);

  // The status cannot be read: stable manifest only, no channel shown, no update allowed.
  f = fixture({ status: () => Promise.reject(new Error('network')) });
  await f.settings();
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest']);
  assert.equal(f.page.getAgentStackChannel(), 'stable');
  assert.equal(f.page.getAgentStackChannelView(), null);
  assert.equal(f.page.isAgentStackUpdateAllowed(), false);
  // The stable manifest cannot be read: the reviewed fallback, the error, whatever the channel.
  f = fixture({ status: engineStatus({ channel: 'preview' }), stable: () => Promise.reject(new Error('offline')) });
  await f.settings();
  assert.equal(f.page.local.AgentStackRelease.channel, 'stable');
  assert.match(f.page.getAgentStackStatusText(), /Impossible de vérifier la stack publiée/);
});

test('a server installs the versions of its channel for whoever assistant.stack.selfupdate allows', async () => {
  const f = fixture({ status: engineStatus({ channel: 'preview' }) });
  await f.settings();
  f.page.triggerAgentStackUpdate();
  await flush();
  const install = f.calls.find(c => c.name.endsWith('.AgentStackInstall'));
  assert.deepEqual(JSON.parse(install.payload.projects).map(p => p.importUrl),
    [carUrl('lib_ConvertigoMCP', betas.mcp), carUrl('lib_ConvertigoAgentBridge', betas.bridge), carUrl('lib_ConvertigoAssistant', betas.assistant)]);
  assert.equal(f.posted.length, 0, 'the server installs, not a host');

  const denied = fixture({ status: engineStatus({ channel: 'preview', allowed: false, reason: 'admin_required' }) });
  await denied.settings();
  denied.page.triggerAgentStackUpdate();
  await flush();
  assert.equal(denied.calls.some(c => c.name.endsWith('.AgentStackInstall')), false);
  assert.match(denied.page.getAgentStackStatusText(), /session administrateur \(symbole assistant\.stack\.selfupdate\)/);
});

test('never an update card on a server, whatever its channel', async () => {
  for (const [surface, status] of [['nocode', engineStatus({ channel: 'preview' })], ['server', engineStatus({ channel: 'preview' })],
    ['web', engineStatus({ channel: 'preview' })], ['nocode', engineStatus({ surface: 'studio', channel: 'preview' })]]) {
    const f = fixture({ surface, status });
    await f.settings();
    await f.open();
    assert.equal(f.page.getAgentStackOfferView(), null, surface + ' on a ' + status.surface + ' engine');
    assert.equal(f.storage.has('lib_ConvertigoAssistant.AgentStackPreviewCheck'), false, 'the card never read its manifests');
    assert.equal(f.page.getAgentStackChannelView().readOnly, true, 'the channel of the engine');
  }
});

test('with no choice in its panel, a Studio takes the channel of its engine symbol', async () => {
  // The Eclipse view: the engine status first, once (channel and policy), then the manifests of that channel.
  const f = fixture({ surface: 'eclipse', status: engineStatus({ surface: 'studio', channel: 'preview' }) });
  await f.open();
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest']);
  assert.equal(f.page.getAgentStackChannel(), 'preview');
  const card = f.page.getAgentStackOfferView();
  assert.equal(card.title, 'Une pré-release de Tigo est disponible');
  assert.equal(card.versions, 'MCP 0.2.27 → 0.2.28-beta.13 · Bridge 0.4.27 → 0.4.28-beta.16 · Assistant 1.5.5 → 1.5.6-beta.17');
  const view = f.page.getAgentStackChannelView();
  assert.deepEqual([view.readOnly, view.channel], [false, 'preview']);
  assert.match(view.hint, /Canal par défaut de ce Studio, réglé par le symbole assistant\.stack\.channel\. Un choix fait ici l’emporte\./);
  assert.equal(f.storage.has('lib_ConvertigoAssistant.AgentStackChannel'), false, 'a default is not a choice');
  // Its settings follow the same channel, without reading the engine again.
  await f.settings(true);
  assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.27 → 0.2.28-beta.13 · Bridge 0.4.27 → 0.4.28-beta.16 · Assistant 1.5.5 → 1.5.6-beta.17');
  assert.equal(f.names().filter(n => n === 'AgentStackStatus').length, 1);

  // The Web Studio of a Studio engine has the channel in the status it reads anyway.
  const web = fixture({ surface: 'web', status: engineStatus({ surface: 'studio', channel: 'preview' }) });
  await web.open();
  assert.deepEqual(web.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest']);
  assert.equal(web.page.getAgentStackOfferView().title, 'Une pré-release de Tigo est disponible');
  assert.equal(web.page.getAgentStackChannelView().readOnly, false);

  // No symbol, or an engine that cannot tell: stable, and no default named.
  for (const status of [engineStatus({ surface: 'studio', channel: 'stable', source: 'default' }), () => Promise.reject(new Error('engine'))]) {
    const g = fixture({ surface: 'eclipse', status, stable: manifest({ mcp: '0.2.29', bridge: '0.4.29', assistant: '1.5.7' }) });
    await g.open();
    assert.deepEqual(g.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest']);
    assert.equal(g.page.getAgentStackOfferView().title, 'Une mise à jour de Tigo est disponible');
    assert.equal(g.page.getAgentStackChannelView().hint, 'Seules les versions stables sont proposées.');
  }
});

test('a choice made in the panel takes precedence over the symbol; back to Stable downgrades nothing', async () => {
  const storage = new Map([['lib_ConvertigoAssistant.AgentStackChannel', 'stable']]);
  let f = fixture({ surface: 'eclipse', storage, status: engineStatus({ surface: 'studio', channel: 'preview' }), stable: manifest({ mcp: '0.2.29', bridge: '0.4.29', assistant: '1.5.7' }) });
  await f.open();
  assert.equal(f.page.getAgentStackChannel(), 'stable');
  assert.deepEqual(f.names(), ['AgentStackRelease.GetManifest', 'AgentStackStatus'], 'a choice needs no default: the engine policy only once there is an offer');
  assert.equal(f.page.getAgentStackOfferView().title, 'Une mise à jour de Tigo est disponible');
  assert.equal(f.page.getAgentStackChannelView().hint, 'Seules les versions stables sont proposées.', 'the default is not mentioned once chosen');

  // Default preview from the symbol, betas installed: choosing Stable is kept and offers nothing older.
  const betaVersions = { localMcpVersion: betas.mcp, localAgentBridgeVersion: betas.bridge, localAssistantVersion: betas.assistant };
  const fresh = new Map();
  f = fixture({ surface: 'eclipse', storage: fresh, context: betaVersions, status: engineStatus({ surface: 'studio', channel: 'preview', versions: betaVersions }) });
  await f.open();
  assert.equal(f.page.getAgentStackChannel(), 'preview');
  assert.equal(f.page.getAgentStackOfferView(), null, 'the preview stack is installed');
  await f.settings(true);
  f.page.setAgentStackChannel('stable');
  await flush();
  assert.equal(fresh.get('lib_ConvertigoAssistant.AgentStackChannel'), 'stable');
  assert.equal(f.page.getAgentStackChannel(), 'stable');
  assert.equal(f.page.getAgentStackOfferView(), null, 'the stable 1.5.5 is older than 1.5.6-beta.17');
  assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.28-beta.13 · Bridge 0.4.28-beta.16 · Assistant 1.5.6-beta.17', 'the settings follow, with no arrow back');
  f = fixture({ surface: 'eclipse', storage: fresh, context: betaVersions, status: engineStatus({ surface: 'studio', channel: 'preview', versions: betaVersions }) });
  assert.equal(f.page.getAgentStackChannel(), 'stable', 'the next panel of this Studio keeps the choice');
});

test('settings opened again during a read wait for the new status: the server channel is kept', async () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const queue = { status: [], stable: [], preview: [] };
  const later = name => () => { const d = deferred(); queue[name].push(d); return d.promise; };
  const f = fixture({ status: later('status'), stable: later('stable'), preview: later('preview') });
  f.page.refreshAgentStackRelease(); // the host context
  queue.status[0].resolve({ result: engineStatus({ channel: 'preview' }) }); await flush();
  f.page.refreshAgentStackRelease(true); // the settings open while both manifests are read
  queue.stable[0].resolve({ result: manifest() }); queue.preview[0].resolve({ result: manifest(betas, 'preview') }); await flush();
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest', 'AgentStackStatus'],
    'no stable read while the channel is unknown');
  queue.status[1].resolve({ result: engineStatus({ channel: 'preview' }) }); await flush();
  queue.stable[1].resolve({ result: manifest() }); queue.preview[1].resolve({ result: manifest(betas, 'preview') }); await flush();
  assert.equal(f.page.local.AgentStackReleaseChannel, 'preview');
  assert.equal(f.page.getAgentStackVersionText(), 'MCP 0.2.27 → 0.2.28-beta.13 · Bridge 0.4.27 → 0.4.28-beta.16 · Assistant 1.5.5 → 1.5.6-beta.17');
  assert.equal(f.names().length, 6);
});

test('Studio settings opened before the card check read the engine default first, and a failed read falls back to stable', async () => {
  const f = fixture({ surface: 'eclipse', status: engineStatus({ surface: 'studio', channel: 'preview' }) });
  await f.settings(true);
  assert.deepEqual(f.names(), ['AgentStackStatus', 'AgentStackRelease.GetManifest', 'AgentStackRelease.GetPreviewManifest']);
  assert.match(f.page.getAgentStackVersionText(), /Assistant 1\.5\.5 → 1\.5\.6-beta\.17/);
  await f.open();
  assert.equal(f.names().filter(n => n === 'AgentStackStatus').length, 1, 'the card reuses the engine status');

  // Back to Stable while the stable manifest cannot be read: the reviewed fallback, never the pre-release targets.
  let failing = false;
  const g = fixture({ surface: 'eclipse', storage: new Map([['lib_ConvertigoAssistant.AgentStackChannel', 'preview']]),
    stable: () => (failing ? Promise.reject(new Error('offline')) : Promise.resolve({ result: manifest() })) });
  await g.settings(true);
  assert.match(g.page.getAgentStackVersionText(), /→ 1\.5\.6-beta\.17/);
  failing = true;
  g.page.setAgentStackChannel('stable');
  await flush();
  assert.equal(g.page.getAgentStackVersionText(), 'MCP 0.2.27 → 0.2.28 · Bridge 0.4.27 → 0.4.28 · Assistant 1.5.5 → 1.5.6');
  assert.equal(g.page.local.AgentStackRelease.channel, 'stable');
  assert.match(g.page.getAgentStackStatusText(), /Impossible de vérifier la stack publiée/);
});

test('the stack settings show the Studio options or the server channel read-only', () => {
  const channelIf = pageYaml.indexOf('↓ChannelIf [ngx.components.UIControlDirective-1793500000032]: ');
  const label = pageYaml.indexOf('↓Label [ngx.components.UIDynamicElement-1793500000035]: ');
  const optionsIf = pageYaml.indexOf('↓OptionsIf [ngx.components.UIControlDirective-1793500000057]: ');
  const options = pageYaml.indexOf('↓Options [ngx.components.UIDynamicElement-1793500000038]: ');
  const valueIf = pageYaml.indexOf('↓ValueIf [ngx.components.UIControlDirective-1793500000058]: ');
  const hint = pageYaml.indexOf('↓Hint [ngx.components.UIDynamicElement-1793500000054]: ');
  assert.ok(channelIf > 0 && channelIf < label && label < optionsIf && optionsIf < options && options < valueIf && valueIf < hint);
  assert.match(pageYaml, /\n {28}↓OptionsIf \[ngx\.components\.UIControlDirective-1793500000057\]: \n {30}directiveName: If\n {30}directiveSource: \n[^\n]+\n[^\n]+\n {34}- MobileSmartSourceType: script:this\.getAgentStackChannelView\(\)\?\.readOnly === false\n {30}↓Options \[/);
  assert.match(pageYaml, /\n {28}↓ValueIf \[ngx\.components\.UIControlDirective-1793500000058\]: \n {30}directiveName: If\n {30}directiveSource: \n[^\n]+\n[^\n]+\n {34}- MobileSmartSourceType: script:this\.getAgentStackChannelView\(\)\?\.readOnly === true\n {30}↓Value \[ngx\.components\.UIDynamicElement-1793500000059\]: \n/);
  assert.match(pageYaml, /MobileSmartSourceType: plain:agent-stack-channel-value\n[\s\S]{0,400}MobileSmartSourceType: script:this\.getAgentStackChannelView\(\)\?\.valueText\n/);
  assert.match(pageYaml, /\.agent-stack-channel-value \{/);
});

test('the four Assistant languages have every text of the server channel', () => {
  const keys = ['serverChannel', 'serverDefault', 'studioDefault', 'previewFailed'];
  const en = fixture({ language: 'en' }).page;
  for (const language of ['fr', 'en', 'it', 'es']) {
    const page = fixture({ language }).page;
    for (const key of keys) {
      const text = page.agentStackOfferText(key);
      assert.notEqual(text, key, language + ' ' + key);
      if (key !== 'previewFailed') assert.match(text, /\{symbol\}/, language + ' ' + key);
      if (language !== 'en') assert.notEqual(text, en.agentStackOfferText(key), language + ' ' + key + ' is translated');
    }
  }
});
