// While the agent lists its models after the first opening, the panel says it is being set up instead of offering the
// single model of the first, provisional answer (a "fallback", "config" or "presence" source).
// node --test tests/assistant_panel_catalog_pending.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, globals = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = { ...globals };
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
function panel(now, providers) {
  const p = methods(['isAgentModelCatalogPending', 'agentConfiguringText', 'getAgentFooterModelOptions'], { Date: { now: () => now.value } });
  p.local = {};
  p.isAgentBridgeMode = () => true;
  p.getNoCodeServerAgent = () => null;
  p.agentUiLanguage = () => 'fr';
  p.normalizeAgentProviderValue = v => ('' + (v || '')).trim().toLowerCase();
  p.getAgentProvider = () => 'convertigo';
  p.getAgentProviderDescriptor = id => providers.find(x => x.id === id) || null;
  p.getAgentModelOptions = () => [{ id: 'glm-5-3', label: 'glm-5-3' }, { id: 'mistral-large-4', label: 'mistral-large-4' }];
  p.t = (k, d) => d;
  return p;
}

test('the first answer, built from the configuration, is a catalog still being listed', () => {
  const now = { value: 1000 };
  const providers = [
    { id: 'convertigo', source: { type: 'fallback', ok: true }, models: [{ id: 'mistral-large-4' }] },
    { id: 'vibe', source: { type: 'config', settingsCached: true }, models: [{ id: 'a' }, { id: 'b' }] },
    { id: 'codex', source: { type: 'presence' }, models: [] },
    { id: 'claude', source: { type: 'cli' }, models: [{ id: 'opus' }] }
  ];
  const p = panel(now, providers);
  assert.equal(p.isAgentModelCatalogPending(), true, 'Convertigo, fallback');
  assert.equal(p.isAgentModelCatalogPending('vibe'), false, 'a cached catalog is the real one');
  assert.equal(p.isAgentModelCatalogPending('codex'), true, 'presence only');
  assert.equal(p.isAgentModelCatalogPending('claude'), false, 'listed by the agent');
  providers[0].source = { type: 'acp', ok: true, settingsCached: false };
  assert.equal(p.isAgentModelCatalogPending(), false, 'the agent listed its models');
});

test('a listing that never comes stops the wait after three minutes, per agent', () => {
  const now = { value: 1000 };
  const p = panel(now, [{ id: 'convertigo', source: { type: 'fallback' } }, { id: 'codex', source: { type: 'presence' } }]);
  assert.equal(p.isAgentModelCatalogPending(), true);
  now.value += 179000;
  assert.equal(p.isAgentModelCatalogPending(), true);
  assert.equal(p.isAgentModelCatalogPending('codex'), true, 'its own wait starts now');
  now.value += 2000;
  assert.equal(p.isAgentModelCatalogPending(), false, 'three minutes passed');
  assert.equal(p.isAgentModelCatalogPending('codex'), true);
});

test('no wait outside the agent mode or for the model the No Code administrators chose', () => {
  const now = { value: 1000 };
  const p = panel(now, [{ id: 'convertigo', source: { type: 'fallback' } }]);
  p.getNoCodeServerAgent = () => ({ model: 'mistral-large-4' });
  assert.equal(p.isAgentModelCatalogPending(), false);
  p.getNoCodeServerAgent = () => null;
  p.isAgentBridgeMode = () => false;
  assert.equal(p.isAgentModelCatalogPending(), false);
});

test('the input bar offers one locked "Configuring…" choice, the same array while nothing changes', () => {
  const now = { value: 1000 };
  const providers = [{ id: 'convertigo', source: { type: 'fallback' } }];
  const p = panel(now, providers);
  const first = p.getAgentFooterModelOptions();
  assert.equal(first.length, 1);
  assert.equal(first[0].id, '__agent_configuring__');
  assert.equal(first[0].label, 'Configuration en cours…');
  assert.equal(first[0].locked, true, 'the select is disabled');
  assert.match(first[0].title, /encore en cours de configuration/);
  assert.equal(p.getAgentFooterModelOptions(), first, 'same array');
  p.agentUiLanguage = () => 'en';
  assert.equal(p.getAgentFooterModelOptions()[0].label, 'Configuring…');
  providers[0].source = { type: 'acp' };
  assert.equal(p.getAgentFooterModelOptions().map(o => o.id).join(), 'glm-5-3,mistral-large-4,__configure_agent__');
});

test('the setup text exists in the four languages', () => {
  const p = panel({ value: 0 }, []);
  const seen = {};
  for (const lang of ['fr', 'en', 'it', 'es']) {
    p.agentUiLanguage = () => lang;
    seen[lang] = [p.agentConfiguringText('short'), p.agentConfiguringText('hint')];
    assert.ok(seen[lang][0].endsWith('…') && seen[lang][1].length > 30, lang);
  }
  assert.equal(new Set(Object.values(seen).map(v => v[0])).size, 4);
  p.agentUiLanguage = () => 'de';
  assert.equal(p.agentConfiguringText('short'), 'Configuring…');
});

test('the input bar, the agent tab and the model section use the wait', () => {
  const text = plain(page);
  const pending = '(this.isAgentModelCatalogPending && this.isAgentModelCatalogPending())';
  for (const [name, when] of [['AgentModel', "'__agent_configuring__'"], ['AgentModelLabel', "this.agentConfiguringText('short')"], ['AgentReasoningLevels', '[]']]) {
    const block = text.slice(text.indexOf('↓' + name + ' [ngx.components.UIUseVariable'), text.indexOf('↓' + name + ' [ngx.components.UIUseVariable') + 900);
    assert.ok(block.includes('this.getNoCodeServerAgent()) ? ') && block.includes(': (' + pending + ' ? ' + when + ' : '), name);
  }
  assert.ok(text.includes("{{isAgentModelCatalogPending() ? ' · ' + agentConfiguringText('short') : ((local?.AgentModel ? ' · ' + getAgentModelLabel() : '') + (getAgentReasoningLabel() ? ' · ' + getAgentReasoningLabel() : ''))}}"), 'agent tab status');
  assert.match(text, /script:'agent-create-settings-block agent-setting-section agent-model-setting' \+ \(this\.isAgentModelCatalogPending\(\) \? ' is-catalog-pending' : ''\)/);
  assert.match(text, /↓CatalogPending \[ngx\.components\.UICustom-\d+\]: \n[^\n]*\n\s+htmlTemplate: <p \*ngIf="isAgentModelCatalogPending\(\)" class="agent-catalog-pending" role="status">/);
  assert.match(text, /MobileSmartSourceType: script:!this\.isAgentModelCatalogPending\(\) && this\.local && this\.local\.AgentProviderSupportsReasoning === true/);
  const style = text.slice(text.indexOf('↓TigoCatalogPendingStyle ['));
  assert.match(style, /\.agent-model-setting\.is-catalog-pending \.agent-model-option \{\n\s+display: none;/);
});
