// The settings and the list of conversations are screens of their own (lot 1 of the panel redesign): never stacked over
// a conversation, with a way back to the screen they were opened from. node --test tests/assistant_panel_screens.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const plain = text => text.replace(/''/g, "'");
const node = (header, next) => {
  const start = page.indexOf(header);
  assert.ok(start > 0, header);
  const end = next ? page.indexOf(next, start + header.length) : start + 4000;
  assert.ok(end > start, next);
  return plain(page.slice(start, end));
};

function screenClass() {
  const start = page.indexOf('        public getPanelScreen() {');
  const end = page.indexOf('        public getAgentProviderTitle(provider) {');
  assert.ok(start > 0 && end > start, 'screen helpers');
  const js = ts.transpileModule('class P {\n' + page.slice(start, end) + '\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  return js;
}

function make(local, options = {}) {
  const timers = [];
  const context = { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } };
  const P = vm.runInNewContext(screenClass() + '\nP;', context);
  const p = new P();
  p.local = { Messages: [], ...local };
  p.calls = [];
  p.isAgentBridgeMode = () => options.bridge !== false;
  p.isAgentSettingsPageShown = () => p.local.ShowAgentConfigPanel === true || options.forcedSettings === true;
  p.hasConversationStarted = () => (p.local.Messages || []).some(m => m.type === 'user');
  p.isEmbeddedInC8Oforms = () => options.noCode === true;
  p.getFormsHistoryText = key => 'forms:' + key;
  p.t = (key, fallback) => key;
  p.closeAgentSettingsPage = () => { p.calls.push('closeSettings'); p.local.ShowAgentConfigPanel = false; };
  p.closeConversationsPanel = () => { p.calls.push('closeList'); p.local.ShowConversationPanel = false; };
  p.content = {
    scrollToPoint: (x, y) => p.calls.push('scrollTo:' + y),
    scrollToBottom: () => p.calls.push('scrollToBottom')
  };
  p.timers = timers;
  return p;
}

test('the panel shows one screen at a time: settings, the list, the conversation or the home', () => {
  assert.equal(make({}).getPanelScreen(), 'home');
  assert.equal(make({ NewConversationMode: true, Messages: [{ type: 'user' }] }).getPanelScreen(), 'conversation', 'the first message of a new conversation');
  assert.equal(make({ Conversation: 'agent-1' }).getPanelScreen(), 'conversation', 'a reopened conversation');
  assert.equal(make({ Conversation: 'agent-1', NewConversationMode: true }).getPanelScreen(), 'home', 'Home was clicked');
  assert.equal(make({ ShowConversationPanel: true }).getPanelScreen(), 'history');
  assert.equal(make({ ShowConversationPanel: true, NewConversationMode: true }).getPanelScreen(), 'home', 'the list is not open in a new conversation');
  assert.equal(make({ Conversation: 'agent-1', ShowAgentConfigPanel: true, ShowConversationPanel: true }).getPanelScreen(), 'settings', 'settings first');
  assert.equal(make({ Conversation: 'agent-1' }, { bridge: false }).getPanelScreen(), 'home', 'the former assistants keep their page');
});

test('the settings the user opened and the list have a way back to the screen they were opened from', () => {
  const fromConversation = make({ Conversation: 'agent-1', ShowAgentConfigPanel: true, AgentConfigExplicitOpen: true, AgentConfigReturnState: { showConversationPanel: false } });
  assert.equal(fromConversation.getPanelBackTarget(), 'conversation');
  assert.equal(fromConversation.getPanelBackLabel(), 'Current_Conversation');
  const fromHome = make({ ShowAgentConfigPanel: true, AgentConfigExplicitOpen: true, NewConversationMode: true });
  assert.equal(fromHome.getPanelBackTarget(), 'home');
  assert.equal(fromHome.getPanelBackLabel(), 'New_Conversation');
  const fromList = make({ ShowAgentConfigPanel: true, AgentConfigExplicitOpen: true, AgentConfigReturnState: { showConversationPanel: true, newConversationMode: false } });
  assert.equal(fromList.getPanelBackTarget(), 'history');
  assert.equal(fromList.getPanelBackLabel(), 'Previous_Conversations');
  const noCodeFromList = make({ ShowAgentConfigPanel: true, AgentConfigExplicitOpen: true, AgentConfigReturnState: { showConversationPanel: true } }, { noCode: true });
  assert.equal(noCodeFromList.getPanelBackLabel(), 'forms:history', 'No Code names its list as C8Oforms does');
  assert.equal(make({ ShowConversationPanel: true }).getPanelBackTarget(), 'home');
  assert.equal(make({ ShowConversationPanel: true, Conversation: 'agent-1' }, { noCode: true }).getPanelBackTarget(), 'conversation', 'No Code list opened from a conversation');
});

test('settings shown because no agent is ready yet, the home and a conversation have no way back', () => {
  assert.equal(make({}, { forcedSettings: true }).getPanelBackTarget(), '', 'their continue button stays the way out');
  assert.equal(make({ ShowAgentConfigPanel: true }).getPanelBackTarget(), '', 'opened by the panel, not by the user');
  assert.equal(make({}).getPanelBackTarget(), '');
  assert.equal(make({ Conversation: 'agent-1' }).getPanelBackTarget(), '');
});

test('the way back closes the settings or the list', () => {
  const settings = make({ Conversation: 'agent-1', ShowAgentConfigPanel: true, AgentConfigExplicitOpen: true });
  settings.goBackFromPanelScreen();
  assert.deepEqual(settings.calls, ['closeSettings']);
  const list = make({ ShowConversationPanel: true });
  list.goBackFromPanelScreen();
  assert.deepEqual(list.calls, ['closeList']);
  const conversation = make({ Conversation: 'agent-1' });
  conversation.goBackFromPanelScreen();
  assert.deepEqual(conversation.calls, [], 'nothing to close');
});

test('the conversation is found again where it was read, or at its end', () => {
  const p = make({ Conversation: 'agent-1', LastScrollTop: 640 });
  p.rememberPanelScroll();
  assert.equal(p.local.PanelReturnScrollTop, 640);
  p.restorePanelScroll();
  assert.equal(p.local.PanelReturnScrollTop, null, 'used once');
  assert.equal(p.timers.length, 1);
  p.timers[0].fn();
  assert.deepEqual(p.calls, ['scrollTo:640']);
  const unknown = make({ Conversation: 'agent-1' });
  unknown.restorePanelScroll();
  unknown.timers[0].fn();
  assert.deepEqual(unknown.calls, ['scrollToBottom']);
  const home = make({ LastScrollTop: 300 });
  home.rememberPanelScroll();
  assert.equal(home.local.PanelReturnScrollTop, null, 'the home has nothing to find again');
  home.restorePanelScroll();
  assert.equal(home.timers.length, 0);
  const stillSettings = make({ Conversation: 'agent-1', ShowAgentConfigPanel: true, PanelReturnScrollTop: 50 });
  stillSettings.restorePanelScroll();
  assert.equal(stillSettings.timers.length, 0, 'settings that stay open keep their place');
});

test('opening the settings remembers the conversation, every closing finds it again', () => {
  const open = plain(page.slice(page.indexOf('\tpublic openAgentSettingsPage() {'), page.indexOf('\tpublic closeAgentSettingsPage() {')));
  assert.match(open, /if \(this\.local\.ShowAgentConfigPanel !== true\) \{\n\s+if \(this\.rememberPanelScroll\) \{ this\.rememberPanelScroll\(\); \}/);
  assert.doesNotMatch(open, /The settings show above the conversation/);
  const close = plain(page.slice(page.indexOf('\tpublic closeAgentSettingsPage() {'), page.indexOf('\tpublic toggleAgentSettingsPage() {')));
  assert.match(close, /this\.tick\(\);\n\s+if \(this\.restorePanelScroll\) \{ this\.restorePanelScroll\(\); \}\n\s+\}/);
  const list = plain(page.slice(page.indexOf('\tpublic closeConversationsPanel() {'), page.indexOf('public requestAgentQuota(')));
  assert.match(list, /ShowConversationPanel = false;\n\s+this\.tick\(\);\n\s+if \(this\.restorePanelScroll\) \{ this\.restorePanelScroll\(\); \}/);
});

test('the start card and the heading of a new conversation never show over a conversation', () => {
  const card = node('↓StartCard [', '↓CardContent [');
  assert.match(card, /script:\(this\.isPanelScreen && this\.isPanelScreen\('conversation'\)\) \? 'modern-card modern-cta-card agent-start-card agent-hidden' : \(/);
  const hero = node('↓Div [ngx.components.UIDynamicElement-1772014207161]', '↓IntroTitle [');
  assert.ok(!/MobileSmartSourceType: plain:agent-desktop-hero/.test(hero));
  const heroClass = node('↓Class [ngx.components.UIAttribute-1782121734063]', '↓HowCard [');
  assert.match(heroClass, /isPanelScreen\('history'\) \|\| this\.isPanelScreen\('conversation'\)\)\) \? 'agent-desktop-hero agent-hidden' : 'agent-desktop-hero'/);
});

test('the conversation, its side column, its dock and its scroll button are hidden on the settings and the list', () => {
  const off = "!(this.isPanelScreen && (this.isPanelScreen('settings') || this.isPanelScreen('history')))";
  const chat = node('↓ChatPreview [', '↓Messages [');
  assert.ok(chat.includes("(this.isPanelScreen && (this.isPanelScreen('settings') || this.isPanelScreen('history'))) ? 'modern-chat-preview agent-hidden' : 'modern-chat-preview'"));
  assert.ok(node('↓IfScrollBottomButton [', '↓ScrollBottomButton [').includes('(this.local && this.local.ShowScrollBottomButton === true) && ' + off));
  assert.ok(node('↓SideIf [', '↓Side [').includes('(this.getAgentRunView()) && ' + off));
  assert.ok(node('↓DockIf [', '↓Dock [').includes('(this.getAgentRunView()) && ' + off));
});

test('the input bar stays in the conversation and leaves the list, as it already leaves the settings', () => {
  const footer = plain(page.slice(page.indexOf('  ↓Class [ngx.components.UIAttribute-1782123550292]'), page.indexOf('  ↓FormsIntegrated [ngx.components.UIAttribute-1789119368528]')));
  assert.match(footer, /script:\(this\.isPanelScreen && this\.isPanelScreen\('history'\)\) \? 'modern-footer agent-footer-hidden' : \(\(local && local\.EnableChat !== false\)/);
  assert.match(footer, /shouldShowAgentSettingsPanel\(\)\)/, 'the settings still hide it');
});

test('the way back is the first thing of the settings and of the list, in every frame', () => {
  const center = node('↓Center [', '↓IntroTitle [');
  const bar = center.indexOf('↓ScreenBarIf [');
  assert.ok(bar > 0 && bar < center.indexOf('↓Div ['), 'before the heading');
  assert.match(center, /MobileSmartSourceType: script:this\.getPanelBackTarget && this\.getPanelBackTarget\(\)/);
  assert.match(center, /MobileSmartSourceType: plain:tigo-screen-bar/);
  assert.match(center, /MobileSmartSourceType: plain:tigo-screen-back/);
  assert.match(center, /"IconName": "plain:arrow-back-outline"/);
  assert.match(center, /attrName: '\[attr\.aria-label\]'[\s\S]*?script:this\.getPanelBackLabel\(\)/);
  assert.match(center, /page\.goBackFromPanelScreen\(\);/);
  const close = node('↓CloseButton [', '↓CreateSettings [');
  assert.match(close, /script:\(this\.getPanelBackTarget && this\.getPanelBackTarget\(\)\) \? 'agent-conversations-close agent-hidden' : \(/, 'one way back only');
  const style = page.slice(page.indexOf('↓TigoPanelScreensStyle ['));
  assert.match(style, /\.tigo-screen-bar \{\n\s+position: sticky;/);
  assert.match(style, /var\(--modern-bg/);
});

test('the way back names screens with the labels the panel already has, in its four languages', () => {
  const helpers = page.slice(page.indexOf('        public getPanelBackLabel() {'), page.indexOf('        public goBackFromPanelScreen() {'));
  for (const key of ['Previous_Conversations', 'Current_Conversation', 'New_Conversation']) {
    assert.ok(helpers.includes("this.t(\"" + key + "\""), key);
  }
  assert.ok(helpers.includes('this.getFormsHistoryText("history")'));
});
