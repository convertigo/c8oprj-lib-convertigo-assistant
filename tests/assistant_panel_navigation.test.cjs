// Lot 2 of the panel redesign: one toolbar in every frame, one list of conversations for the Studio and the No Code
// Studio, interface preferences, Escape, a discreet Windows diagnostic and header buttons without a background of
// their own. node --test tests/assistant_panel_navigation.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const menu = read('_c8oProject/mobileMenus/Menu.yaml');
const plain = text => text.replace(/''/g, "'");
const node = (header, next) => {
  const start = page.indexOf(header);
  assert.ok(start > 0, header);
  const end = page.indexOf(next, start + header.length);
  assert.ok(end > start, next);
  return plain(page.slice(start, end));
};
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, context = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const js = ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, context);
  return new context.P();
}

test('the toolbar starts a new conversation with + and opens the list in every frame', () => {
  const toolbar = node('    ↓ButtonSet2 [', '  ↓NoCodeContextPicker [');
  assert.match(toolbar, /beanData: '\{"ionBean":"Icon","IconName":"plain:add-outline"\}'/);
  assert.doesNotMatch(toolbar, /home-outline/);
  assert.match(toolbar, /this\.t\('New_Conversation', 'Nouvelle conversation'\)/);
  const list = node('      ↓FormsHistory [', '      ↓AgentSettingsButton [');
  assert.doesNotMatch(list, /attrName: '\*ngIf'/, 'no longer No Code only');
  assert.match(list, /'modern-header-btn agent-list-button'/);
  assert.match(list, /this\.t\('Previous_Conversations', 'Conversations précédentes'\)/);
  const prepare = list.indexOf('↓PrepareList [');
  assert.ok(prepare > 0 && prepare < list.indexOf('↓History ['), 'before the list opens');
  assert.match(list, /page\.rememberPanelScroll\(\);[\s\S]*page\.reloadAgentConversationList\(\);/);
});

test('Reveal, the theme and the language leave the toolbar of Tigo for the preferences', () => {
  const toolbar = node('    ↓ButtonSet2 [', '  ↓NoCodeContextPicker [');
  assert.doesNotMatch(toolbar, /↓RevealModeButton \[/);
  assert.match(toolbar, /MobileSmartSourceType: 'plain: !this\.global\.themeLockedFromUrl && !\(this\.isAgentBridgeMode && this\.isAgentBridgeMode\(\)\)'/);
  assert.match(toolbar, /\? 'toolbar-lang-select agent-hidden' : 'toolbar-lang-select'/);
  const prefs = node('                  ↓PrefsCategory [', '                  ↓RuntimeCategory [');
  const iface = prefs.slice(prefs.indexOf('↓InterfaceSettings ['));
  assert.ok(prefs.indexOf('↓RevealSettings1 [') > 0, 'Reveal stays in the preferences');
  assert.ok(iface.length > 0 && prefs.indexOf('↓ConfirmSettings [') < prefs.indexOf('↓InterfaceSettings ['));
  assert.match(iface, /MobileSmartSourceType: plain:!\(this\.isEmbeddedInC8Oforms && this\.isEmbeddedInC8Oforms\(\)\)/, 'C8Oforms sets them in No Code');
  assert.match(iface, /this\.t\('Agent_Interface_Title', 'Interface'\)/);
  assert.match(iface, /↓LanguageChoice \[[\s\S]*plain:agent-pref-language[\s\S]*↓SetLanguage \[/);
  const theme = iface.slice(iface.indexOf('↓ThemeChoice ['));
  assert.match(theme, /↓SetTheme \[/);
  assert.match(theme, /MobileSmartSourceType: 'plain: !this\.global\.themeLockedFromUrl'/, 'only where the host lets the panel choose');
});

test('the menu keeps the former assistants and no second way to the settings', () => {
  assert.doesNotMatch(menu, /↓AgentSettingsItem \[/);
  for (const item of ['↓LightRagItem [', '↓ComponentItem [', '↓AgentItem [']) {
    assert.ok(menu.includes(item), item);
  }
});

test('one list of conversations: its tools, days, states and pages in the Studio and the No Code Studio', () => {
  assert.doesNotMatch(page, /↓FormsHistoryControls \[/);
  const panel = node('              ↓HistoryTools [', '              ↓FormsHistoryAll [');
  assert.match(panel, /↓HistoryTools \[[^\n]*\n[\s\S]*?MobileSmartSourceType: script:this\.local\?\.ShowConversationPanel === true && !this\.local\?\.ShowAgentConfigPanel/);
  assert.match(panel, /script:this\.isFormsRecentHistory\(\) \? this\.getFormsHistoryItems\(\) : this\.getHistoryItems\(\)/);
  for (const name of ['↓HistoryDay [', '↓HistoryStatus [', '↓HistoryMore [']) {
    const at = panel.indexOf(name);
    assert.ok(at > 0, name);
    assert.doesNotMatch(panel.slice(at, at + 400), /!this\.isEmbeddedInC8Oforms\(\) &&/, name);
  }
  assert.match(panel, /'forms-history-empty agent-list-skeleton' : 'forms-history-empty'/);
});

test('in the No Code Studio the list reads the open application as its project, with the labels of C8Oforms', () => {
  const p = methods(['historyText', 'historyCurrentProject', 'getHistoryItems'], {});
  p.isEmbeddedInC8Oforms = () => true;
  p.getFormsHistoryText = key => 'forms:' + key;
  p.agentUiLanguage = () => 'en';
  p.historyDayLabel = () => 'Today';
  p.getAgentProviderLabel = v => v;
  p.local = {
    NoCodeSelectedFormId: 'f1', HistoryLimit: 30,
    AgentConversations: [
      { conversationId: 'a', title: 'Fix the form', updatedAt: 3, nocodeContext: { formId: 'f1', formName: 'Leave request', pageName: 'Home' } },
      { conversationId: 'b', title: 'Other', updatedAt: 2, nocodeContext: { formId: 'f2', formName: 'Expenses' } }]
  };
  assert.equal(p.historyText('search'), 'forms:search');
  assert.equal(p.historyText('all'), 'forms:any');
  assert.equal(p.historyText('project'), 'forms:current');
  assert.equal(p.historyText('today'), 'Today', 'the other texts are the list ones');
  assert.equal(p.historyCurrentProject(), 'f1');
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['a', 'b']);
  p.local.HistoryProjectOnly = true;
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['a'], 'this application');
  p.local.HistoryProjectOnly = false;
  p.local.HistoryQuery = 'expenses';
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['b'], 'the application name is searched');
  p.isEmbeddedInC8Oforms = () => false;
  p.local.HistoryQuery = '';
  p.local.CurrentStudioProject = 'crm';
  assert.equal(p.historyText('all'), 'All');
  assert.equal(p.historyCurrentProject(), 'crm');
});

test('the list opened from the toolbar is read again', async () => {
  const calls = [];
  const p = methods(['reloadAgentConversationList'], {});
  p.local = { AgentConversations: [] };
  p.tick = () => {};
  p.isAgentBridgeMode = () => true;
  p.getConfiguredAgentProvider = () => 'convertigo';
  p.getAgentContextUserId = () => 'studio';
  p.getAgentSkillProfile = () => '';
  p.c8o = { callJsonObject: (name, vars) => { calls.push([name, vars]); return { async: () => Promise.resolve({ result: { conversations: [{ conversationId: 'x' }] } }) }; } };
  p.reloadAgentConversationList();
  assert.equal(p.local.AgentConversationsLoading, true, 'an empty list shows it loads');
  assert.equal(p.local.HistoryLimit, 30);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls[0][0], 'lib_ConvertigoAssistant.AgentListConversations');
  assert.equal(calls[0][1].provider, 'convertigo');
  assert.deepEqual(p.local.AgentConversations, [{ conversationId: 'x' }]);
  assert.equal(p.local.AgentConversationsLoading, false);
  const anonymous = methods(['reloadAgentConversationList'], {});
  anonymous.local = {}; anonymous.tick = () => {}; anonymous.isAgentBridgeMode = () => true;
  anonymous.getAgentContextUserId = () => 'nocode-anonymous'; anonymous.getAgentSkillProfile = () => 'nocode';
  anonymous.c8o = { callJsonObject: () => { throw new Error('no call without a No Code user'); } };
  anonymous.reloadAgentConversationList();
});

test('Escape leaves the settings and the list, never while typing', () => {
  let handler = null;
  const document = { addEventListener: (type, fn) => { if (type === 'keydown') handler = fn; } };
  const p = methods(['bindPanelEscapeKey'], { document });
  let back = 0, target = '';
  p.getPanelBackTarget = () => target;
  p.goBackFromPanelScreen = () => { back++; };
  p.bindPanelEscapeKey();
  p.bindPanelEscapeKey();
  assert.ok(handler, 'one listener');
  const plainTarget = { closest: () => null };
  const field = { closest: () => ({}) };
  handler({ key: 'Escape', target: plainTarget });
  assert.equal(back, 0, 'no screen to leave');
  target = 'conversation';
  handler({ key: 'Enter', target: plainTarget });
  handler({ key: 'Escape', target: field });
  assert.equal(back, 0);
  handler({ key: 'Escape', target: plainTarget });
  assert.equal(back, 1);
  assert.match(page, /public getPanelBackTarget\(\) \{\n\s+if \(this\.bindPanelEscapeKey\) \{ this\.bindPanelEscapeKey\(\); \}/);
});

test('the Windows diagnostic says nothing while the checks pass, one line otherwise, the rest under Details', () => {
  const make = diagnostics => {
    const p = methods(['getAgentWindowsDiagnosticText', 'getAgentWindowsDiagnosticSummary'], {});
    p.getAgentSettingsRoot = () => ({ diagnostics });
    p.agentUiLanguage = () => 'en';
    p.t = (key, fallback) => key;
    return p;
  };
  const fine = { platform: 'windows', longPaths: { registryEnabled: true, fileSystemProbe: 'supported' },
    agentsDirectory: { directory: 'C:\\Users\\me\\ws\\agents', configured: false, rootLength: 30, status: 'within_budget', estimatedLongestPathLength: 180, pathLimit: 259, recommendedMaxRootLength: 60, safetyMargin: 32 } };
  assert.equal(make(fine).getAgentWindowsDiagnosticText(), '', 'the storage figures alone show nothing');
  assert.equal(make(fine).getAgentWindowsDiagnosticSummary(), '');
  const disabled = make({ ...fine, longPaths: { registryEnabled: false, fileSystemProbe: 'failed' } });
  assert.equal(disabled.getAgentWindowsDiagnosticSummary(), 'Agent_Windows_Diagnostic_Summary');
  assert.match(disabled.getAgentWindowsDiagnosticText(), /Agent_Windows_Paths_Disabled/);
  assert.match(disabled.getAgentWindowsDiagnosticText(), /assistant\.agents\.directory/, 'figures in the details when they matter');
  assert.equal(make({ ...fine, longPaths: { registryEnabled: true, fileSystemProbe: 'unknown' } }).getAgentWindowsDiagnosticSummary(), 'Agent_Windows_Diagnostic_Unknown_Summary');
  assert.equal(make({ ...fine, pathIssues: [{ source: 'path', index: 1, pathLength: 9, code: 'invalid_path' }] }).getAgentWindowsDiagnosticSummary(), 'Agent_Windows_Path_Issues_Summary');
  const box = node('                        ↓WindowsDiagnosticsIf [', '                    ↓ServerManaged [');
  assert.match(box, /script:this\.getAgentWindowsDiagnosticSummary\(\)/);
  assert.match(box, /↓Message \[[\s\S]*attrName: '\*ngIf'[\s\S]*plain:this\.local\?\.WindowsDiagnosticOpen === true/);
  assert.match(box, /↓DetailsToggle \[[\s\S]*page\.local\.WindowsDiagnosticOpen = page\.local\.WindowsDiagnosticOpen !== true;/);
  assert.ok(box.indexOf('↓DetailsToggle [') < box.indexOf('↓Documentation ['));
});

test('header buttons have no background of their own; the settings button shows one while open', () => {
  const style = plain(page.slice(page.indexOf('↓TigoLot2Style [')));
  assert.match(style, /ion-header\.modern-header ion-menu-button\.modern-header-btn[\s\S]*?\{\n\s+--background: transparent !important;/);
  assert.match(style, /ion-header\.modern-header ion-button\.agent-settings-button\.active \{\n\s+--background: rgba\(14, 165, 233, 0\.16\) !important;/);
  assert.match(style, /\.agent-windows-diagnostics \{[\s\S]*?background: transparent !important;/);
  assert.match(style, /prefers-reduced-motion/);
});

test('the new texts exist in the four languages', () => {
  for (const key of ['Agent_Windows_Diagnostic_Summary', 'Agent_Windows_Diagnostic_Unknown_Summary', 'Agent_Windows_Path_Issues_Summary', 'Agent_Show_Details', 'Agent_Hide_Details', 'Agent_Interface_Title', 'Agent_Language_Title']) {
    assert.equal((page.match(new RegExp('\\n\\s+' + key + ': "[^"\\n]+",', 'g')) || []).length, 4, key);
  }
});
