// "Start now" (with the project or without one) only sets what the first message will do: the start card says it at
// once, so the click is seen. node --test tests/assistant_start_choice.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');

function copyClass() {
  const start = page.indexOf('        \tpublic getStartCardCopy() {');
  const end = page.indexOf('        \tgetNoProjectSelectedMessage() {');
  assert.ok(start > 0 && end > start);
  const js = ts.transpileModule('class P {\n' + page.slice(start, end) + '\n cleanProjectName(v) { return ("" + (v == null ? "" : v)).trim(); }\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  return vm.runInNewContext(js + '\nP;', {});
}

function make(local) {
  const P = copyClass();
  const p = new P();
  p.local = { Conversation: '', ...local };
  p.isAgentBridgeMode = () => true;
  p.isEmbeddedNoCodeAgent = () => false;
  p.shouldShowAgentSettingsPanel = () => false;
  p.isAgentEnvironmentCheckPending = () => false;
  p.shouldBlockRemoteStudioAgent = () => false;
  p.getFormsUxText = () => '';
  p.getC8OformsText = () => '';
  p.t = (key, fallback) => ({
    Agent_Start_Choice_Project: 'on {project}', Agent_Start_Choice_None: 'without a project', New_Conversation_Copy: 'send a first message'
  }[key] || fallback);
  return p;
}

test('once a start choice is clicked, the card says what the first message will do', () => {
  assert.equal(make({ ConversationProjectMode: 'project', CurrentStudioProject: 'crm' }).getStartCardCopy(), 'send a first message', 'nothing chosen yet');
  assert.equal(make({ StartChoiceConfirmed: true, ConversationProjectMode: 'project', ConversationProject: 'crm' }).getStartCardCopy(), 'on crm');
  assert.equal(make({ StartChoiceConfirmed: true, ConversationProjectMode: 'none', CurrentStudioProject: 'crm' }).getStartCardCopy(), 'without a project');
  assert.equal(make({ StartChoiceConfirmed: true, ConversationProjectMode: '', CurrentStudioProject: '' }).getStartCardCopy(), 'without a project', 'no project known');
  assert.notEqual(make({ StartChoiceConfirmed: true, Conversation: 'agent-1', ConversationProjectMode: 'none' }).getStartCardCopy(), 'without a project', 'a conversation is open');
  const noCode = make({ StartChoiceConfirmed: true, ConversationProjectMode: 'none' });
  noCode.isEmbeddedNoCodeAgent = () => true;
  assert.notEqual(noCode.getStartCardCopy(), 'without a project', 'No Code keeps its own copy');
});

test('both choices confirm, the home button starts over, in en, fr, it and es', () => {
  assert.match(page, /page\.local\.ConversationProjectMode = "project";\n\s+page\.local\.StartChoiceConfirmed = true;/);
  assert.match(page, /page\.local\.ConversationProjectMode = 'none';\n\s+page\.local\.StartChoiceConfirmed = true;/);
  assert.match(page, /page\.local\.ConversationProjectMode = "";\n\s+\}\n\s+page\.local\.StartChoiceConfirmed = false;/);
  assert.equal((page.match(/Agent_Start_Choice_Project: "[^"\n]*\{project\}[^"\n]*"/g) || []).length, 4);
  assert.equal((page.match(/Agent_Start_Choice_None: "[^"\n]+"/g) || []).length, 4);
});

test('one start choice is highlighted at a time: "Start now" only without a project, or once chosen', () => {
  assert.match(page, /agent-free-choice'' \+ \(\(this\.shouldShowAgentActivationChoice && this\.shouldShowAgentActivationChoice\(\)\) \? '' agent-choice-selected'' : \(\(this\.local\.ConversationProjectMode === ''none'' \|\| !\(\(this\.local && this\.local\.CurrentStudioProject\) \|\| \(this\.global && this\.global\.projectName\) \|\| ''''\)\) \? '' agent-choice-selected''/);
  // the project choice: a known project, not "none"
  assert.match(page, /\(\(this\.local && this\.local\.CurrentStudioProject\) \|\| \(this\.global && this\.global\.projectName\) \|\| ''''\) && this\.local\.ConversationProjectMode !== ''none''/);
});

test('the Studio web theme highlights the chosen start choice, never the project one by default', () => {
  const app = read('_c8oProject/mobileNgxApp.yaml');
  assert.match(app, /html\.tigo-studio-web \.agent-start-choice\.agent-choice-selected\.agent-session-strip,\n\s+html\.tigo-studio-web \.agent-start-choice\.agent-choice-selected\.agent-session-strip:hover \{\n\s+background: var\(--tsw-selection\) !important;/);
  assert.doesNotMatch(app, /html\.tigo-studio-web \.agent-project-choice\.agent-session-strip \{/);
});

test('the project the web Studio selects reaches the page through its context too (a page opened after a stack install)', () => {
  const start = page.indexOf('        \t// The web Studio sends the project selected in its tree with its context too');
  const end = page.indexOf('        \tpublic hasAgentSettingsProvidersLoaded() {');
  assert.ok(start > 0 && end > start);
  const js = ts.transpileModule('class P {\n' + page.slice(start, end) + '\n cleanProjectName(v) { return ("" + (v == null ? "" : v)).trim(); }\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  const P = vm.runInNewContext(js + '\nP;', {});
  const make = (global = {}, local = {}) => { const p = new P(); p.global = global; p.local = local; p.published = []; p.events = { publish: (t) => p.published.push(t) }; p.isEmbeddedInC8Oforms = () => false; return p; };
  const web = { assistantSurface: 'studio', projectScope: 'selected', defaultProject: 'lib_ConvertigoAgentBridge' };
  const p = make();
  p.applyHostSelectedProject(web);
  assert.equal(p.global.projectName, 'lib_ConvertigoAgentBridge');
  assert.deepEqual(p.published, ['JavaMessage'], 'as a selection');
  const same = make({ projectName: 'lib_ConvertigoAgentBridge' }, { CurrentStudioProject: 'lib_ConvertigoAgentBridge' });
  same.applyHostSelectedProject(web);
  assert.deepEqual(same.published, [], 'already applied');
  const eclipse = make();
  eclipse.applyHostSelectedProject({ assistantSurface: 'studio', defaultProject: 'X' });
  assert.equal(eclipse.global.projectName, undefined, 'the Eclipse Studio sends no projectScope: unchanged');
  const forms = make();
  forms.isEmbeddedInC8Oforms = () => true;
  forms.applyHostSelectedProject(web);
  assert.equal(forms.global.projectName, undefined, 'C8Oforms: unchanged');
  assert.match(page, /this\.applyHostSelectedProject\(next\);\n\s+this\.scheduleAgentSettingsRefreshAfterHostContext\(\);/);
});
