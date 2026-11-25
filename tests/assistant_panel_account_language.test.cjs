// Lot 4b of the panel redesign: the language chosen in the panel loads its file and stays chosen after a reload, the
// library and budget texts exist in the four languages, a ready agent opens on the conversation, and the Account tab
// shows the usage of the chosen agent with the feedback to Convertigo.
// node --test tests/assistant_panel_account_language.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, blockWith } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const app = read('_c8oProject/mobileNgxApp.yaml');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, globals = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = { ...globals };
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
const node = (from, to) => {
  const start = page.indexOf(from);
  assert.ok(start > 0, from);
  const end = page.indexOf(to, start);
  assert.ok(end > start, to);
  return plain(page.slice(start, end));
};

function languageHost(known) {
  const stored = {}, fetched = [], calls = [];
  const globals = {
    window: { localStorage: { setItem: (k, v) => { stored[k] = v; } }, dispatchEvent: e => calls.push('event:' + e.detail.language) },
    document: { documentElement: { setAttribute: () => {} }, baseURI: 'http://studio.test/convertigo/projects/lib_ConvertigoAssistant/DisplayObjects/mobile/' },
    URL, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    fetch: url => { fetched.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ Agent_Settings_Title: 'Réglages' }) }); }
  };
  const p = methods(['setPanelLanguage'], globals);
  p.global = {};
  p.translate = {
    translations: known ? { fr: { Agent_Settings_Title: 'Réglages' } } : { fr: {} },
    setTranslation: (lang, json, merge) => calls.push('set:' + lang + ':' + Object.keys(json).length + ':' + merge),
    use: lang => calls.push('use:' + lang)
  };
  p.refreshFooterLocale = () => calls.push('footer');
  p.tick = () => {};
  return { p, stored, fetched, calls };
}

test('the panel language loads its file, then switches, and is remembered for the next open', async () => {
  const { p, stored, fetched, calls } = languageHost(false);
  p.setPanelLanguage('FR');
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(fetched, ['http://studio.test/convertigo/projects/lib_ConvertigoAssistant/DisplayObjects/mobile/assets/i18n/fr.json']);
  assert.deepEqual(calls, ['set:fr:1:true', 'use:fr', 'footer', 'event:fr']);
  assert.equal(p.global.currentLanguage(), 'fr');
  assert.equal(p.global.getLanguageLabelKey(), 'Lang_French');
  assert.equal(stored['lib_ConvertigoAssistant.PanelLanguage'], 'fr');
  assert.equal(stored['c8o-lang'], 'fr');
});

test('a language already loaded switches at once, an unknown one falls back to English', () => {
  const known = languageHost(true);
  known.p.setPanelLanguage('fr');
  assert.deepEqual(known.fetched, []);
  assert.deepEqual(known.calls, ['use:fr', 'footer', 'event:fr']);
  const other = languageHost(false);
  other.p.setPanelLanguage('de');
  assert.equal(other.p.global.currentLanguage(), 'en');
});

test('both language choices of the panel use it, and the app reads the panel choice before the Studio language', () => {
  const header = node('↓LanguageSelector [', '↓LangEN [');
  assert.match(header, /page\.setPanelLanguage\(event && event\.detail \? event\.detail\.value : null\);/);
  const prefs = node('↓LanguageChoice [', '↓ThemeChoice [');
  assert.match(prefs, /page\.setPanelLanguage\(event && event\.detail \? event\.detail\.value : null\);/);
  const init = app.slice(app.indexOf('↓SetLanguage ['), app.indexOf('↓AuthenticateStudioSession ['));
  const query = init.indexOf('readQuery("assistantLanguage")'), panel = init.indexOf('"lib_ConvertigoAssistant.PanelLanguage"'), parent = init.indexOf('selected = readParentLanguage();');
  assert.ok(query > 0 && query < panel && panel < parent, 'query, then the panel choice, then the Studio language');
});

test('the library and budget texts exist in Italian and Spanish', () => {
  const p = methods(['tigoText', 'quotaLabel']);
  const words = {};
  for (const lang of ['fr', 'en', 'it', 'es']) {
    p.agentUiLanguage = () => lang;
    words[lang] = [p.tigoText('skills'), p.tigoText('favorite'), p.tigoText('runtime'), p.quotaLabel('team'), p.quotaLabel('remaining'), p.quotaLabel('account')];
  }
  assert.deepEqual(words.fr, ['Compétences', 'Épingler sous la saisie', 'Avancé', 'Équipe', 'restants', 'Compte']);
  assert.deepEqual(words.en, ['Skills', 'Pin under the input bar', 'Advanced', 'Team', 'remaining', 'Account']);
  assert.deepEqual(words.it, ['Competenze', 'Fissa sotto il campo di input', 'Avanzate', 'Team', 'rimanenti', 'Account']);
  assert.deepEqual(words.es, ['Habilidades', 'Fijar bajo el campo de entrada', 'Avanzado', 'Equipo', 'restantes', 'Cuenta']);
  const keys = block => (block.match(/(\w+):'/g) || []).sort().join();
  const source = pageClass();
  const tigo = source.slice(source.indexOf('public tigoText(key: string) {'), source.indexOf('// the panel language, as its other texts'));
  const tables = ['const fr = {', 'const en = {', 'const it = {', 'const es = {'].map(start => tigo.slice(tigo.indexOf(start), tigo.indexOf('\n        };', tigo.indexOf(start))));
  assert.equal(new Set(tables.map(keys)).size, 1, 'the same keys in the four tables');
  assert.doesNotMatch(tigo, /:'[^']*(favori|[Ff]avorite)[^']*'/, 'pinned prompts, no favorites');
});

test('a ready agent opens on the conversation, chosen or not', () => {
  const source = pageClass();
  assert.match(source, /if \(providerReady && this\.local\.AgentConfigExplicitOpen !== true\) \{\n\s+this\.local\.ShowAgentConfigPanel = false;\n\s+\} else if \(!providerReady && this\.local\.AgentProviderChoiceConfirmed !== true\) \{/);
  assert.match(plain(page), /\/\/ a ready agent opens on the conversation, chosen or not\n\s+if \(providerReady\) \{/);
  const code = blockWith('_c8oProject/mobilePages/Page.yaml', 'readyProvider = !!(page.hasReadyAgentProvider');
  const run = ready => {
    const pg = { local: { AgentSettings: {}, ShowAgentConfigPanel: true }, isAgentBridgeMode: () => true, hasReadyAgentProvider: () => ready, getAgentProvider: () => 'convertigo', setEnableChat() {}, tick() {}, setAgentSettingsUrlState() {} };
    new Function('page', 'resolve', 'window', code)(pg, () => {}, undefined);
    return pg.local.ShowAgentConfigPanel;
  };
  assert.equal(run(true), false, 'first open with the Convertigo agent ready: the conversation');
  assert.equal(run(false), true, 'no agent ready: the settings');
});

test('the Account tab shows the usage of the chosen agent and the feedback to Convertigo', () => {
  const tabs = node('↓SettingsTabs [', '↓SettingsWait [');
  assert.match(tabs, /detail: \{value: 'account'\}/);
  assert.match(tabs, /\{\{quotaLabel\('account'\)\}\}/);
  assert.match(tabs, /\{\{getAccountTabStatus\(\)\}\}/);
  assert.ok(tabs.indexOf("value: 'prefs'") < tabs.indexOf("value: 'account'") && tabs.indexOf("value: 'account'") < tabs.indexOf("value: 'runtime'"));
  const account = node('↓AccountCategory [', '↓RuntimeCategory [');
  assert.match(account, /\*ngIf="getAgentQuotaView\(\) as q"/);
  assert.match(account, /\*ngFor="let row of q\.rows"/);
  assert.match(account, /\(click\)="requestAgentQuota\(true\)"/);
  assert.match(account, /\[href\]="q\.portalUrl" target="_blank" rel="noopener"/);
  assert.ok(account.indexOf('↓AccountUsage [') < account.indexOf('↓FeedbackSettings ['));
  const p = methods(['getAccountTabStatus', 'quotaLabel']);
  p.agentUiLanguage = () => 'fr';
  p.getAgentQuotaView = () => ({ percentText: '69 %' });
  p.feedbackSettingVisible = () => true;
  p.feedbackSettingMode = () => 'off';
  p.agentFeedbackText = key => key === 'off' ? 'Désactivé' : key;
  assert.equal(p.getAccountTabStatus(), 'Budget 69 % · Retours Désactivé');
  p.getAgentQuotaView = () => ({ percentText: '' });
  p.feedbackSettingVisible = () => false;
  assert.equal(p.getAccountTabStatus(), '');
});

test('the quick suggestions follow the language once its file is read, and after each change', async () => {
  const p = methods(['bindPanelLanguageRefresh'], { setTimeout });
  const listeners = [];
  let refreshed = 0;
  p.translate = { onLangChange: { subscribe: fn => { listeners.push(fn); return { unsubscribe() {} }; } } };
  p.refreshFooterLocale = () => { refreshed++; };
  p.bindPanelLanguageRefresh();
  p.bindPanelLanguageRefresh();
  assert.equal(listeners.length, 1, 'bound once');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(refreshed, 1, 'refreshed when bound, the file may already be there');
  listeners[0]({ lang: 'it' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(refreshed, 2);
  assert.match(pageClass(), /public getPanelBackTarget\(\) \{\n\s+if \(this\.bindPanelEscapeKey\) \{ this\.bindPanelEscapeKey\(\); \}\n\s+if \(this\.bindPanelLanguageRefresh\) \{ this\.bindPanelLanguageRefresh\(\); \}/);
});
