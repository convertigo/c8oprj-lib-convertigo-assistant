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
  assert.match(read('js/agent_bridge_client.js'), /var settings = agentSettingsForOptions\(options, workspaceRoot, userKey, projectFilter, provider\);\n\s+attachTigoAccessRefusal\(settings\);/);
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
  assert.match(page, /var accessRefusalText = provider === ''convertigo'' && authenticationRequired && this\.getConvertigoAccessRefusalText \? this\.getConvertigoAccessRefusalText\(\) : '''';\n\s+this\.local\.AgentRuntimeStatusText = accessRefusalText \? accessRefusalText :/);
});
