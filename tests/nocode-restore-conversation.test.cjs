// No Code Studio (C8Oforms) keeps the Tigo panel open through a reload of its tab and says so with restoreConversation=1
// in the address of the panel: the conversation open at the reload opens again, as a click on Resume opens it (the
// subscriber AgentResumeConversation), and the page of No Code Studio stays as it is (a quiet resume, no form-updated).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, blockWith, pageClass } = require('./helpers/assistant-source.cjs');

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

// The panel in its frame: the address No Code Studio gave it, the storage of the tab, its timers and its clock.
function panel({ search = '?agentBridge=1&embedMode=c8oforms&restoreConversation=1', stored = 'agent-42', storageThrows = false } = {}) {
  const items = new Map(stored ? [['lib_ConvertigoAssistant.FormsOpenConversation', stored]] : []);
  const timeouts = [], intervals = new Map(), listeners = {};
  const clock = { now: 0 };
  const window = {
    location: { search, hash: '' },
    sessionStorage: {
      getItem: (key) => { if (storageThrows) throw new Error('SecurityError'); return items.has(key) ? items.get(key) : null; },
      setItem: (key, value) => { if (storageThrows) throw new Error('SecurityError'); items.set(key, String(value)); },
      removeItem: (key) => { if (storageThrows) throw new Error('SecurityError'); items.delete(key); }
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
      const due = timeouts.splice(0);
      due.forEach((run) => run());
    }
  };
  return { page, items, intervals, listeners, timeouts, advance, tickMemory: () => [...intervals.values()].forEach((run) => run()) };
}

test('the conversation open in the panel is the one of the tab, written at once and when the frame goes', () => {
  const { page, items, intervals, listeners, tickMemory } = panel({ stored: '' });
  page.restoreFormsConversationAfterReload();
  page.bindFormsConversationMemory();
  page.bindFormsConversationMemory();
  assert.equal(intervals.size, 1, 'bound once');
  page.local.Conversation = 'agent-7';
  tickMemory();
  assert.equal(items.get('lib_ConvertigoAssistant.FormsOpenConversation'), 'agent-7');
  page.local.NewConversationMode = true;
  listeners.pagehide();
  assert.equal(items.has('lib_ConvertigoAssistant.FormsOpenConversation'), false, 'a new conversation is no conversation to open again');
  page.local.NewConversationMode = false;
  page.local.Conversation = 'agent-8';
  page.unbindFormsConversationMemory();
  assert.equal(items.get('lib_ConvertigoAssistant.FormsOpenConversation'), 'agent-8', 'the last state is written when the page goes');
  assert.equal(intervals.size, 0);
  assert.equal(listeners.pagehide, undefined);
});

test('outside No Code Studio nothing is kept, and a tab whose storage is refused works as before', () => {
  const studio = panel({ search: '?agentBridge=1' });
  studio.page.bindFormsConversationMemory();
  assert.equal(studio.intervals.size, 0);
  studio.page.restoreFormsConversationAfterReload();
  assert.equal(studio.timeouts.length, 0);
  const refused = panel({ storageThrows: true });
  assert.doesNotThrow(() => refused.page.restoreFormsConversationAfterReload());
  assert.equal(refused.timeouts.length, 0);
  refused.page.bindFormsConversationMemory();
  refused.page.local.Conversation = 'agent-1';
  assert.doesNotThrow(() => refused.tickMemory());
});

test('only a panel No Code Studio opened again after a reload opens the conversation again', () => {
  const opened = panel({ search: '?agentBridge=1&embedMode=c8oforms' });
  opened.page.restoreFormsConversationAfterReload();
  assert.equal(opened.timeouts.length, 0, 'a panel the user opens shows its home');
  assert.equal(opened.page.formsConversationRestorePending, undefined);
});

test('after the reload the conversation opens again, quietly, once a click on Resume could open it', () => {
  const { page, items, advance, tickMemory } = panel();
  page.restoreFormsConversationAfterReload();
  page.bindFormsConversationMemory();
  assert.equal(page.formsConversationRestorePending, true);
  tickMemory();
  assert.equal(items.get('lib_ConvertigoAssistant.FormsOpenConversation'), 'agent-42', 'kept while it is still to open, a second reload opens it too');
  advance(1000);
  assert.deepEqual(page.published, [], 'the history is not loaded yet');
  const item = { conversationId: 'agent-42', title: 'Congés', provider: 'vibe', model: 'glm-5.1', nocodeContext: { formId: 'A' } };
  page.local.AgentConversations = [{ conversationId: 'agent-1' }, item];
  page.local.AgentConversationsLoading = false;
  page.local.AgentStartupDone = true;
  page.local.ShowAgentConfigPanel = true;
  advance(1000);
  assert.deepEqual(page.published, [], 'the settings of the agent come first');
  page.local.ShowAgentConfigPanel = false;
  page.local.AgentResumePending = true;
  advance(500);
  assert.deepEqual(page.published, [], 'a resume running');
  page.local.AgentResumePending = false;
  advance(250);
  assert.deepEqual(page.published, [], 'ready once: the start of the page may still change it');
  advance(250);
  assert.deepEqual(page.published, [['AgentResumeConversation', { scope: { conversation: item }, quiet: true }]]);
  assert.equal(page.formsConversationRestorePending, false);
  advance(2000);
  assert.equal(page.published.length, 1, 'once');
});

test('a conversation opened meanwhile, or one gone from the history, is left alone', () => {
  const clicked = panel();
  clicked.page.restoreFormsConversationAfterReload();
  clicked.page.local.AgentConversations = [{ conversationId: 'agent-42' }];
  clicked.page.local.Conversation = 'agent-1';
  clicked.page.local.AgentConversationsLoading = false;
  clicked.advance(2000);
  assert.deepEqual(clicked.page.published, []);
  assert.equal(clicked.page.formsConversationRestorePending, false);
  assert.equal(clicked.timeouts.length, 0);
  const gone = panel();
  gone.page.restoreFormsConversationAfterReload();
  gone.page.local.AgentConversations = [{ conversationId: 'agent-1' }];
  gone.page.local.AgentConversationsLoading = false;
  gone.page.local.AgentStartupDone = true;
  gone.advance(59750);
  assert.equal(gone.page.formsConversationRestorePending, true);
  gone.advance(500);
  assert.equal(gone.page.formsConversationRestorePending, false);
  assert.deepEqual(gone.page.published, []);
});

test('Resume publishes its conversation, the subscriber opens it with the same chain', () => {
  const resumeButton = pageYaml.slice(pageYaml.indexOf('↓ResumeButton [ngx.components.UIDynamicElement-1781608119127]'), pageYaml.indexOf('↓DeleteButton [ngx.components.UIDynamicElement-1781608122143]'));
  assert.match(resumeButton, /↓PublishResume \[ngx\.components\.UIDynamicAction-1793035709996\]: \n\s+beanData: \|\n\s+'\{\n\s+"ionBean": "PublishEventAction",\n\s+"topic": "plain:AgentResumeConversation",\n\s+"data": "script:\{scope: \{conversation: scope\.conversation\}\}"/);
  assert.doesNotMatch(resumeButton, /lib_ConvertigoAssistant\.AgentResumeConversation|CallSequenceAction/, 'the click no longer calls the sequence itself');
  const subscriber = pageYaml.slice(pageYaml.indexOf('↓AgentResumeConversation [ngx.components.UIEventSubscriber-1793035709997]: '));
  assert.match(subscriber, /^↓AgentResumeConversation \[ngx\.components\.UIEventSubscriber-1793035709997\]: \n  comment: [^\n]+\n  topic: AgentResumeConversation\n  ↓SetResumeQuiet \[/);
  const chain = subscriber.slice(subscriber.indexOf('  ↓ResumeConversation [ngx.components.UIDynamicAction-1781608120627]: '), subscriber.indexOf('\n↓', 1));
  for (const step of ['ResumeConversation', 'SetConversation', 'SetConversations', 'SetConversationResumed', 'LoadHistoryMessages', 'PollActiveConversation', 'SetConversationProject']) {
    assert.match(chain, new RegExp('↓' + step + ' \\['), step);
  }
  assert.match(chain, /"requestable": "plain:lib_ConvertigoAssistant\.AgentResumeConversation"/);
  assert.match(chain, /MobileSmartSourceType: 'script:scope\.conversation && scope\.conversation\.conversationId \? scope\.conversation\.conversationId : '''''/);
  // the data of the event is the scope of its subscriber (data.scope), so scope.conversation is the conversation published
  const quiet = /"Value": "script:([^\n]+)"\n\s+\}'\n\s+comment: ApplyNoCodeAssistantCatalog/.exec(subscriber)[1].replace(/''/g, "'");
  const evaluate = (data) => vm.runInNewContext(quiet, { stack: { root: { scope: data.scope || {}, out: data } }, scope: data.scope || {} });
  assert.equal(evaluate({ scope: { conversation: { conversationId: 'agent-42' } }, quiet: true }), 'agent-42');
  assert.equal(evaluate({ scope: { conversation: { conversationId: 'agent-42' } } }), '', 'a click resumes as before');
  assert.match(pageYaml, /this\.startAgentElapsedTicker\(\);\n\s+this\.restoreFormsConversationAfterReload\(\);\n\s+this\.bindFormsConversationMemory\(\);\n\s+\/\*End_c8o_PageInitialization\*\//);
  assert.match(pageYaml, /this\.stopAgentElapsedTicker\(\);\n\s+this\.unbindFormsConversationMemory\(\);\n\s+\/\*End_c8o_PageFinalization\*\//);
});

test('a quiet resume selects its form in the panel and sends No Code Studio nothing; a click still focuses it', async () => {
  const body = blockWith('_c8oProject/mobileSharedActions/ApplyNoCodeAssistantCatalog.yaml', 'var catalog = unwrap(vars.response);');
  const Probe = run('class Probe { invoke(page, props, vars, event) { return new Promise((resolve, reject) => { ' + body + ' }); } } this.Probe = Probe;').Probe;
  const apply = (p, vars) => new Probe().invoke(p, {}, vars, {});
  const make = (quiet) => {
    const notifications = [];
    const p = {
      local: { Conversation: 'agent-42', FormsResumePending: true, FormsResumeQuietConversation: quiet, FormsConversationContext: { formId: 'A' }, AgentHostContext: { formId: 'B' } },
      isEmbeddedInC8Oforms: () => true, tick: () => {},
      getFormsCatalogContext: (host) => p.local.FormsResumePending ? p.local.FormsConversationContext : host,
      notifyC8OformsFormUpdated: (...args) => notifications.push(args)
    };
    return { p, notifications };
  };
  const response = { requestedFormId: 'A', selectedForm: { id: 'A', name: 'Congés' }, forms: [], pages: [], elements: [] };
  const quiet = make('agent-42');
  await apply(quiet.p, { response, hostContext: { formId: 'A' }, formId: 'A' });
  assert.equal(quiet.notifications.length, 0, 'the page of No Code Studio stays as it is');
  assert.equal(quiet.p.local.NoCodeSelectedFormId, 'A', 'the panel shows the form of its conversation');
  assert.equal(quiet.p.local.FormsResumePending, false);
  assert.equal(quiet.p.local.FormsResumeQuietConversation, '', 'used once');
  for (const flag of ['', 'agent-1', undefined]) {
    const clicked = make(flag);
    await apply(clicked.p, { response, hostContext: { formId: 'A' }, formId: 'A' });
    assert.equal(clicked.notifications.length, 1, String(flag));
    assert.equal(clicked.notifications[0][0].changed, false);
  }
});
