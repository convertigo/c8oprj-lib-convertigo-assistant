// The "Suggestions rapides" row of the Tigo panel (favorite prompts above the composer) stayed under a running and a
// finished conversation (test-nocode, 29/10). It folds once the conversation starts, at the latest with the first
// message the user sends, and comes back for a new or empty conversation; the "Prompts" toggle of the composer opens it
// in between.
// node --test tests/assistant_hide_suggestions.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, blockWith } = require('./helpers/assistant-source.cjs');

const footerPath = '_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml';
const footerYaml = read(footerPath);
const pageYaml = read('_c8oProject/mobilePages/Page.yaml');
const footerScript = blockWith(footerPath, '/*Begin_c8o_CompImport*/');

function subject(source, names, sandbox = {}) {
  const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const members = ast.statements.find(ts.isClassDeclaration).members.filter((m) => m.name && names.includes(m.name.getText(ast)));
  assert.deepEqual(members.map((m) => m.name.getText(ast)).sort(), [...names].sort());
  vm.runInNewContext(ts.transpileModule('class Subject { ' + members.map((m) => m.getText(ast)).join('\n') + ' }; this.Subject = Subject;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
  return new sandbox.Subject();
}

// The row's [hidden] binding, as the template evaluates it on the footer.
const hiddenSource = /  ↓Hidden \[ngx\.components\.UIAttribute-1782760048334\]: \n    attrName: '\[hidden\]'\n    attrValue: \n      - xmlizable: \n        - ↑classname: \S+\n        - MobileSmartSourceType: '(script:[^\n]+)'\n/.exec(footerYaml);
assert.ok(hiddenSource, 'the [hidden] attribute of SuggestionsToolBar');
const rowHiddenExpression = hiddenSource[1].replace(/''/g, "'").slice('script:'.length);
const rowHidden = (footer) => new Function('return ' + rowHiddenExpression).call(footer);

function footer(started) {
  const f = subject('class Footer {' + footerScript.slice(footerScript.indexOf('/*Begin_c8o_CompFunction*/')) + '}',
    ['syncPromptsWithConversation', 'toggleResourceTab', 'submitQuestionFromUI']);
  const sent = [];
  let text = '';
  // Declaration defaults of the component, then its inputs as the page binds them in agent mode.
  Object.assign(f, {
    resourceTab: 'prompts', conversationStartedSeen: false, EnableResources: true, EnableChat: true, IsProcessing: false,
    ConversationStarted: started, Suggestions: [{ label: 'Créer une application', question: 'Je souhaite créer une application pour ' }],
    tick() {}, owner: { runLocalCommand: () => false },
    getQuestionText: () => text, setQuestionText: (value) => { text = value; }, type: (value) => { text = value; },
    getImageFiles: () => [], getAttachFiles: () => [], RunQuestion: { emit: (payload) => sent.push(payload.question) },
    getSuggestions() { return this.Suggestions; }
  });
  // ngOnChanges runs once with the first input values.
  f.syncPromptsWithConversation();
  return { f, sent };
}

// What the page passes as ConversationStarted after each change of the input (ngOnChanges).
function setStarted(f, started) {
  f.ConversationStarted = started;
  f.syncPromptsWithConversation();
}

test('the row shows for a new conversation and folds when the first message is sent', () => {
  const { f, sent } = footer(false);
  assert.equal(f.resourceTab, 'prompts');
  assert.equal(rowHidden(f), false);
  f.type('Je souhaite créer une application pour suivre mes stocks');
  f.submitQuestionFromUI(null);
  assert.deepEqual(sent, ['Je souhaite créer une application pour suivre mes stocks']);
  setStarted(f, true);
  assert.equal(f.resourceTab, '');
  assert.equal(rowHidden(f), true, 'hidden while the turn runs');
  f.syncPromptsWithConversation();
  assert.equal(rowHidden(f), true, 'and once it is finished');
});

test('the "Prompts" toggle opens the row again during a conversation; it folds again with the next message', () => {
  const { f, sent } = footer(false);
  setStarted(f, true);
  f.toggleResourceTab('prompts');
  assert.equal(rowHidden(f), false);
  f.syncPromptsWithConversation();
  assert.equal(rowHidden(f), false, 'another change of the inputs does not fold it again');
  f.type('Ajoute un champ date');
  f.submitQuestionFromUI(null);
  assert.deepEqual(sent, ['Ajoute un champ date']);
  assert.equal(f.resourceTab, '');
  assert.equal(rowHidden(f), true);
});

test('a new or emptied conversation shows the row again', () => {
  const { f } = footer(false);
  setStarted(f, true);
  setStarted(f, false);
  assert.equal(f.resourceTab, 'prompts');
  assert.equal(rowHidden(f), false);
});

test('a panel opened on a conversation that has messages starts with the row folded', () => {
  const { f } = footer(true);
  assert.equal(f.resourceTab, '');
  assert.equal(rowHidden(f), true);
});

test('the skills or MCP row the user opened is left alone', () => {
  const { f } = footer(false);
  f.toggleResourceTab('skills');
  setStarted(f, true);
  assert.equal(f.resourceTab, 'skills');
  setStarted(f, false);
  assert.equal(f.resourceTab, 'skills');
});

test('a message sent while the conversation is still empty keeps the row until the page shows it', () => {
  // The page may refuse the message (agent not ready, local command): the row stays for the empty conversation.
  const { f, sent } = footer(false);
  f.type('Bonjour');
  f.submitQuestionFromUI(null);
  assert.deepEqual(sent, ['Bonjour']);
  assert.equal(f.resourceTab, 'prompts');
});

test('the page starts the conversation with the first message the user sent, not with a setup or diagnostic message', () => {
  const page = subject(pageClass(), ['hasConversationStarted']);
  page.local = undefined;
  assert.equal(page.hasConversationStarted(), false);
  page.local = { Messages: [] };
  assert.equal(page.hasConversationStarted(), false, 'new conversation');
  page.local.Messages.push({ id: '__agent_setup__', type: 'assistant', msg: 'Vérification de Vibe', writing: true });
  page.local.Messages.push({ type: 'assistant', msg: 'Diagnostic', tag1: 'Diagnostic' });
  assert.equal(page.hasConversationStarted(), false);
  page.local.Messages.push({ type: 'user', msg: 'Crée une application de suivi', author: 'You' }, { type: 'assistant', msg: '', writing: true });
  assert.equal(page.hasConversationStarted(), true, 'from the send, before the agent answers');
  page.local.Messages = [{ type: 'image', file: { name: 'maquette.png' } }];
  assert.equal(page.hasConversationStarted(), true, 'an image the user sent');
  page.local.Messages = [];
  assert.equal(page.hasConversationStarted(), false, 'emptied for a new conversation');
});

test('the footer and the page are wired: input, ngOnChanges and binding', () => {
  assert.match(footerYaml, /↓ConversationStarted \[ngx\.components\.UICompVariable-1793300000101\]: \n  comment: [^\n]+\n  value: false\n/);
  assert.match(footerScript, /\/\*Begin_c8o_CompChanges\*\/\n\t\tthis\.syncPromptsWithConversation\(\);\n\t\t\/\*End_c8o_CompChanges\*\//);
  assert.match(footerScript, /\tconversationStartedSeen = false;\n/);
  assert.match(pageYaml, /    ↓ConversationStarted \[ngx\.components\.UIUseVariable-1793300000102\]: \n      varValue: \n        - xmlizable: \n          - ↑classname: com\.twinsoft\.convertigo\.beans\.ngx\.components\.MobileSmartSourceType\n          - MobileSmartSourceType: script:this\.hasConversationStarted\(\)\n/);
  // One footer instance in the page: the Studio panel and the No Code panel share it.
  assert.equal(pageYaml.split('sharedcomponent: lib_ConvertigoAssistant.Application.NgxApp.LightRagFooterComponent').length - 1, 1);
  assert.equal(pageYaml.split('script:this.hasConversationStarted()').length - 1, 1);
});
