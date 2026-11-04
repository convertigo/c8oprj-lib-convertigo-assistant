// "Confirmer avant de modifier" (No Code): the user's choice, kept for them and published for the Convertigo MCP, the
// card of a change the MCP holds (Autoriser, Tout autoriser pour ce tour, Refuser), the end of a turn, the switch above
// the input bar, its setting, /confirmer, and the offer of the switch when a message asks for it in words. Off, nothing
// changes. The MCP half is tested in lib_ConvertigoMCP (tests/scripts/validate_nocode_write_confirm.cjs).
// node --test tests/nocode-write-confirm.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

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
  const clock = { now: 1793000000000 };
  const files = { choice: kept };
  const host = {
    server: () => ({ get: k => store.has(k) ? store.get(k) : null, set: (k, v) => store.set(k, v) }),
    newMap: () => new FakeMap(),
    now: () => clock.now,
    readChoice: () => files.choice,
    writeChoice: record => { files.choice = JSON.parse(JSON.stringify(record)); }
  };
  // what lib_ConvertigoMCP leaves for a held change
  const hold = (id, extra = {}) => {
    if (!store.has('lib_ConvertigoAssistant.hostRequests')) store.set('lib_ConvertigoAssistant.hostRequests', new FakeMap());
    const conversations = store.get('lib_ConvertigoAssistant.hostRequests');
    conversations.putIfAbsent('agent-1', new FakeMap());
    conversations.get('agent-1').put(id, JSON.stringify(Object.assign({ id, kind: 'write-confirm', conversationId: 'agent-1', user: 'gregoryv@convertigo.com',
      tool: 'nocode-form-edit', formId: '1793268150601', formName: 'Skyjo', items: [{ action: 'remove_field', target: 'button2' }],
      createdAt: clock.now, expiresAt: clock.now + 300000, status: 'pending' }, extra)));
  };
  const request = id => JSON.parse(store.get('lib_ConvertigoAssistant.hostRequests').get('agent-1').get(id) || 'null');
  const choice = user => JSON.parse(store.get('lib_ConvertigoAssistant.writeConfirm')?.get('user:' + user) || 'null');
  const grant = () => JSON.parse(store.get('lib_ConvertigoAssistant.writeConfirm')?.get('grant:agent-1') || 'null');
  return { store, clock, files, host, hold, request, choice, grant };
}

test('the choice is off until the user turns it on; it is kept for them and published for the MCP', () => {
  const w = serverWorld();
  assert.equal(confirm.isOn(w.host), false);
  assert.equal(plain(confirm.choose('google:42:GregoryV@convertigo.com', true, w.host)).on, true);
  assert.deepEqual(w.files.choice, { schema: 'tigo-write-confirm/1', on: true, updatedAt: 1793000000000 });
  assert.deepEqual(w.choice('gregoryv@convertigo.com'), { on: true, at: 1793000000000 }, 'the owner the MCP names, in lower case');
  confirm.choose('gregoryv@convertigo.com', false, w.host);
  assert.equal(w.choice('gregoryv@convertigo.com').on, false);
  assert.equal(confirm.isOn(w.host), false);
});

test('a message publishes the kept choice again and drops what the last turn left', () => {
  const w = serverWorld({ on: true });
  w.hold('wc-old', { status: 'refused' });
  w.hold('wc-open', { status: 'taken' });
  w.store.set('lib_ConvertigoAssistant.writeConfirm', new FakeMap());
  w.store.get('lib_ConvertigoAssistant.writeConfirm').put('grant:agent-1', JSON.stringify({ user: 'gregoryv@convertigo.com', at: 1 }));
  assert.equal(confirm.newTurn('agent-1', 'gregoryv@convertigo.com', w.host), true);
  assert.equal(w.choice('gregoryv@convertigo.com').on, true, 'a restarted engine has the choice again before the agent writes');
  assert.equal(w.request('wc-old'), null);
  assert.equal(w.request('wc-open'), null);
  assert.equal(w.grant(), null);
  const fresh = serverWorld();
  assert.equal(confirm.newTurn('', 'gregoryv@convertigo.com', fresh.host), false);
  assert.equal(fresh.choice('gregoryv@convertigo.com').on, false);
});

test('the panel takes a held change with its summary, and again while it waits; a capture is taken once', () => {
  const w = serverWorld();
  w.hold('wc-1');
  const first = plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', w.host));
  assert.deepEqual(first, [{ requestId: 'wc-1', kind: 'write-confirm', tool: 'nocode-form-edit', formId: '1793268150601', formName: 'Skyjo',
    items: [{ action: 'remove_field', target: 'button2' }], expiresAt: 1793000300000 }]);
  assert.equal(w.request('wc-1').status, 'taken');
  assert.equal(plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', w.host)).length, 1, 'a panel opened again shows it again');
  assert.equal(plain(hostRequests.take('agent-1', 'other@convertigo.com', w.host)).length, 0);
  w.clock.now += 300001;
  assert.equal(plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', w.host)).length, 0, 'expired');
  const capture = serverWorld();
  capture.hold('cap-1', { kind: 'preview-capture', page: '1', device: 'desktop' });
  assert.equal(plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', capture.host)).length, 1);
  assert.equal(plain(hostRequests.take('agent-1', 'gregoryv@convertigo.com', capture.host)).length, 0);
});

test('answers: allow, allow for the turn (a grant of the conversation), refuse; once, by the owner', () => {
  for (const [decision, status] of [['allow', 'allowed'], ['allow_turn', 'allowed_turn'], ['refuse', 'refused']]) {
    const w = serverWorld();
    w.hold('wc-1', { status: 'taken' });
    const answer = plain(confirm.answer({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'wc-1', decision }, w.host));
    assert.deepEqual(answer, { status: 'ok', state: status });
    assert.equal(w.request('wc-1').status, status);
    assert.equal(!!w.grant(), decision === 'allow_turn', decision);
    const again = plain(confirm.answer({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'wc-1', decision }, w.host));
    assert.equal(again.error.code, 'not_waiting');
    assert.equal(again.state, status);
  }
  const w = serverWorld();
  w.hold('wc-1');
  assert.equal(confirm.answer({ conversationId: 'agent-1', userId: 'someone@convertigo.com', requestId: 'wc-1', decision: 'allow' }, w.host).error.code, 'unknown_request');
  assert.equal(confirm.answer({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'wc-1', decision: 'yes' }, w.host).error.code, 'invalid_decision');
  assert.equal(confirm.answer({ conversationId: 'agent-2', userId: 'gregoryv@convertigo.com', requestId: 'wc-1', decision: 'allow' }, w.host).error.code, 'unknown_request');
  assert.equal(w.request('wc-1').status, 'pending');
});

test('the end of a turn closes the open cards (the MCP refuses them), drops unused answers and the grant', () => {
  const w = serverWorld();
  w.hold('wc-open', { status: 'taken' });
  w.hold('wc-allowed', { status: 'allowed' });
  w.hold('cap-1', { kind: 'preview-capture' });
  confirm.answer({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'wc-open', decision: 'allow_turn' }, w.host);
  w.hold('wc-open2', { status: 'pending' });
  const ended = plain(confirm.endTurn('agent-1', 'gregoryv@convertigo.com', w.host));
  assert.deepEqual(ended, { status: 'ok', closed: 1, dropped: 2 });
  assert.deepEqual([w.request('wc-open2').status, w.request('wc-open2').reason], ['expired', 'turn_end']);
  assert.equal(w.request('wc-allowed'), null);
  assert.equal(w.request('cap-1').status, 'pending', 'a capture is not a card');
  assert.equal(w.grant(), null);
});

test('the prompt says whether the user confirms each change', () => {
  assert.match(confirm.promptLine(true), /^- Change confirmation: on\. .*do not ask the same question in chat\.$/);
  assert.match(confirm.promptLine(false), /^- Change confirmation: off \(the switch "Confirmer avant de modifier" next to the input bar turns it on\)\.$/);
  const block = backendParts(['noCodePromptContextBlock']);
  for (const on of [true, false]) {
    const sandbox = {
      normalizeSkillProfile: () => 'nocode', firstOptionValue: () => '', assistantLanguageName: () => 'French',
      writeConfirmModule: () => confirm, noCodeWriteConfirmOn: () => { throw new Error('read once, by the message'); }
    };
    vm.runInNewContext(block, sandbox);
    const text = sandbox.noCodePromptContextBlock({ userId: 'gregoryv@convertigo.com', writeConfirmOn: on });
    assert.ok(text.split('\n').includes(confirm.promptLine(on)), String(on));
  }
});

test('the sequence and the client entry point: always the authenticated user, set takes enabled', () => {
  const yaml = read('_c8oProject/sequences/AgentWriteConfirm.yaml');
  assert.match(yaml, /^accessibility: Hidden/);
  assert.match(yaml, /C8O\.assistantAgentBridge\.writeConfirm\(\{/);
  for (const name of ['action', 'enabled', 'threadid', 'requestId', 'decision', 'userId']) {
    assert.match(yaml, new RegExp('↓' + name + ' \\[variables\\.RequestableVariable-\\d+\\]: \\n'), name);
  }
  assert.match(read('c8oProject.yaml'), /↓AgentWriteConfirm \[sequences\.GenericSequence\]: 🗏 sequences\/AgentWriteConfirm\.yaml/);
  const client = read('js/agent_bridge_client.js');
  const entry = client.slice(client.indexOf('C8O.assistantAgentBridge.writeConfirm = function'), client.indexOf('function writeConfirmModule()'));
  assert.match(entry, /bridgeCallerRefusal\(\)[\s\S]*withCallerUserId\(options\)/);
  assert.match(entry, /module\.choose\(options\.userId, boolValue\(options\.enabled, false\), host\)/);
  assert.match(client, /agents"\);\n    var file = new File\(new File\(new File\(new File\(root, "nocode"\), "users"\), safePathPart\(normalizeUserKey\(options\.userId\)\)\), "write-confirm\.json"\);/);
  assert.match(client, /if \(normalizeSkillProfile\(state\) === "nocode"\) \{\n      try \{\n        options\.writeConfirmOn = writeConfirmModule\(\)\.newTurn\(state\.threadid, options\.userId, writeConfirmHost\(options\)\);/);
});

// ---- The page ----------------------------------------------------------------------------------------------------

const METHODS = ['agentConfirmText', 'writeConfirmAvailable', 'writeConfirmUserId', 'writeConfirmOn', 'writeConfirmChoices', 'toggleWriteConfirm',
  'setWriteConfirm', 'noteOpenWriteConfirmCards', 'writeConfirmCommand', 'writeConfirmAsked', 'offerWriteConfirmFor', 'offerWriteConfirm',
  'writeConfirmSummary', 'writeConfirmItemText', 'onWriteConfirmCta', 'closeWriteConfirmCards', 'forwardAgentHostRequests', 'onFeedbackCta',
  'feedbackCard', 'agentUiLanguage', 'normalizeAgentHostContextValue', 'runLocalCommand', 'feedbackCommand', 'endAgentHostTurn',
  'dropOpenFeedbackCards', 'localSlashCommands', 'agentMetricsText', 'agentFeedbackText', 'writeConfirmResult'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const sandbox = { setTimeout: fn => fn() };
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

// AgentWriteConfirm answers {<key>: {...}}, the key being the one of its JsonToXmlStep ("result").
const SEQUENCE_KEY = /↓result \[steps\.JsonToXmlStep-\d+\]:[\s\S]*?key: \n[\s\S]*?→→: (\w+)\n/.exec(read('_c8oProject/sequences/AgentWriteConfirm.yaml'))[1];
function panel({ language = 'fr', noCode = true, status = { status: 'ok', on: false }, answer = { status: 'ok' } } = {}) {
  const view = new sandbox.View();
  const calls = [];
  view.global = { currentLanguage: () => language };
  view.local = { Messages: [{ type: 'user', text: 'Supprime le bouton' }], Conversation: 'agent-1' };
  view.agentHostContext = { capabilities: [] };
  view.tick = () => {};
  view.scrollChatBottom = () => {};
  view.isEmbeddedInC8Oforms = () => noCode;
  view.isEmbeddedNoCodeAgent = () => noCode;
  view.postAgentHostMessage = () => false;
  view.getAgentContextUserId = () => 'gregoryv@convertigo.com';
  view.showSessionMetrics = () => {};
  view.showFeedbackCard = () => {};
  const settle = [];
  view.c8o = { callJsonObject: (name, params) => {
    calls.push([name, JSON.parse(JSON.stringify(params))]);
    const result = params.action === 'status' ? status : (params.action === 'set' ? { status: 'ok', on: params.enabled === 'true' } : (typeof answer === 'function' ? answer(params) : answer));
    // The sequence answers under the key of its JsonToXmlStep, as the engine returns it to callJsonObject.
    return { async: () => { const promise = result instanceof Error ? Promise.reject(result) : Promise.resolve({ [SEQUENCE_KEY]: result }); settle.push(promise.catch(() => {})); return promise; } };
  } };
  const flush = async () => { for (let i = 0; i < 3; i++) { await Promise.all(settle); await new Promise((resolve) => setImmediate(resolve)); } };
  return { view, calls, flush };
}
const held = (id = 'wc-1', extra = {}) => Object.assign({ requestId: id, kind: 'write-confirm', tool: 'nocode-form-edit', formId: '1793268150601', formName: 'Skyjo',
  items: [{ action: 'remove_field', target: 'button2', label: 'Enregistrer', kind: 'button' }, { action: 'remove_flow', target: 'Enregistrer le score' }] }, extra);
const cards = view => view.local.Messages.filter((m) => m.type === 'feedback');

test('a held change shows one card: which form, what changes, three answers, in the user\'s language', () => {
  const { view } = panel();
  view.forwardAgentHostRequests([held(), held()], 'agent-1');
  view.forwardAgentHostRequests([held()], 'agent-1');
  const [card] = cards(view);
  assert.equal(cards(view).length, 1);
  assert.equal(card.variant, 'confirm');
  assert.equal(card.title, 'Confirmer la modification');
  assert.equal(card.message, 'Tigo veut modifier « Skyjo » :\n• supprimer le champ button2 (« Enregistrer »)\n• supprimer le flow « Enregistrer le score »');
  assert.deepEqual(plain(card.actions), [{ id: 'allow', label: 'Autoriser', primary: true }, { id: 'allow_turn', label: 'Tout autoriser pour ce tour' }, { id: 'refuse', label: 'Refuser' }]);
  const en = panel({ language: 'en' }).view;
  en.forwardAgentHostRequests([held()], 'agent-1');
  assert.equal(cards(en)[0].message, 'Tigo wants to change “Skyjo”:\n• delete the field button2 (“Enregistrer”)\n• delete the flow “Enregistrer le score”');
  assert.deepEqual(plain(cards(en)[0].actions.map((a) => a.label)), ['Allow', 'Allow all for this turn', 'Refuse']);
  const it = panel({ language: 'it' }).view;
  it.forwardAgentHostRequests([held()], 'agent-1');
  assert.deepEqual(plain(cards(it)[0].actions.map((a) => a.label)), ['Consenti', 'Consenti tutto per questo turno', 'Rifiuta']);
  const es = panel({ language: 'es' }).view;
  es.forwardAgentHostRequests([held()], 'agent-1');
  assert.deepEqual(plain(cards(es)[0].actions.map((a) => a.label)), ['Permitir', 'Permitir todo en este turno', 'Rechazar']);
});

test('the summary words every kind of change', () => {
  const { view } = panel();
  const line = (item) => view.writeConfirmItemText(item);
  assert.equal(line({ action: 'add_field', target: 'pseudo', label: 'Pseudo', page: 'Partie' }), 'ajouter le champ pseudo (« Pseudo ») dans « Partie »');
  assert.equal(line({ action: 'update_field', target: 'score', keys: ['config.mandatory'] }), 'modifier le champ score (config.mandatory)');
  assert.equal(line({ action: 'add_flow_element', flow: 'Enregistrer', kind: 'toast' }), 'ajouter une étape au flow « Enregistrer » (toast)');
  assert.equal(line({ action: 'remove_page', target: 'Résultats' }), 'supprimer la page « Résultats »');
  assert.equal(line({ action: 'update_form', keys: ['name', 'flows'] }), 'remplacer des parties du formulaire (name, flows)');
  assert.equal(line({ action: 'publish', target: 'Skyjo', access: 'anonymous' }), 'publier « Skyjo », accessible sans connexion');
  assert.equal(line({ action: 'create_form', target: 'Congés', pages: 2, fields: 5 }), 'créer le formulaire « Congés » (2 page(s), 5 champ(s))');
  assert.equal(line({ action: 'create_app', target: 'Congés', tables: ['Demandes', 'Salariés'] }), 'créer l’application « Congés » avec les tables Demandes, Salariés');
  assert.equal(line({ action: 'apply_schema', target: 'RH', tables: ['Demandes'] }), 'modifier la structure de la base « RH » avec les tables Demandes');
  assert.equal(line({ action: 'set_root' }), 'modifier les réglages généraux du formulaire');
  assert.equal(line({ action: 'more' }), 'et d’autres modifications');
  assert.equal(line({ action: 'rename_thing', target: 'x' }), 'rename thing x');
  assert.equal(view.writeConfirmSummary({ tool: 'nocode-app-create', formName: 'Congés', items: [{ action: 'create_app', target: 'Congés' }] }), 'Tigo veut créer :\n• créer l’application « Congés »');
  assert.equal(view.writeConfirmSummary({ tool: 'nocode-baserow-schema-apply', formName: 'RH', items: [] }), 'Tigo veut modifier la base Baserow « RH » :');
});

test('Autoriser, Tout autoriser pour ce tour, Refuser: the answer goes to AgentWriteConfirm and the card says it', async () => {
  for (const [id, text] of [['allow', 'Autorisé : Tigo fait la modification.'], ['allow_turn', 'Autorisé, et les prochaines modifications de ce tour aussi.'],
    ['refuse', 'Refusé : rien n’a été modifié. Tigo va vous demander ce que vous voulez.']]) {
    const { view, calls, flush } = panel();
    view.forwardAgentHostRequests([held()], 'agent-1');
    const card = cards(view)[0];
    view.onFeedbackCta(card, card.actions.find((a) => a.id === id));
    assert.equal(card.busy, true);
    await flush();
    assert.deepEqual(calls.filter(([, p]) => p.action === 'answer'), [['lib_ConvertigoAssistant.AgentWriteConfirm',
      { action: 'answer', threadid: 'agent-1', requestId: 'wc-1', decision: id, userId: 'gregoryv@convertigo.com' }]]);
    assert.equal(card.busy, false);
    assert.deepEqual(plain(card.actions), []);
    assert.ok(card.message.endsWith('\n\n' + text), card.message);
    assert.ok(card.message.startsWith('Tigo veut modifier « Skyjo » :'));
  }
});

test('an answer that cannot be sent keeps the buttons; a card already closed says why', async () => {
  const failing = panel({ answer: new Error('network') });
  failing.view.forwardAgentHostRequests([held()], 'agent-1');
  const card = cards(failing.view)[0];
  failing.view.onFeedbackCta(card, card.actions[0]);
  await failing.flush();
  assert.equal(card.actions.length, 3);
  assert.equal(card.state, 'error');
  assert.match(card.message, /Votre réponse n’a pas pu être transmise/);
  for (const [answer, text] of [[{ status: 'error', error: { code: 'not_waiting' }, state: 'expired', reason: 'turn_end' }, 'Le tour s’est terminé'],
    [{ status: 'error', error: { code: 'not_waiting' }, state: 'expired', reason: 'no_answer' }, 'Sans réponse à temps'],
    [{ status: 'error', error: { code: 'not_waiting' }, state: 'allowed' }, 'Cette demande n’attend plus de réponse.'],
    [{ status: 'error', error: { code: 'unknown_request' } }, 'Cette demande n’attend plus de réponse.']]) {
    const { view, flush } = panel({ answer });
    view.forwardAgentHostRequests([held()], 'agent-1');
    view.onFeedbackCta(cards(view)[0], cards(view)[0].actions[2]);
    await flush();
    assert.match(cards(view)[0].message, new RegExp(text));
    assert.equal(cards(view)[0].actions.length, 0);
  }
});

test('the end of a turn closes the open cards and tells the server once', async () => {
  const { view, calls, flush } = panel({ status: { status: 'ok', on: true } });
  view.writeConfirmOn();
  await flush();
  view.forwardAgentHostRequests([held('wc-1'), held('wc-2', { items: [{ action: 'set_root' }] })], 'agent-1');
  view.endAgentHostTurn('run-7');
  view.endAgentHostTurn('run-7');
  for (const card of cards(view)) {
    assert.deepEqual(plain(card.actions), []);
    assert.ok(card.message.endsWith('\n\nLe tour s’est terminé : rien n’a été modifié.'));
  }
  assert.deepEqual(calls.filter(([, p]) => p.action === 'turn_end'), [['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'turn_end', threadid: 'agent-1', userId: 'gregoryv@convertigo.com' }]]);
  // off and without a card: no call at the end of a turn
  const quiet = panel();
  quiet.view.writeConfirmOn();
  await quiet.flush();
  quiet.view.endAgentHostTurn('run-1');
  assert.deepEqual(quiet.calls.map(([, p]) => p.action), ['status']);
});

test('the switch: off by default, one click turns it on at once, off keeps an open card waiting', async () => {
  const { view, calls, flush } = panel();
  assert.equal(view.writeConfirmOn(), false);
  await flush();
  assert.deepEqual(calls, [['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'status', userId: 'gregoryv@convertigo.com' }]]);
  view.toggleWriteConfirm();
  assert.equal(view.writeConfirmOn(), true, 'shown on at once');
  await flush();
  assert.deepEqual(calls[1], ['lib_ConvertigoAssistant.AgentWriteConfirm', { action: 'set', enabled: 'true', userId: 'gregoryv@convertigo.com' }]);
  view.forwardAgentHostRequests([held()], 'agent-1');
  view.toggleWriteConfirm();
  await flush();
  assert.equal(view.writeConfirmOn(), false);
  const card = cards(view)[0];
  assert.equal(card.actions.length, 3, 'switching off answers no card');
  assert.ok(card.message.endsWith('\n\nLes prochaines modifications ne demanderont plus votre accord ; celle-ci attend toujours votre réponse.'));
  assert.deepEqual(view.writeConfirmChoices(), view.writeConfirmChoices());
  // a choice the server could not save comes back
  const failing = panel();
  failing.view.c8o.callJsonObject = (name, params) => ({ async: () => params.action === 'status' ? Promise.resolve({ status: 'ok', on: false }) : Promise.reject(new Error('down')) });
  failing.view.writeConfirmOn();
  await failing.flush();
  failing.view.toggleWriteConfirm();
  await failing.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failing.view.writeConfirmOn(), false);
});

test('the page reads AgentWriteConfirm as the engine answers it: under the key of the sequence', async () => {
  assert.equal(SEQUENCE_KEY, 'result');
  const { view } = panel();
  assert.deepEqual(plain(view.writeConfirmResult({ result: { status: 'ok', on: true } })), { status: 'ok', on: true });
  assert.deepEqual(plain(view.writeConfirmResult({ response: { status: 'ok', on: false } })), { status: 'ok', on: false });
  assert.deepEqual(plain(view.writeConfirmResult({ status: 'ok', on: true })), { status: 'ok', on: true });
  // test-nocode, 1.5.7-beta.3: the server saved each choice and answer, the page said it had failed
  const on = panel({ status: { status: 'ok', on: true } });
  on.view.writeConfirmOn();
  await on.flush();
  assert.equal(on.view.writeConfirmOn(), true, 'a user who turned it on sees it on');
  on.view.toggleWriteConfirm();
  await on.flush();
  assert.equal(on.view.writeConfirmOn(), false, 'and can turn it off');
  const command = panel();
  command.view.runLocalCommand('/confirmer');
  await command.flush();
  assert.equal(command.view.writeConfirmOn(), true);
  assert.equal(command.view.local.Messages.at(-1).message, 'Confirmer avant de modifier : activé. Chaque modification de Tigo attendra votre accord, dès la prochaine.');
  const allowed = panel();
  allowed.view.forwardAgentHostRequests([held()], 'agent-1');
  const card = cards(allowed.view)[0];
  allowed.view.onFeedbackCta(card, card.actions[0]);
  await allowed.flush();
  assert.equal(card.state, 'ready');
  assert.deepEqual(plain(card.actions), []);
  assert.ok(card.message.endsWith('\n\nAutorisé : Tigo fait la modification.'), card.message);
  allowed.view.endAgentHostTurn('run-1');
  assert.ok(card.message.endsWith('\n\nAutorisé : Tigo fait la modification.'), 'the end of the turn does not say an allowed change was not made');
});

test('outside No Code there is no switch, no status call and no command', () => {
  const { view, calls } = panel({ noCode: false });
  assert.equal(view.writeConfirmOn(), false);
  assert.equal(view.writeConfirmAvailable(), false);
  assert.equal(calls.length, 0);
  assert.equal(view.localSlashCommands().some((c) => /^confirm/.test(c.name)), false);
  assert.equal(view.runLocalCommand('/confirmer'), true, 'a local command all the same');
  assert.match(cards(view)[0].message, /n’existe que dans No Code Studio/);
});

test('/confirmer and /confirm: on, off, an unknown word; listed in the "/" menu of No Code', async () => {
  const { view, calls, flush } = panel();
  assert.deepEqual(plain(view.localSlashCommands().filter((c) => /^confirm/.test(c.name)).map((c) => [c.name, c.description, c.hint])),
    [['confirmer', 'Confirmer avant de modifier : chaque modification attend votre accord', 'on · off'], ['confirm', 'Confirmer avant de modifier : chaque modification attend votre accord', 'on · off']]);
  assert.equal(view.runLocalCommand('/confirmer'), true);
  await flush();
  assert.equal(cards(view)[0].message, 'Confirmer avant de modifier : activé. Chaque modification de Tigo attendra votre accord, dès la prochaine.');
  assert.equal(view.runLocalCommand('/confirm off'), true);
  await flush();
  assert.equal(cards(view)[1].message, 'Confirmer avant de modifier : désactivé. Tigo modifie sans demander.');
  assert.equal(view.runLocalCommand('/confirmer peut-être'), true);
  assert.equal(cards(view)[2].message, 'Commande inconnue : /confirmer, /confirmer on ou /confirmer off.');
  assert.deepEqual(calls.filter(([, p]) => p.action === 'set').map(([, p]) => p.enabled), ['true', 'false']);
  assert.equal(view.runLocalCommand('/confirmation des données'), false, 'another word is a message for the agent');
});

test('"ne modifie rien sans mon accord" while off offers the switch, once per conversation', async () => {
  for (const text of ['Ne modifie rien sans mon accord.', 'tu ne changes rien sans me demander ok ?', 'Demande-moi avant de toucher au formulaire',
    'Please do not change anything without my approval', 'ask me first', 'Non modificare niente senza il mio consenso', 'No toques nada sin mi permiso']) {
    assert.equal(panel().view.writeConfirmAsked(text), true, text);
  }
  for (const text of ['Ajoute un champ email', 'Ne modifie pas le titre, ajoute un champ', 'Quel est mon accord de licence ?']) {
    assert.equal(panel().view.writeConfirmAsked(text), false, text);
  }
  const { view, flush } = panel();
  view.writeConfirmOn();
  await flush();
  assert.equal(view.runLocalCommand('Ne modifie rien sans mon accord, mais dis-moi ce qui ne va pas'), false, 'the message still goes to the agent');
  const offer = cards(view)[0];
  assert.equal(offer.variant, 'confirm-offer');
  assert.equal(offer.title, 'Confirmer avant de modifier ?');
  assert.deepEqual(plain(offer.actions.map((a) => a.label)), ['Activer', 'Non merci']);
  view.runLocalCommand('Encore : rien sans mon accord');
  assert.equal(cards(view).length, 1, 'once per conversation');
  view.onFeedbackCta(offer, offer.actions[0]);
  await flush();
  assert.equal(view.writeConfirmOn(), true);
  assert.equal(offer.message, 'Confirmer avant de modifier : activé. Chaque modification de Tigo attendra votre accord, dès la prochaine.');
  // on already: nothing to offer; "Non merci" is not asked again in this panel
  const on = panel({ status: { status: 'ok', on: true } });
  on.view.writeConfirmOn();
  await on.flush();
  on.view.runLocalCommand('Ne modifie rien sans mon accord');
  assert.equal(cards(on.view).length, 0);
  const declined = panel();
  declined.view.writeConfirmOn();
  await declined.flush();
  declined.view.runLocalCommand('Ne modifie rien sans mon accord');
  declined.view.onFeedbackCta(cards(declined.view)[0], cards(declined.view)[0].actions[1]);
  assert.match(cards(declined.view)[0].message, /^D’accord\./);
  declined.view.local.Conversation = 'agent-2';
  declined.view.runLocalCommand('Ne modifie rien sans mon accord');
  assert.equal(cards(declined.view).length, 1);
});

test('a feedback card never drops the card of a change waiting for the user', () => {
  const { view } = panel();
  view.forwardAgentHostRequests([held()], 'agent-1');
  view.local.Messages.push(view.feedbackCard('invite', 'Aidez-nous', '', [{ id: 'ask', label: 'Activer' }]));
  view.dropOpenFeedbackCards('');
  assert.deepEqual(cards(view).map((c) => c.variant), ['confirm']);
});

test('every text exists in the four languages', () => {
  const block = pageClass();
  const start = block.indexOf('public agentConfirmText(key)');
  const body = block.slice(start, block.indexOf('public writeConfirmAvailable()', start));
  const keys = lang => [...new RegExp('\\b' + lang + ': \\{([\\s\\S]*?)\\}(,\\n|\\n\\t\\t\\};)').exec(body)[1].matchAll(/(\w+): "/g)].map((m) => m[1]).sort();
  const fr = keys('fr');
  assert.ok(fr.length > 60);
  for (const lang of ['en', 'it', 'es']) {
    assert.deepEqual(keys(lang), fr, lang);
  }
});

test('the template: the switch above the input bar and the setting, No Code only', () => {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  const footer = page.slice(page.indexOf('↓Footer [ngx.components.UIDynamicElement-1750415662453]'), page.indexOf('↓UseSharedComponent2 [ngx.components.UIUseShared-1751354586662]'));
  assert.match(footer, /↓ConfirmSwitchIf \[ngx\.components\.UIControlDirective-\d+\]: \n    directiveName: If[\s\S]*MobileSmartSourceType: script:this\.writeConfirmAvailable\(\)/);
  assert.match(footer, /attrName: role[\s\S]*plain:switch/);
  assert.match(footer, /attrName: '\[attr\.aria-checked\]'/);
  assert.match(footer, /page\.toggleWriteConfirm\(\);/);
  const setting = page.slice(page.indexOf('↓ConfirmSettings ['), page.indexOf('↓ModelSettings [ngx.components.UIDynamicElement-1787737346772]'));
  assert.match(setting, /script:!this\.writeConfirmAvailable\(\)/);
  assert.match(setting, /script:this\.writeConfirmChoices\(\)/);
  assert.match(setting, /page\.setWriteConfirm\(props\.stack\.root\.scope\.choice === 'on', null\);/);
  assert.match(page, /\.agent-feedback-card\.is-confirm \.agent-metrics-card-message, \.agent-feedback-card\.is-confirm-mode \.agent-metrics-card-message \{ white-space: pre-line; \}/);
  const ids = [...page.matchAll(/-(17932900002\d\d)\]: /g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'unique bean ids');
});
