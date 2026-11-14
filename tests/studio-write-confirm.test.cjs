// The changes of Tigo in a Studio (Eclipse 8.4, web and Electron 8.5): "Confirmer avant de modifier" holds each write of
// the agent until the user answers a card of the panel, "Lecture seule" refuses every write, off (the default) changes
// nothing. The Studio's choice is the one of the user "studio" (one per engine), kept in agents/assistant/
// write-confirm.json and published for the Convertigo MCP; the MCP half is tested in lib_ConvertigoMCP
// (tests/scripts/validate_studio_write_confirm.cjs). No Code keeps its two choices (tests/nocode-write-confirm.test.cjs).
// node --test tests/studio-write-confirm.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const server = {};
vm.runInNewContext(read('js/agent_write_confirm.js') + '\n' + read('js/agent_host_requests.js'), server);
const confirm = server.C8O.assistantWriteConfirm;
const hostRequests = server.C8O.assistantHostRequests;
const plain = value => JSON.parse(JSON.stringify(value));

class FakeMap {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  put(k, v) { this.m.set(k, v); }
  remove(k, v) { if (v !== undefined && this.m.get(k) !== v) return false; return this.m.delete(k); }
  putIfAbsent(k, v) { if (!this.m.has(k)) this.m.set(k, v); return null; }
  replace(k, before, after) { if (this.m.get(k) !== before) return false; this.m.set(k, after); return true; }
  keySet() { const keys = [...this.m.keys()]; return { toArray: () => keys }; }
}

function serverWorld(kept = null) {
  const store = new Map();
  const clock = { now: 1794000000000 };
  const files = { choice: kept };
  const host = {
    server: () => ({ get: k => store.has(k) ? store.get(k) : null, set: (k, v) => store.set(k, v) }),
    newMap: () => new FakeMap(),
    now: () => clock.now,
    readChoice: () => files.choice,
    writeChoice: record => { files.choice = JSON.parse(JSON.stringify(record)); },
    defaultOn: () => false
  };
  // what lib_ConvertigoMCP (js/studio_write_confirm.js) leaves for a held change of a Studio agent
  const hold = (id, extra = {}) => {
    if (!store.has('lib_ConvertigoAssistant.hostRequests')) store.set('lib_ConvertigoAssistant.hostRequests', new FakeMap());
    const conversations = store.get('lib_ConvertigoAssistant.hostRequests');
    conversations.putIfAbsent('agent-1', new FakeMap());
    conversations.get('agent-1').put(id, JSON.stringify(Object.assign({ id, kind: 'write-confirm', conversationId: 'agent-1', user: 'studio', scope: 'studio',
      tool: 'databaseobject-delete', project: 'CrmApp', projects: ['CrmApp'], items: [{ action: 'delete', project: 'CrmApp', target: 'CrmApp.sq:DeleteClient' }],
      createdAt: clock.now, expiresAt: clock.now + 300000, status: 'pending' }, extra)));
  };
  const request = id => JSON.parse(store.get('lib_ConvertigoAssistant.hostRequests').get('agent-1').get(id) || 'null');
  const choice = () => JSON.parse(store.get('lib_ConvertigoAssistant.writeConfirm')?.get('user:studio') || 'null');
  return { store, clock, files, host, hold, request, choice };
}

test('the three choices of the Studio, kept and published as the MCP reads them', () => {
  assert.deepEqual(plain(confirm.MODES), ['off', 'confirm', 'readonly']);
  for (const [value, mode] of [[true, 'confirm'], [false, 'off'], ['on', 'confirm'], ['confirm', 'confirm'], ['readonly', 'readonly'], ['read-only', 'readonly'], ['?', 'off'],
    [{ on: true }, 'confirm'], [{ on: true, mode: 'readonly' }, 'readonly'], [{ on: false }, 'off'], [{ mode: 'off', on: true }, 'off'],
    // a variable of the sequence: a Java string, an object for typeof in Rhino (Studio_8.4_tigo, 14/11: confirm was saved off)
    [new String('confirm'), 'confirm'], [new String('readonly'), 'readonly']]) {
    assert.equal(confirm.modeOf(value), mode, JSON.stringify(value));
  }
  const w = serverWorld();
  assert.equal(confirm.mode(w.host), 'off', 'off by default');
  assert.deepEqual(plain(confirm.choose('studio', 'readonly', w.host)), { status: 'ok', on: true, mode: 'readonly' });
  assert.deepEqual(w.files.choice, { schema: 'tigo-write-confirm/1', on: true, mode: 'readonly', updatedAt: 1794000000000 });
  assert.deepEqual(w.choice(), { on: true, mode: 'readonly', at: 1794000000000 });
  assert.equal(confirm.mode(w.host), 'readonly');
  confirm.choose('studio', 'confirm', w.host);
  assert.deepEqual(w.choice(), { on: true, mode: 'confirm', at: 1794000000000 });
  confirm.choose('studio', false, w.host);
  assert.equal(w.choice().mode, 'off');
  // a choice kept before the modes ({on} only) reads as confirm
  assert.equal(confirm.mode(serverWorld({ schema: 'tigo-write-confirm/1', on: true }).host), 'confirm');
});

test('a message publishes the Studio choice again and drops what the last turn left', () => {
  const w = serverWorld({ on: true, mode: 'readonly' });
  w.hold('wc-open', { status: 'taken' });
  assert.equal(confirm.newTurn('agent-1', 'studio', w.host), true);
  assert.equal(confirm.lastMode, 'readonly');
  assert.deepEqual(w.choice(), { on: true, mode: 'readonly', at: 1794000000000 }, 'a restarted engine has it again before the agent writes');
  assert.equal(w.request('wc-open'), null);
});

test('the panel of the Studio takes its cards, with the projects; the answers are the Studio user\'s', () => {
  const w = serverWorld();
  w.hold('wc-1');
  const [taken] = plain(hostRequests.take('agent-1', 'studio', w.host));
  assert.equal(taken.scope, 'studio');
  assert.equal(taken.project, 'CrmApp');
  assert.deepEqual(taken.projects, ['CrmApp']);
  assert.deepEqual(taken.items, [{ action: 'delete', project: 'CrmApp', target: 'CrmApp.sq:DeleteClient' }]);
  assert.equal(plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', w.host)).length, 0, 'a No Code user never takes a Studio card');
  assert.deepEqual(plain(confirm.answer({ conversationId: 'agent-1', userId: 'studio', requestId: 'wc-1', decision: 'refuse' }, w.host)), { status: 'ok', state: 'refused' });
  w.hold('wc-2');
  assert.equal(confirm.answer({ conversationId: 'agent-1', userId: 'someone@convertigo.com', requestId: 'wc-2', decision: 'allow' }, w.host).error.code, 'unknown_request');
  assert.deepEqual(plain(confirm.endTurn('agent-1', 'studio', w.host)), { status: 'ok', closed: 1, dropped: 1 });
});

test('the Studio prompt says the mode, and that no card covers a file edit', () => {
  assert.match(confirm.studioPromptLine('readonly'), /^- Change mode: read-only\. .*every Convertigo MCP write is refused, and you must not change any project or file either/);
  assert.match(confirm.studioPromptLine('confirm'), /^- Change mode: confirm before changing\. .*awaiting_confirmation.*no card covers a file you would edit with file or shell tools\.$/);
  assert.match(confirm.studioPromptLine('off'), /^- Change mode: free/);
  const client = read('js/agent_bridge_client.js');
  const prompt = client.slice(client.indexOf('function buildSequencePrompt('), client.indexOf('var normalizedProvider = trim(options.provider)', client.indexOf('function buildSequencePrompt(')));
  assert.match(prompt, /if \(!isNoCodeSurface\) \{\n      try \{\n        promptParts\.push\(writeConfirmModule\(\)\.studioPromptLine\(studioWriteConfirmMode\(options\)\)\);\n      \} catch/);
  assert.match(client, /options\.writeConfirmMode = writeConfirmModule\(\)\.lastMode;/, 'the mode the message published');
});

test('the entry point: read-only for the Studio only, the Studio choice from a WEB_ADMIN session, kept beside the Assistant', () => {
  const client = read('js/agent_bridge_client.js');
  const entry = client.slice(client.indexOf('C8O.assistantAgentBridge.writeConfirm = function'), client.indexOf('function writeConfirmModule()'));
  assert.match(entry, /var studio = writeConfirmStudioUser\(options\.userId\);\n    if \(studio && !isLocalStudio\(\) && !callerIsWebAdmin\(\)\) \{\n      return \{ status: "error", error: \{ code: "authentication_required"/);
  assert.match(entry, /module\.modeOf\(trim\(options\.mode\)\)/, 'a JS string, never the Java one');
  assert.match(entry, /if \(mode === "readonly" && !studio\) \{\n        return \{ status: "error", error: \{ code: "invalid_mode"/);
  assert.match(entry, /return \{ status: "ok", on: current !== "off", mode: current, studio: studio \};/);
  assert.match(entry, /function writeConfirmStudioUser\(userId\) \{\n    return trim\(userId\)\.toLowerCase\(\) === "studio";/);
  assert.match(client, /var file = studio \? new File\(new File\(root, "assistant"\), "write-confirm\.json"\)/);
  assert.match(client, /host\.defaultOn = function \(\) \{\n      if \(studio\) \{\n        return false;\n      \}/, 'the No Code server default is not the Studio\'s');
  const yaml = read('_c8oProject/sequences/AgentWriteConfirm.yaml');
  assert.match(yaml, /↓mode \[variables\.RequestableVariable-\d+\]: \n/);
  assert.match(yaml, /mode: typeof mode === "undefined" \? "" : mode,/);
});

// ---- The page ----------------------------------------------------------------------------------------------------

const METHODS = ['agentConfirmText', 'writeConfirmAvailable', 'writeConfirmStudio', 'writeConfirmUserId', 'writeConfirmOn', 'writeConfirmState',
  'writeConfirmChoice', 'writeConfirmChoices', 'writeConfirmSwitchLabel', 'writeConfirmSwitchTitle', 'toggleWriteConfirm', 'setWriteConfirm',
  'setWriteConfirmMode', 'noteOpenWriteConfirmCards', 'closeWriteConfirmCardsReadonly', 'writeConfirmCommand', 'writeConfirmAsked',
  'offerWriteConfirmFor', 'offerWriteConfirm', 'writeConfirmSummary', 'writeConfirmItemText', 'onWriteConfirmCta', 'closeWriteConfirmCards',
  'forwardAgentHostRequests', 'onFeedbackCta', 'feedbackCard', 'agentUiLanguage', 'normalizeAgentHostContextValue', 'runLocalCommand',
  'feedbackCommand', 'endAgentHostTurn', 'dropOpenFeedbackCards', 'localSlashCommands', 'agentMetricsText', 'agentFeedbackText', 'writeConfirmResult'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const sandbox = { setTimeout: fn => fn() };
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

// The Tigo panel of a Studio: not in C8Oforms, the agent bridge in use, the user "studio".
function panel({ language = 'fr', studio = true, status = { status: 'ok', on: false, mode: 'off' }, answer = { status: 'ok' } } = {}) {
  const view = new sandbox.View();
  const calls = [];
  view.global = { currentLanguage: () => language };
  view.local = { Messages: [{ type: 'user', text: 'Renomme la séquence' }], Conversation: 'agent-1' };
  view.agentHostContext = { capabilities: [] };
  view.tick = () => {};
  view.scrollChatBottom = () => {};
  view.isEmbeddedInC8Oforms = () => !studio;
  view.isEmbeddedNoCodeAgent = () => !studio;
  view.isAgentBridgeOperational = () => true;
  view.postAgentHostMessage = () => false;
  view.getAgentContextUserId = () => studio ? 'studio' : 'gregoryv@convertigo.com';
  view.showSessionMetrics = () => {};
  view.showFeedbackCard = () => {};
  const settle = [];
  view.c8o = { callJsonObject: (name, params) => {
    calls.push([name, JSON.parse(JSON.stringify(params))]);
    const result = params.action === 'status' ? status
      : (params.action === 'set' ? { status: 'ok', on: params.mode !== 'off', mode: params.mode } : (typeof answer === 'function' ? answer(params) : answer));
    return { async: () => { const promise = Promise.resolve({ result }); settle.push(promise); return promise; } };
  } };
  const flush = async () => { for (let i = 0; i < 3; i++) { await Promise.all(settle); await new Promise((resolve) => setImmediate(resolve)); } };
  return { view, calls, flush };
}
const cards = view => view.local.Messages.filter((m) => m.type === 'feedback');
const studioHeld = (id = 'wc-1', extra = {}) => Object.assign({ requestId: id, kind: 'write-confirm', scope: 'studio', tool: 'batch-call', project: 'CrmApp', projects: ['CrmApp'],
  items: [
    { action: 'rename', project: 'CrmApp', target: 'CrmApp.sq:ListClients', name: 'ListCustomers' },
    { action: 'tree_apply', project: 'CrmApp', target: 'CrmApp.sq:ListCustomers', names: ['Log', 'Check'] },
    { action: 'delete', project: 'CrmApp', target: 'CrmApp.sq:Old' }
  ] }, extra);

test('the Studio panel offers three choices: Désactivé, Confirmer, Lecture seule', async () => {
  const { view, calls, flush } = panel({ status: { status: 'ok', on: true, mode: 'readonly' } });
  assert.equal(view.writeConfirmAvailable(), true);
  assert.equal(view.writeConfirmStudio(), true);
  assert.deepEqual(plain(view.writeConfirmChoices()), ['off', 'on', 'readonly']);
  assert.equal(view.writeConfirmChoices(), view.writeConfirmChoices(), 'a stable list for the template');
  assert.deepEqual(plain(view.writeConfirmChoices().map((c) => view.agentConfirmText(c))), ['Désactivé', 'Confirmer', 'Lecture seule']);
  assert.equal(view.agentConfirmText('settingLabel'), 'Modifications des projets');
  assert.match(view.agentConfirmText('settingText'), /^Confirmer : chaque modification d’un projet par Tigo .* Lecture seule : Tigo lit, vérifie et propose/);
  assert.equal(view.writeConfirmChoice(), 'off', 'off until the status is known');
  view.writeConfirmOn();
  await flush();
  assert.deepEqual(calls[0], ['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'status', userId: 'studio' }]);
  assert.equal(view.writeConfirmChoice(), 'readonly');
  assert.equal(view.writeConfirmSwitchLabel(), 'Lecture seule');
  assert.equal(view.writeConfirmSwitchTitle(), 'Lecture seule : toute modification de Tigo est refusée. Cliquez pour désactiver.');
  view.toggleWriteConfirm();
  await flush();
  assert.deepEqual(calls[1], ['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'set', mode: 'off', enabled: 'false', userId: 'studio' }], 'the switch turns read-only off');
  assert.equal(view.writeConfirmChoice(), 'off');
  assert.equal(view.writeConfirmSwitchLabel(), 'Confirmer avant de modifier');
  assert.equal(view.writeConfirmSwitchTitle(), 'Désactivé : Tigo modifie vos projets sans demander. Cliquez pour que chaque modification attende votre accord.');
  view.toggleWriteConfirm();
  await flush();
  assert.deepEqual(calls[2][1], { action: 'set', mode: 'confirm', enabled: 'true', userId: 'studio' }, 'and off to confirm');
  assert.equal(view.writeConfirmChoice(), 'on');
  // No Code keeps two choices and its own texts
  const nocode = panel({ studio: false }).view;
  assert.equal(nocode.writeConfirmStudio(), false);
  assert.deepEqual(plain(nocode.writeConfirmChoices()), ['off', 'on']);
  assert.equal(nocode.agentConfirmText('settingLabel'), 'Confirmer avant de modifier');
  assert.equal(nocode.agentConfirmText('on'), 'Activé');
});

test('a Studio change shows one card: the project, each change by its QName, three answers', async () => {
  const { view, calls, flush } = panel();
  view.forwardAgentHostRequests([studioHeld(), studioHeld()], 'agent-1');
  const [card] = cards(view);
  assert.equal(cards(view).length, 1);
  assert.equal(card.variant, 'confirm');
  assert.equal(card.message, 'Tigo veut modifier le projet « CrmApp » :\n• renommer CrmApp.sq:ListClients en « ListCustomers »\n• modifier CrmApp.sq:ListCustomers : Log, Check\n• supprimer CrmApp.sq:Old');
  assert.deepEqual(plain(card.actions.map((a) => a.label)), ['Autoriser', 'Tout autoriser pour ce tour', 'Refuser']);
  view.onFeedbackCta(card, card.actions[1]);
  await flush();
  assert.deepEqual(calls.at(-1), ['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'answer', threadid: 'agent-1', requestId: 'wc-1', decision: 'allow_turn', userId: 'studio' }]);
  assert.ok(card.message.endsWith('\n\nAutorisé, et les prochaines modifications de ce tour aussi.'), card.message);
  // several projects: each change says its project
  const many = panel({ language: 'en' }).view;
  many.forwardAgentHostRequests([studioHeld('wc-2', { projects: ['CrmApp', 'lib_UserManager'], items: [
    { action: 'save', project: 'CrmApp' }, { action: 'create_page', project: 'lib_UserManager', name: 'Login' }] })], 'agent-1');
  assert.equal(cards(many)[0].message, 'Tigo wants to change the projects CrmApp, lib_UserManager:\n• save the project CrmApp\n• create the page “Login” in lib_UserManager');
});

test('every change the MCP names has its words in the four languages', () => {
  // the actions of lib_ConvertigoMCP js/studio_write_confirm.js (itemOf)
  const items = [
    { action: 'tree_apply', target: 'A.sq:B', names: ['Log'], detail: 'replace' }, { action: 'tree_create', target: 'A', names: ['Hello'] },
    { action: 'tree_insert', target: 'A.sq:B', names: ['C'] }, { action: 'delete', target: 'A.sq:B' },
    { action: 'move', target: 'A.sq:B', to: 'A.sq:C', detail: 'inside' }, { action: 'rename', target: 'A.sq:B', name: 'C' },
    { action: 'create_sequence', project: 'A', name: 'GetClient' }, { action: 'create_transactions', project: 'A', target: 'Db', names: ['Select'] },
    { action: 'crud', project: 'A', names: ['Client'] }, { action: 'create_page', project: 'A', name: 'Clients' }, { action: 'apply_theme', project: 'A' },
    { action: 'write_js', project: 'A', name: 'js/util.js' }, { action: 'save', project: 'A' }, { action: 'delete_project', project: 'A', detail: 'car' },
    { action: 'reload', project: 'A' }, { action: 'import', project: 'lib_UserManager', name: 'lib_UserManager', to: 'A' },
    { action: 'schedule', project: 'A', name: 'Nightly', detail: '0 2 * * *' }, { action: 'unschedule', project: 'A', name: 'Nightly' },
    { action: 'write_stub', project: 'A', target: 'A.sq:B' }, { action: 'tags', project: 'A', detail: 'create' }, { action: 'execute', target: 'lib_ConvertigoMCP.tools_project_save' },
    { action: 'subagent', project: 'A', detail: 'Build the pages' }, { action: 'change', target: 'some-tool' }, { action: 'more' },
    { action: 'build', project: 'A' }
  ];
  for (const language of ['fr', 'en', 'it', 'es']) {
    const { view } = panel({ language });
    for (const item of items) {
      const text = view.writeConfirmItemText(item);
      assert.ok(text.length > 3 && !/op_|\{|\}/.test(text), language + ' ' + item.action + ': ' + text);
    }
    for (const key of ['settingLabel', 'settingText', 'readonly', 'switchReadonlyLabel', 'switchReadonlyTitle', 'modeReadonly', 'readonlyClosed', 'introProject', 'introProjects', 'introStudio']) {
      assert.notEqual(view.agentConfirmText(key), key, language + ' ' + key);
    }
  }
  const { view } = panel();
  assert.equal(view.writeConfirmItemText(items[0]), 'modifier A.sq:B : Log (remplace ses enfants)');
  assert.equal(view.writeConfirmItemText(items[1]), 'créer dans A : Hello', 'Studio_8.4_tigo 14/11: a creation read « modifier ConfirmTest : Hello »');
  assert.equal(view.writeConfirmItemText(items[2]), 'créer à côté de A.sq:B : C');
  assert.equal(view.writeConfirmItemText(items[15]), 'importer lib_UserManager pour A');
  assert.equal(view.writeConfirmItemText(items[13]), 'supprimer le projet A et son archive .car');
  assert.equal(view.writeConfirmItemText(items[14]), 'recharger A depuis ses fichiers (ses modifications non enregistrées sont perdues)');
  assert.equal(view.writeConfirmItemText(items[21]), 'confier à un sous-agent la construction dans A : « Build the pages »');
  assert.equal(view.writeConfirmItemText(items[24]), 'construire l’application de A pour la production');
});

test('read-only closes the cards that wait, and says so', async () => {
  const { view, calls, flush } = panel({ status: { status: 'ok', on: true, mode: 'confirm' } });
  view.forwardAgentHostRequests([studioHeld()], 'agent-1');
  view.setWriteConfirmMode('readonly', null);
  await flush();
  assert.deepEqual(calls.at(-1)[1], { action: 'set', mode: 'readonly', enabled: 'true', userId: 'studio' });
  const [card] = cards(view);
  assert.deepEqual(plain(card.actions), []);
  assert.ok(card.message.endsWith('\n\nLecture seule activée : cette modification est refusée.'), card.message);
});

test('/confirmer lecture and /confirm readonly in the Studio; No Code has no read-only', async () => {
  const { view, calls, flush } = panel();
  assert.equal(view.runLocalCommand('/confirmer lecture'), true);
  await flush();
  assert.equal(calls.at(-1)[1].mode, 'readonly');
  assert.equal(cards(view).at(-1).message, 'Lecture seule : activée. Tigo ne modifie plus rien : il lit, vérifie et propose.');
  assert.equal(cards(view).at(-1).title, 'Modifications des projets');
  view.runLocalCommand('/confirm off');
  await flush();
  assert.equal(calls.at(-1)[1].mode, 'off');
  view.runLocalCommand('/confirm readonly');
  await flush();
  assert.equal(calls.at(-1)[1].mode, 'readonly');
  view.runLocalCommand('/confirmer');
  await flush();
  assert.equal(calls.at(-1)[1].mode, 'confirm', '/confirmer alone turns on the confirmation');
  view.runLocalCommand('/confirmer peut-être');
  assert.equal(cards(view).at(-1).message, 'Commande inconnue : /confirmer, /confirmer on, /confirmer off ou /confirmer lecture.');
  assert.ok(view.localSlashCommands().some((c) => c.name === 'confirmer' && c.hint === 'on · off · lecture'));
  const nocode = panel({ studio: false });
  nocode.view.runLocalCommand('/confirmer lecture');
  await nocode.flush();
  assert.equal(cards(nocode.view).at(-1).message, 'La lecture seule n’existe que dans le Studio.');
  assert.equal(nocode.calls.filter(([, p]) => p.action === 'set').length, 0);
});

test('the template: the switch says read-only, the settings show the three choices', () => {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  const footer = page.slice(page.indexOf('↓ConfirmSwitchIf ['), page.indexOf('↓UseSharedComponent2 [ngx.components.UIUseShared-1751354586662]'));
  assert.match(footer, /MobileSmartSourceType: script:this\.writeConfirmSwitchTitle\(\)/);
  assert.match(footer, /MobileSmartSourceType: script:this\.writeConfirmSwitchLabel\(\)/);
  assert.match(footer, /\(this\.writeConfirmChoice\(\) === ''readonly'' \? '' is-readonly'' : ''''\)/);
  assert.match(page, /\.agent-confirm-switch\.is-readonly \.agent-confirm-track \{ background: var\(--modern-amber, #f59e0b\); \}/);
  const setting = page.slice(page.indexOf('↓ConfirmSettings ['), page.indexOf('↓ServerPrefsSettings ['));
  assert.match(setting, /script:this\.writeConfirmChoices\(\)/);
  assert.match(setting, /page\.setWriteConfirmMode\(props\.stack\.root\.scope\.choice, null\);/);
});
