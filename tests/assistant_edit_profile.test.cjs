// The edit profile of a Studio conversation, for the A/B of the surfaces an agent changes a project with: "/profil yaml"
// (the project's YAML files, no MCP edit tool), "/profil html" (the generated NGX files, imported back), "/profil mcp"
// (the default). The page sends the asked profile with the next messages until the server has it; the server keeps it in
// the conversation record, passes it to the Bridge at each Vibe start and says it in the turn's prompt. The Bridge and
// the MCP apply it (lib_ConvertigoAgentBridge tests/edit_profile.test.js, lib_ConvertigoMCP
// tests/scripts/validate_edit_profile.cjs). Without a profile nothing changes.
// node --test tests/assistant_edit_profile.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const root = path.resolve(__dirname, '..');
const javaProxy = new Proxy(function () {}, {
  get(_target, property) { return property === Symbol.toPrimitive ? () => '' : javaProxy; },
  apply() { return javaProxy; },
  construct() { return javaProxy; }
});

function serverApi() {
  const sandbox = { Packages: javaProxy, context: javaProxy, request: javaProxy, log: javaProxy, C8O: {}, java: javaProxy };
  let source = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  source = source.replace(/\}\(\)\);\s*$/, 'C8O.assistantAgentBridge._editProfileTest = { normalizeEditProfile, editProfileApplies, agentStartPayload, buildSequencePrompt, EDIT_PROFILE_PROMPT_LINES };}());');
  vm.runInNewContext(source, sandbox, { filename: 'agent_bridge_client.js' });
  return sandbox.C8O.assistantAgentBridge._editProfileTest;
}

const api = serverApi();
const studioState = (extra) => Object.assign({ threadid: 'agent-1', handle: 'agent-1', provider: 'vibe', userId: 'studio', skillProfile: 'generalist', agentProfile: 'generalist', primaryProject: 'SalesPipeline', mcpEndpoint: 'http://localhost/convertigo/api/mcp' }, extra || {});

test('a profile is yaml or html; anything else is the default', () => {
  assert.equal(api.normalizeEditProfile('yaml'), 'yaml');
  assert.equal(api.normalizeEditProfile(' HTML '), 'html');
  for (const value of ['mcp', '', null, undefined, 'files', 'nocode']) {
    assert.equal(api.normalizeEditProfile(value), '', String(value));
  }
});

test('the profile applies to a Studio conversation run by Vibe only', () => {
  assert.equal(api.editProfileApplies(studioState(), { userId: 'studio' }), true);
  assert.equal(api.editProfileApplies(studioState({ provider: 'convertigo' }), { userId: 'studio' }), true, 'Tigo on the gateway runs Vibe');
  assert.equal(api.editProfileApplies(studioState({ provider: 'codex' }), { userId: 'studio' }), false);
  assert.equal(api.editProfileApplies(studioState({ provider: 'claude' }), { userId: 'studio' }), false);
  assert.equal(api.editProfileApplies(studioState({ userId: 'person@example.invalid', skillProfile: 'nocode', agentProfile: 'nocode' }), { userId: 'person@example.invalid' }), false);
});

test('the Vibe start passes the conversation profile to the Bridge, "" by default', () => {
  const options = { userId: 'studio' };
  assert.equal(api.agentStartPayload(studioState({ editProfile: 'yaml' }), options, 'vibe', false).editProfile, 'yaml');
  assert.equal(api.agentStartPayload(studioState({ editProfile: 'html' }), options, 'vibe', false).editProfile, 'html');
  assert.equal(api.agentStartPayload(studioState(), options, 'vibe', false).editProfile, '');
  assert.equal(api.agentStartPayload(studioState({ editProfile: 'nonsense' }), options, 'vibe', false).editProfile, '');
});

test('the turn prompt says the profile; the default prompt is unchanged', () => {
  const base = { rawUserQuestion: 'x', userId: 'studio', provider: 'vibe', threadid: 'agent-1', targetProject: 'SalesPipeline' };
  const plain = api.buildSequencePrompt('Add a sequence', base);
  assert.doesNotMatch(plain, /Edit profile of this conversation/);
  assert.equal(api.buildSequencePrompt('Add a sequence', Object.assign({}, base, { editProfile: '' })), plain);
  const yaml = api.buildSequencePrompt('Add a sequence', Object.assign({}, base, { editProfile: 'yaml' }));
  assert.ok(yaml.indexOf(api.EDIT_PROFILE_PROMPT_LINES.yaml) >= 0);
  assert.match(api.EDIT_PROFILE_PROMPT_LINES.yaml, /convertigo:\/\/resources\/convertigo-yaml-editing/);
  const html = api.buildSequencePrompt('Show the city', Object.assign({}, base, { editProfile: 'html' }));
  assert.ok(html.indexOf(api.EDIT_PROFILE_PROMPT_LINES.html) >= 0);
  assert.match(api.EDIT_PROFILE_PROMPT_LINES.html, /fromIonic:true/);
  // the prompt with a profile is the default one plus its line
  assert.equal(yaml.replace('\n' + api.EDIT_PROFILE_PROMPT_LINES.yaml, ''), plain);
  // never in No Code
  const noCode = api.buildSequencePrompt('x', { rawUserQuestion: 'x', userId: 'person@example.invalid', provider: 'vibe', editProfile: 'yaml' });
  assert.doesNotMatch(noCode, /Edit profile of this conversation/);
});

test('the conversation keeps its profile: state, record, public views, send and scope', () => {
  const source = read('js/agent_bridge_client.js');
  assert.match(source, /editProfile: normalizeEditProfile\(record && record\.editProfile\),/);
  assert.match(source, /state\.editProfile = normalizeEditProfile\(state\.editProfile\);/);
  assert.match(source, /editProfile: normalizeEditProfile\(record\.editProfile\),/);
  assert.equal((source.match(/editProfile: normalizeEditProfile\(state\.editProfile\),/g) || []).length, 3, 'record, public state, Vibe start');
  assert.match(source, /if \(requestedEditProfile\.length && editProfileApplies\(state, options\)\) \{\n\s+state\.editProfile = normalizeEditProfile\(requestedEditProfile\);/);
  assert.match(source, /"agentProfile", "skillProfile", "assistantContext", "assistantSurface", "editProfile", "model",/);
  assert.match(source, /"assistantSurface", "editProfile", "codexHomeScope",/);
});

// ---- The page ----------------------------------------------------------------------------------------------------

const METHODS = ['agentEditProfileText', 'editProfileAvailable', 'agentEditProfile', 'agentEditProfileShown', 'rememberAgentEditProfile',
  'editProfileCommand', 'feedbackCard', 'agentUiLanguage', 'runLocalCommand', 'localSlashCommands'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const sandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

function panel({ language = 'fr', provider = 'vibe', nocode = false } = {}) {
  const view = new sandbox.View();
  view.global = { currentLanguage: () => language };
  view.local = { Messages: [], Conversation: 'agent-1' };
  view.tick = () => {};
  view.scrollChatBottom = () => {};
  view.getAgentProvider = () => provider;
  view.getAgentSkillProfile = () => (nocode ? 'nocode' : 'generalist');
  view.feedbackCommand = () => false;
  view.writeConfirmCommand = () => false;
  view.writeConfirmAvailable = () => false;
  view.offerWriteConfirmFor = () => {};
  view.showSessionMetrics = () => {};
  view.agentMetricsText = (key) => key;
  view.agentFeedbackText = (key) => key;
  view.agentConfirmText = (key) => key;
  return view;
}
const lastCard = (view) => view.local.Messages.filter((m) => m.type === 'feedback').at(-1);

test('/profil yaml asks the profile for the next messages, until the server has it', () => {
  const view = panel();
  assert.equal(view.agentEditProfile(), '');
  assert.equal(view.runLocalCommand('/profil yaml'), true);
  assert.equal(view.agentEditProfile(), 'yaml');
  assert.equal(lastCard(view).state, 'ready');
  assert.match(lastCard(view).message, /^YAML : l’agent modifie les fichiers YAML du projet|^YAML : l'agent modifie les fichiers YAML du projet/);
  assert.match(lastCard(view).message, /prochain message/);
  // a state of another conversation does not take it
  view.rememberAgentEditProfile({ threadid: 'agent-2', editProfile: '' });
  assert.equal(view.agentEditProfile(), 'yaml');
  // the server has it: no longer sent, shown
  view.rememberAgentEditProfile({ threadid: 'agent-1', editProfile: 'yaml' });
  assert.equal(view.agentEditProfile(), '');
  assert.equal(view.agentEditProfileShown(), 'yaml');
  view.runLocalCommand('/profil');
  assert.match(lastCard(view).message, /Profil de cette conversation : yaml\./);
  // back to the default: "mcp" is sent until the server has ""
  view.runLocalCommand('/profile mcp');
  assert.equal(view.agentEditProfile(), 'mcp');
  assert.equal(view.agentEditProfileShown(), '');
  view.rememberAgentEditProfile({ threadid: 'agent-1', editProfile: '' });
  assert.equal(view.agentEditProfile(), '');
  view.runLocalCommand('/profil html');
  assert.equal(view.agentEditProfile(), 'html');
});

test('/profil refuses an unknown profile, No Code and the other harnesses; the "/" menu lists it where it applies', () => {
  const view = panel();
  view.runLocalCommand('/profil xml');
  assert.equal(lastCard(view).state, 'error');
  assert.equal(view.agentEditProfile(), '');
  assert.ok(view.localSlashCommands().some((c) => c.name === 'profil' && c.hint === 'yaml | html | mcp'));
  for (const other of [panel({ nocode: true }), panel({ provider: 'codex' }), panel({ provider: 'claude' })]) {
    other.runLocalCommand('/profil yaml');
    assert.equal(lastCard(other).state, 'error');
    assert.equal(other.agentEditProfile(), '');
    assert.ok(!other.localSlashCommands().some((c) => c.name === 'profil'));
  }
  const english = panel({ language: 'en' });
  english.runLocalCommand('/profile html');
  assert.match(lastCard(english).message, /^HTML: the agent edits the generated files/);
  // a message for the agent is not a command
  assert.equal(panel().runLocalCommand('profil yaml please'), false);
});

test('the template sends the asked profile and the reopened conversation shows its own', () => {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  assert.match(page, /↓editProfile \[ngx\.components\.UIControlVariable-\d+\]: \n\s+varValue: \n[\s\S]{0,300}MobileSmartSourceType: 'script:this\.agentEditProfile \? this\.agentEditProfile\(\) : '''''/);
  assert.match(page, /this\.local\.AgentSandbox = state\.sandbox \? \{ threadid: state\.threadid, sandbox: state\.sandbox \} : null;\n\s+if \(this\.rememberAgentEditProfile\) \{\n\s+this\.rememberAgentEditProfile\(state\);/);
  assert.match(page, /page\.rememberAgentEditProfile\(state\);/);
});
