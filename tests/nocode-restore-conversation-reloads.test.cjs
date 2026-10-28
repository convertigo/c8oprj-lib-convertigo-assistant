// No Code Studio (C8Oforms) reloaded several times in a row with the Tigo panel open: each reload opens again the
// conversation the panel showed (restoreConversation=1), whether the previous one was opened by a click on Resume or by
// the quiet resume of the previous reload. Seen on test-nocode (27/10): the start of the page (AgentCreateConversationRouter,
// ~18 s there) answered after the quiet resume and emptied local.Conversation, the memory then removed the conversation of
// the tab and the next reload opened the home; and once the frame ended on How-To, its query lost.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, blockWith, pageClass } = require('./helpers/assistant-source.cjs');

const KEY = 'lib_ConvertigoAssistant.FormsOpenConversation';
const pageYaml = read('_c8oProject/mobilePages/Page.yaml');
const run = (source, context = {}) => {
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context;
};
const NAMES = ['bindFormsConversationMemory', 'unbindFormsConversationMemory', 'rememberFormsConversation', 'restoreFormsConversationAfterReload',
  'getAssistantUrlSearch', 'getAssistantQueryParam', 'normalizeAgentHostContextValue', 'isEmbeddedInC8Oforms'];
function pageMethods() {
  const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true), selected = [];
  (function visit(n) {
    if (ts.isMethodDeclaration(n) && NAMES.includes(n.name.getText(ast))) selected.push(n.getText(ast));
    ts.forEachChild(n, visit);
  })(ast);
  assert.equal(selected.length, NAMES.length);
  return 'class Page { ' + selected.join('\n') + ' } this.Page = Page;';
}
const source = pageMethods();
const ITEM = { conversationId: 'agent-42', title: 'Congés', nocodeContext: { formId: 'A' } };

// The panel after a reload of No Code Studio: the address it was given, the storage of the tab, its timers and its clock.
function panel({ search = '?agentBridge=1&embedMode=c8oforms&restoreConversation=1', stored = 'agent-42' } = {}) {
  const items = new Map(stored ? [[KEY, stored]] : []);
  const timeouts = [], intervals = new Map(), listeners = {};
  const clock = { now: 0 };
  const window = {
    location: { search, hash: '' },
    sessionStorage: {
      getItem: (key) => items.has(key) ? items.get(key) : null,
      setItem: (key, value) => { items.set(key, String(value)); },
      removeItem: (key) => { items.delete(key); }
    },
    addEventListener: (name, run) => { listeners[name] = run; },
    removeEventListener: (name) => { delete listeners[name]; }
  };
  let nextInterval = 1;
  const context = run(source, {
    window, URLSearchParams, String, Array, Date: { now: () => clock.now },
    setTimeout: (run) => { timeouts.push(run); return timeouts.length; },
    setInterval: (run) => { intervals.set(nextInterval, run); return nextInterval++; },
    clearInterval: (id) => { intervals.delete(id); }
  });
  const page = new context.Page();
  page.local = { AgentConversationsLoading: true, AgentConversations: [] };
  page.getAssistantHostContextParam = () => '';
  page.shouldShowAgentSettingsPanel = () => false;
  page.published = [];
  page.events = { publish: (topic, data) => page.published.push([topic, JSON.parse(JSON.stringify(data))]) };
  const advance = (ms) => {
    for (let t = 0; t < ms; t += 250) {
      clock.now += 250;
      timeouts.splice(0).forEach((run) => run());
    }
  };
  const start = () => { page.restoreFormsConversationAfterReload(); page.bindFormsConversationMemory(); };
  return { page, items, listeners, advance, start, tickMemory: () => [...intervals.values()].forEach((run) => run()) };
}

test('the quiet resume waits for the start of the page, whose answer would replace the conversation it opens', () => {
  const { page, advance, start } = panel();
  start();
  // the history comes first (RefreshAgentConversationsAfterContext), the start of the page answers later
  page.local.AgentConversations = [ITEM];
  page.local.AgentConversationsLoading = false;
  advance(20000);
  assert.deepEqual(page.published, [], 'AgentCreateConversationRouter has not answered yet');
  assert.equal(page.formsConversationRestorePending, true);
  page.local.AgentStartupDone = true;
  advance(500);
  assert.deepEqual(page.published, [['AgentResumeConversation', { scope: { conversation: ITEM }, quiet: true }]]);
  // the answer of the start of the page says so, once its conversation and its history are set
  const event = pageYaml.slice(pageYaml.indexOf('↓PageEvent [ngx.components.UIPageEvent-1744269061199]'), pageYaml.indexOf('↓RefreshFooterLocale [ngx.components.UICustomAction-1772036531069]'));
  const answer = event.slice(event.indexOf('"requestable": "plain:lib_ConvertigoAssistant.AgentCreateConversationRouter"'));
  assert.match(answer, /↓SetConversationsLoaded \[ngx\.components\.UICustomAction-1782748061156\]: [\s\S]*?page\.local\.AgentConversationsLoading = false;\n(?:\s*\/\/[^\n]*\n)?\s+page\.local\.AgentStartupDone = true;/);
});

test('the conversation of the tab stays while nothing else is open in the panel', () => {
  const { page, items, listeners, advance, start, tickMemory } = panel();
  start();
  page.local.AgentConversations = [ITEM];
  page.local.AgentConversationsLoading = false;
  page.local.AgentStartupDone = true;
  advance(500);
  assert.equal(page.published.length, 1);
  tickMemory();
  assert.equal(items.get(KEY), 'agent-42', 'the resume is under way, no conversation yet');
  listeners.pagehide();
  assert.equal(items.get(KEY), 'agent-42', 'No Code Studio replaces the frame during the resume');
  page.local.Conversation = 'agent-42';
  page.local.NewConversationMode = false;
  tickMemory();
  page.local.Conversation = '';
  tickMemory();
  assert.equal(items.get(KEY), 'agent-42', 'an empty panel is no choice of the user');
  page.local.Conversation = 'agent-9';
  tickMemory();
  assert.equal(items.get(KEY), 'agent-9', 'a conversation opened by the user');
  page.local.Conversation = '';
  page.local.NewConversationMode = true;
  tickMemory();
  assert.equal(items.has(KEY), false, 'a new conversation started by the user');
});

test('a restore the page could not do in time is left to the next reload; a conversation gone from the history is forgotten', () => {
  const slow = panel();
  slow.start();
  slow.advance(59750);
  assert.equal(slow.page.formsConversationRestorePending, true, 'the start of the page may take long on a busy server');
  slow.advance(500);
  assert.equal(slow.page.formsConversationRestorePending, false);
  slow.tickMemory();
  assert.deepEqual(slow.page.published, []);
  assert.equal(slow.items.get(KEY), 'agent-42', 'the next reload opens it again');
  const gone = panel();
  gone.start();
  gone.page.local.AgentConversations = [{ conversationId: 'agent-1' }];
  gone.page.local.AgentConversationsLoading = false;
  gone.page.local.AgentStartupDone = true;
  gone.advance(60250);
  gone.tickMemory();
  assert.equal(gone.page.formsConversationRestorePending, false);
  assert.deepEqual(gone.page.published, []);
  assert.equal(gone.items.has(KEY), false, 'deleted meanwhile: nothing to open again');
});

test('a panel the user opens shows its home and forgets the conversation of an earlier panel', () => {
  const { page, items, start, tickMemory } = panel({ search: '?agentBridge=1&embedMode=c8oforms' });
  start();
  assert.equal(page.formsConversationRestorePending, undefined);
  assert.equal(items.has(KEY), false, 'closed then opened again: a reload opens its home too');
  page.local.Conversation = 'agent-9';
  tickMemory();
  assert.equal(items.get(KEY), 'agent-9');
});

test('a new conversation started during the wait is left alone', () => {
  const { page, items, advance, start, tickMemory } = panel();
  start();
  page.local.NewConversationMode = true;
  page.local.AgentConversations = [ITEM];
  page.local.AgentConversationsLoading = false;
  page.local.AgentStartupDone = true;
  advance(1000);
  assert.deepEqual(page.published, []);
  assert.equal(page.formsConversationRestorePending, false);
  tickMemory();
  assert.equal(items.has(KEY), false);
});

test('the panel of No Code Studio opens the agent at once, its address kept, without waiting for the release switch', () => {
  const script = blockWith('_c8oProject/mobilePages/Agent.yaml', '/*Begin_c8o_PageInitialization*/');
  const code = script.split('/*Begin_c8o_PageInitialization*/')[1].split('/*End_c8o_PageInitialization*/')[0];
  const timers = [];
  const open = (search) => {
    const ctx = run('this.initialize = function() {' + code + '}', { URLSearchParams, window: { location: { search } }, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
    // a cold opening on a busy server: the app onAppInit event, which defines the switch, comes after this page starts
    const page = { global: {}, angularRouter: { navigate: (...args) => page.calls.push(args) }, calls: [] };
    ctx.initialize.call(page);
    return page;
  };
  const forms = open('?agentBridge=1&assistantMode=agent&embedMode=c8oforms&assistantSurface=nocode&assistantContext=nocode&userId=forms-user&restoreConversation=1');
  assert.equal(timers.length, 0, 'no wait: the switch always opens the agent for the No Code surface');
  assert.equal(forms.calls.length, 1);
  assert.deepEqual([...forms.calls[0][0]], ['/path-to-xfirst', ':threadid']);
  assert.equal(forms.calls[0][1].queryParams.restoreConversation, '1');
  assert.equal(forms.calls[0][1].queryParams.assistantSurface, 'nocode');
  assert.equal(forms.calls[0][1].queryParams.userId, 'forms-user');
  const studio = open('?agentBridge=1&assistantMode=agent');
  assert.equal(studio.calls.length, 0, 'the Studio still waits for the switch');
  assert.equal(timers.length, 1);
});
