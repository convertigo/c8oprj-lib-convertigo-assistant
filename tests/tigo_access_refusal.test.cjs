// The reason of the last TigoAccess refusal, in the settings of a desktop Studio instead of a bare "Needs setup":
// TigoAccessBootstrap keeps its code beside the key, the settings attach it to the Convertigo agent, the panel tells
// what to do in its language. node --test tests/tigo_access_refusal.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path').posix;
const { ts, read, backendParts } = require('./helpers/assistant-source.cjs');

const CODES = ['user_budget_migration_required', 'psc_required', 'authentication_failed', 'access_revoked', 'access_mismatch',
  'configuration_required', 'membership_removed', 'membership_unavailable', 'membership_ambiguous', 'rate_limited',
  'service_unavailable', 'local_installation_failed'];

function rememberStep() {
  const yaml = read('_c8oProject/sequences/TigoAccessBootstrap.yaml');
  const start = yaml.indexOf('↓RememberAccessRefusal [steps.SimpleStep-');
  assert.ok(start > yaml.indexOf('↓ExchangeRequired'), 'after the exchange');
  assert.ok(start < yaml.indexOf('↓Response [steps.JsonToXmlStep-'), 'before the response');
  const lines = yaml.slice(start).split('\n');
  const from = lines.findIndex(l => /^  expression: \|/.test(l));
  const body = [];
  for (let i = from + 1; i < lines.length && (!lines[i].trim() || lines[i].startsWith('    ')); i++) body.push(lines[i].slice(4));
  let code = body.join('\n').trim();
  if (code.startsWith("'") && code.endsWith("'")) code = code.slice(1, -1).replace(/''/g, "'");
  return code;
}

function runRemember(response) {
  const files = new Map();
  class P { constructor(p) { this.p = p; } resolve(c) { return new P(path.join(this.p, c)); } toString() { return this.p; } }
  const box = {
    response, directory: new P('/ws/agents/convertigo'), safePath: () => {},
    JSON, Date,
    java: { lang: { String: class { constructor(t) { this.t = String(t); } getBytes() { return Buffer.from(this.t, 'utf8'); } } },
      nio: { file: { Files: { createDirectories() {}, write: (p, b) => files.set(String(p), Buffer.from(b).toString('utf8')),
        deleteIfExists: p => files.delete(String(p)) } } } }
  };
  files.set('/ws/agents/convertigo/tigo-access-refusal.json', '{"code":"older"}');
  vm.runInNewContext(rememberStep(), box);
  return files.get('/ws/agents/convertigo/tigo-access-refusal.json');
}

test('TigoAccessBootstrap keeps the code of a refusal, never a credential, and forgets it once a key is in place', () => {
  const kept = JSON.parse(runRemember({ status: 'error', code: 'user_budget_migration_required', error: 'migration' }));
  assert.equal(kept.code, 'user_budget_migration_required');
  assert.ok(!Number.isNaN(Date.parse(kept.at)));
  assert.deepEqual(Object.keys(kept).sort(), ['at', 'code', 'version']);
  assert.equal(JSON.parse(runRemember({ status: 'error', code: 'odd<code>"x' })).code, 'oddcodex', 'only a plain code');
  assert.equal(runRemember({ status: 'ok', state: 'ready' }), undefined, 'a key in place removes it');
  assert.equal(runRemember({ status: 'ok', state: 'external_key' }), undefined);
  assert.equal(runRemember({ status: 'error', code: 'authentication_required' }), '{"code":"older"}', 'a missing Studio session is not a refusal');
});

function settingsBox({ kind, file }) {
  const engines = {
    eclipse: { isStudioMode: () => true },
    electron: { isStudioMode: () => false, isDesktopStudio: () => true },
    server: { isStudioMode: () => false, isDesktopStudio: () => false }
  };
  class File {
    constructor(parent, child) { this.p = child === undefined ? String(parent) : path.join(String(parent.p || parent), child); }
    isFile() { return this.p === '/ws/agents/convertigo/tigo-access-refusal.json' && file !== undefined; }
    length() { return Buffer.byteLength(file || ''); }
    toPath() { return this.p; }
  }
  const box = {
    Engine: { ...engines[kind], USER_WORKSPACE_PATH: '/ws' }, File,
    Files: { readAllBytes: () => Buffer.from(file || '', 'utf8') }, StandardCharsets: { UTF_8: 'utf8' },
    C8O: { tigoAgentsDirectory: (root, F) => new F(root + '/agents') },
    java: { lang: { String: class { constructor(b) { this.t = Buffer.from(b).toString('utf8'); } toString() { return this.t; } } } },
    trim: value => String(value ?? '').trim()
  };
  vm.runInNewContext(backendParts(['attachTigoAccessRefusal', 'agentsDirectory']), box);
  return box;
}

test('the settings of a desktop Studio attach the last refusal to the Convertigo agent, a server never', () => {
  const settings = () => ({ providers: [{ id: 'convertigo', status: 'authentication_required' }, { id: 'codex', status: 'ready' }] });
  const file = JSON.stringify({ version: 1, code: 'user_budget_migration_required', at: '2026-11-12T13:50:00.000Z' });
  for (const kind of ['eclipse', 'electron']) {
    const s = settings();
    settingsBox({ kind, file }).attachTigoAccessRefusal(s);
    assert.deepEqual({ ...s.providers[0].accessRefusal }, { code: 'user_budget_migration_required', at: '2026-11-12T13:50:00.000Z' }, kind);
    assert.equal(s.providers[1].accessRefusal, undefined, kind);
  }
  const server = settings();
  settingsBox({ kind: 'server', file }).attachTigoAccessRefusal(server);
  assert.equal(server.providers[0].accessRefusal, undefined, 'a server has no Studio PSC');
  const none = settings();
  settingsBox({ kind: 'electron' }).attachTigoAccessRefusal(none);
  assert.equal(none.providers[0].accessRefusal, undefined, 'no refusal file');
  // in the one read of the settings: the settings screen, a new conversation and the answer of a setup all carry it
  const client = read('js/agent_bridge_client.js');
  assert.match(client, /var settings = bridgeCall\(options, "agent_settings", payload, 120000\);\n\s+settings\.ok = settings\.ok !== false;\n\s+\/\/[^\n]*\n\s+attachTigoAccessRefusal\(settings\);/);
  assert.equal((client.match(/attachTigoAccessRefusal\(settings\);/g) || []).length, 1);
});

function pageMethods() {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  const start = page.indexOf('        	public getConvertigoAccessRefusal() {');
  const end = page.indexOf('        	public getProjectSubtitle() {');
  assert.ok(start > 0 && end > start);
  const source = 'class P {\n' + page.slice(start, end) + '\n}';
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  return vm.runInNewContext(js + '\nP;', {});
}

test('the panel tells the reason and what to do for every refusal code, a generic one for an unknown code', () => {
  const P = pageMethods();
  const make = (provider, texts = {}) => {
    const page = new P();
    page.local = { AgentSettings: { providers: [provider] } };
    page.isAgentProviderReady = p => p.status === 'ready';
    page.t = (key, fallback) => (key in texts ? texts[key] : fallback);
    return page;
  };
  const refused = { id: 'convertigo', status: 'authentication_required', accessRefusal: { code: 'user_budget_migration_required' } };
  assert.equal(make(refused, { Tigo_Refusal_user_budget_migration_required: 'migrate' }).getConvertigoAccessRefusalText(), 'migrate');
  assert.equal(make({ ...refused, status: 'ready' }).getConvertigoAccessRefusalText(), '', 'a ready agent shows no refusal');
  assert.equal(make({ id: 'convertigo', status: 'authentication_required' }).getConvertigoAccessRefusalText(), '');
  assert.equal(make({ ...refused, accessRefusal: { code: 'brand_new_code' } }, { Tigo_Refusal_Other: 'refused ({code})' }).getConvertigoAccessRefusalText(),
    'refused (brand_new_code)', 'an unknown code keeps its code in the generic text');

  const page = read('_c8oProject/mobilePages/Page.yaml');
  for (const code of [...CODES, 'Other']) {
    const lines = page.match(new RegExp(`Tigo_Refusal_${code}: "[^"\\n]+"`, 'g')) || [];
    assert.equal(lines.length, 4, `${code} in en, fr, it and es`);
  }
  for (const code of CODES) assert.ok(page.includes(`"${code}"`), `${code} is a known code of the panel`);
  assert.match(page, /Tigo_Refusal_user_budget_migration_required: "Tigo n’est pas activé : votre accès doit être migré par un administrateur Convertigo\. Contactez Convertigo\."/);
  // under the name of the agent, and in "Runtime and stack" instead of "key missing"
  assert.match(page, /MobileSmartSourceType: 'script:this\.getConvertigoAccessRefusalText\(\) \|\| this\.t\(''Agent_Provider_Convertigo_Copy''/);
  // whatever the state of the runtime: not installed yet, a failed setup, after a restart of the Studio
  assert.match(page, /var accessRefusalText = provider === ''convertigo'' && this\.getConvertigoAccessRefusalText \? this\.getConvertigoAccessRefusalText\(\) : '''';\n\s+this\.local\.AgentRuntimeStatusText = accessRefusalText \? accessRefusalText :/);
  assert.match(page, /var accessRefusalText = page\.getConvertigoAccessRefusalText \? page\.getConvertigoAccessRefusalText\(\) : '''';\n\s+page\.local\.AgentRuntimeStatusText = accessRefusalText \? accessRefusalText : authenticationRequired \? tr\(''Agent_Auth_Convertigo_Required''/);
  assert.doesNotMatch(page, /accessRefusalText = [^\n]*authenticationRequired &&/);
});

function setupRun() {
  const yaml = read('_c8oProject/sequences/AgentSetup.yaml');
  const start = yaml.indexOf('↓Run [steps.SimpleStep-1781810000101]');
  const body = yaml.slice(yaml.indexOf('  expression: |\n', start) + 16, yaml.indexOf('↓AttachAccessState', start));
  let code = body.split('\n').map(l => l.slice(4)).join('\n').trim();
  assert.ok(code.startsWith("'") && code.endsWith("'"));
  return code.slice(1, -1).replace(/''/g, "'");
}

test('a setup refused by TigoAccess answers the code, the panel shows its reason in Runtime and stack at once', () => {
  const run = response => {
    const box = { tigoActivation: { document: { response } }, include() { throw new Error('the runtime is not set up on a refusal'); } };
    vm.runInNewContext(setupRun() + '\nthis.result = result;', box);
    return box.result;
  };
  const refused = run({ status: 'error', code: 'user_budget_migration_required', error: 'migration' });
  assert.equal(refused.status, 'setup_required');
  assert.deepEqual({ ...refused.accessRefusal }, { code: 'user_budget_migration_required' });
  assert.equal(run({ status: 'error', code: 'odd<b>' }).accessRefusal.code, 'oddb', 'only a plain code');
  assert.equal(run({ status: 'error', code: 'authentication_required' }).accessRefusal, undefined, 'a missing Studio session is not a refusal');
  assert.equal(run({ status: 'error' }).accessRefusal, undefined);

  const P = pageMethods();
  const page = new P();
  page.local = { AgentSettings: { providers: [{ id: 'convertigo', status: 'authentication_required' }, { id: 'codex', status: 'ready' }] } };
  page.isAgentProviderReady = p => p.status === 'ready';
  page.t = (key, fallback) => (key === 'Tigo_Refusal_access_revoked' ? 'revoked' : fallback);
  page.setConvertigoAccessRefusal(run({ status: 'error', code: 'access_revoked' }).accessRefusal);
  assert.equal(page.getConvertigoAccessRefusalText(), 'revoked');
  assert.equal(page.local.AgentSettings.providers[1].accessRefusal, undefined);
  page.setConvertigoAccessRefusal(undefined);
  assert.equal(page.getConvertigoAccessRefusalText(), '', 'a setup that failed for another reason drops it');

  const source = read('_c8oProject/mobilePages/Page.yaml');
  assert.match(source, /if \(provider === ''convertigo'' && page\.setConvertigoAccessRefusal\) \{ page\.setConvertigoAccessRefusal\(result\.accessRefusal\); \}\n[^\n]*\n\s+var setupError =/);
  assert.match(source, /var accessRefusalText = provider === ''convertigo'' && page\.getConvertigoAccessRefusalText \? page\.getConvertigoAccessRefusalText\(\) : '''';\n\s+page\.local\.AgentRuntimeStatusText = accessRefusalText \? accessRefusalText : tr\(''Agent_Runtime_Installation_Failed''/);
});
