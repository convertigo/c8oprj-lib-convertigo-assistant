// The Flash mode of the No Code panel: with its switch on, the first message of a new conversation goes to AgentFlashForm,
// which runs the form generator of lib_ConvertigoMCP (nocode_form_generate) in one call instead of an agent turn. The
// server passes the user's No Code token and, on a server with one gateway key per user, the handle of the user's key;
// a created form or application is recorded as a conversation (transcript: the request and what Flash did) whose first
// agent turn gets a note of it. The panel counts the seconds in a card, opens the result, makes the recorded
// conversation the current one, and offers the agent for what Flash declines. Its texts come from the t() tables.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

// ---- server: AgentFlashForm ----------------------------------------------------------------------------------------

const SERVER = backendParts(['flashNumber', 'flashBaseTables', 'flashAnswer', 'flashFill', 'flashSummaryText', 'flashAgentNote',
  'recordFlashConversation', 'flashFormFromScope'], ['FLASH_GENERATOR_PROJECT', 'FLASH_GENERATOR_SEQUENCE', 'FLASH_TEXTS']);

function server({ scope = {}, answers = [], userKeys = false, keyAnswer = { ok: true, handle: 'lib_ConvertigoAssistant.gatewayKey.abcdef0123456789' }, tokens = ['tok-1', 'tok-2'] } = {}) {
  const calls = [], forgotten = [], transcript = [], saved = [], keyCalls = [];
  const secrets = { 'handle-1': tokens[0], 'handle-2': tokens[1] };
  let handles = ['handle-1', 'handle-2'];
  const context = {
    trim: value => String(value ?? '').trim(),
    now: () => 1795200000000,
    log: { warn: () => {} },
    bridgeCallerRefusal: () => null,
    noCodeAgentRefusal: () => null,
    sequenceScopeValue: (s, name) => (s[name] == null ? '' : String(s[name])),
    withCallerUserId: options => Object.assign({}, options, { userId: 'alice@example.com' }),
    userGatewayKeysOn: options => userKeys && options.agentProfile === 'nocode',
    userGatewayKeyHandle: (options, fetch, margin) => { keyCalls.push({ options: plain(options), fetch, margin }); return keyAnswer; },
    GATEWAY_KEY_TURN_MARGIN_MS: 300000,
    noCodeMcpTokenHandle: () => handles[0] || '',
    sharedSecretGet: handle => secrets[handle] || '',
    forgetNoCodeMcpToken: (options, token) => { forgotten.push(token); handles = handles.slice(1); },
    callLocalSequence: (project, sequence, vars) => {
      calls.push({ project, sequence, vars: plain(vars) });
      const answer = answers.shift();
      if (!answer) throw new Error('no answer for ' + sequence);
      return answer;
    },
    sequencePayload: response => response,
    catalogArray: value => (Array.isArray(value) ? value : []),
    findCatalogValue: (root, names) => root && root[names[0]],
    createState: options => ({ threadid: 'conv-flash-1', userId: options.userId, provider: options.provider || 'vibe', language: options.language || 'fr', created: plain(options) }),
    ensureState: state => state,
    normalizeAssistantLanguage: value => String(value || '').slice(0, 2),
    appendTranscript: (state, role, content) => transcript.push({ role, content }),
    saveState: state => saved.push(plain(state))
  };
  vm.runInNewContext(SERVER, context);
  const run = () => plain(context.flashFormFromScope(Object.assign({ request: 'Fais un questionnaire de satisfaction', reasoning: 'medium', provider: 'convertigo', model: 'mistral-large-4' }, scope)));
  return { context, run, calls, forgotten, transcript, saved, keyCalls };
}

const CREATED = { status: 'created', id: 'form-42', route: 'form', attempts: 1, durationMs: 11400, summary: { name: 'Satisfaction', pages: 1, fields: 4, sections: 1, language: 'fr' },
  usage: { cost: 0.0031, keySource: 'server' } };

test('a created form: the generator with the user\'s token, then a conversation that keeps the exchange', () => {
  const s = server({ answers: [CREATED] });
  const out = s.run();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].project + '.' + s.calls[0].sequence, 'lib_ConvertigoMCP.nocode_form_generate');
  assert.deepEqual(s.calls[0].vars, { token: 'tok-1', userId: 'alice@example.com', mode: 'create', __nolog: 'true', request: 'Fais un questionnaire de satisfaction', reasoning: 'medium' });
  assert.equal(out.status, 'created');
  assert.equal(out.formId, 'form-42');
  assert.equal(out.sections, 1);
  assert.equal(out.costUsd, 0.0031);
  assert.equal(out.threadid, 'conv-flash-1');
  assert.deepEqual(s.transcript, [
    { role: 'user', content: 'Fais un questionnaire de satisfaction' },
    { role: 'assistant', content: '⚡ Flash a créé le formulaire « Satisfaction » en 11 s : 1 page, 4 champs. Il est ouvert dans l’éditeur.' }
  ]);
  const state = s.saved[0];
  assert.equal(state.status, 'completed');
  assert.equal(state.answerIsFinal, true);
  assert.equal(state.created.provider, 'convertigo');
  assert.equal(state.created.agentProfile, 'nocode');
  assert.match(state.flashNote, /Flash mode of the panel created the No Code form "Satisfaction" \(id form-42, 1 pages, 4 fields\)/);
  assert.match(state.flashNote, /change it with nocode-form-edit; never create it again/);
});

test('a data application is summed up with its tables and its base', () => {
  const s = server({ answers: [{ status: 'created', id: 'app-7', route: 'app', durationMs: 16000, summary: { name: 'Prêts', pages: 5, tables: 1, base: 'Prêts de matériel' }, usage: {} }] });
  const out = s.run();
  assert.equal(out.route, 'app');
  assert.equal(s.transcript[1].content, '⚡ Flash a créé l’application « Prêts » en 16 s : 5 pages, 1 table dans la base no-code « Prêts de matériel ». Il est ouvert dans l’éditeur.');
  assert.match(s.saved[0].flashNote, /data application "Prêts" \(id app-7, 5 pages, 1 tables in the no-code database "Prêts de matériel"\)/);
});

test('the summary follows the language of the conversation', () => {
  const s = server();
  const answer = { route: 'form', formName: 'Survey', formId: 'f', pages: 2, fields: 1, tables: 0, base: '', durationMs: 900 };
  assert.equal(s.context.flashSummaryText(answer, 'en'), '⚡ Flash created the form "Survey" in 1 s: 2 pages, 1 field. It is open in the editor.');
  assert.equal(s.context.flashSummaryText(answer, 'es'), '⚡ Flash creó el formulario «Survey» en 1 s: 2 páginas, 1 campo. Está abierto en el editor.');
  assert.equal(s.context.flashSummaryText(answer, 'it'), '⚡ Flash ha creato il modulo «Survey» in 1 s: 2 pagine, 1 campo. È aperto nell’editor.');
  assert.equal(s.context.flashSummaryText(answer, 'de'), s.context.flashSummaryText(answer, 'fr'));
});

test('on a server with one gateway key per user, the user\'s key goes with the call, and nothing runs without it', () => {
  const s = server({ userKeys: true, answers: [CREATED] });
  s.run();
  assert.equal(s.calls[0].vars.gatewayKeyHandle, 'lib_ConvertigoAssistant.gatewayKey.abcdef0123456789');
  assert.deepEqual(s.keyCalls, [{ options: { userId: 'alice@example.com' }, fetch: true, margin: 300000 }]);

  const refused = server({ userKeys: true, keyAnswer: { ok: false, code: 'budget_exceeded' } });
  const out = refused.run();
  assert.equal(out.status, 'error');
  assert.equal(out.error.code, 'budget_exceeded');
  assert.equal(refused.calls.length, 0);
});

test('running answers no conversation; the next call sends the jobId with the request', () => {
  const s = server({ answers: [{ status: 'running', jobId: 'gen-1', stage: 'repair', attempts: 2, elapsedMs: 38000 }] });
  const out = s.run();
  assert.equal(out.status, 'running');
  assert.equal(out.jobId, 'gen-1');
  assert.equal(out.stage, 'repair');
  assert.equal(s.saved.length, 0);
  const resumed = server({ scope: { jobId: 'gen-1' }, answers: [CREATED] });
  resumed.run();
  assert.equal(resumed.calls[0].vars.jobId, 'gen-1');
  assert.equal(resumed.calls[0].vars.request, undefined, 'the generator resumes the job, it does not start another');
  assert.equal(resumed.transcript[0].content, 'Fais un questionnaire de satisfaction', 'the transcript keeps the request the panel sent again');
});

test('a declined or failed request starts no conversation', () => {
  for (const answer of [{ status: 'declined', kind: 'clarify', reason: 'Dites-moi quoi construire.' }, { status: 'error', error: { code: 'gateway_budget', message: 'Budget' } }]) {
    const s = server({ answers: [answer] });
    const out = s.run();
    assert.equal(out.threadid, undefined);
    assert.equal(s.saved.length, 0);
    assert.equal(out.status, answer.status);
  }
});

test('a token refused before anything was generated is replaced once; after a generation, never', () => {
  const s = server({ answers: [{ status: 'error', error: { code: 'auth_required' } }, CREATED] });
  const out = s.run();
  assert.equal(out.status, 'created');
  assert.deepEqual(s.forgotten, ['tok-1']);
  assert.deepEqual(s.calls.map(c => c.vars.token), ['tok-1', 'tok-2']);

  const late = server({ answers: [{ status: 'error', attempts: 1, error: { code: 'auth_required' } }] });
  assert.equal(late.run().status, 'error');
  assert.equal(late.calls.length, 1, 'no second generation');
});

test('the tables of the designated base are read with the user\'s token and sent to the generator', () => {
  const catalog = { tables: [{ id: 12, path: 'Ventes~>Clients', columns: [{ name: 'Nom', type: 'text' }, { name: 'Statut', type: 'single_select', options: [{ value: 'Actif' }, { value: 'Inactif' }] }] }] };
  const s = server({ scope: { baseId: '77' }, answers: [catalog, CREATED] });
  s.run();
  assert.equal(s.calls[0].sequence, 'tools_nocode_baserow_catalog_list');
  assert.deepEqual(s.calls[0].vars, { token: 'tok-1', includeColumns: 'true', databaseId: '77', __nolog: 'true' });
  assert.deepEqual(JSON.parse(s.calls[1].vars.tables), [{ id: 12, path: 'Ventes~>Clients', columns: [{ name: 'Nom', type: 'text', options: [] }, { name: 'Statut', type: 'single_select', options: ['Actif', 'Inactif'] }] }]);
});

test('the first agent turn of a Flash conversation gets the note once, the conversation record keeps it until then', () => {
  const source = read('js/agent_bridge_client.js');
  assert.match(source, /if \(!state\.slashCommand\.length && trim\(state\.flashNote\)\.length\) \{\n\s*question = String\(question\) \+ "\\n\\n" \+ state\.flashNote;\n\s*options\.Question = question;\n\s*state\.flashNote = "";\n\s*\}/);
  assert.match(source, /flashNote: String\(state\.flashNote \|\| ""\),/);
  assert.match(source, /flashNote: record \? String\(record\.flashNote \|\| ""\) : "",/);
});

test('AgentFlashForm is a sequence of an authenticated session', () => {
  assert.match(read('c8oProject.yaml'), /↓AgentFlashForm \[sequences\.GenericSequence\]: 🗏 sequences\/AgentFlashForm\.yaml\n/);
  const sequence = read('_c8oProject/sequences/AgentFlashForm.yaml');
  assert.match(sequence, /^accessibility: Hidden\nauthenticatedContextRequired: true\n/);
  assert.match(sequence, /C8O\.assistantAgentBridge\.flashFormFromSequenceScope\(this\)/);
  for (const name of ['request', 'jobId', 'language', 'baseId', 'userId', 'workspaceRoot', 'reasoning', 'provider', 'model']) {
    assert.match(sequence, new RegExp('\\n↓' + name + ' \\[variables\\.RequestableVariable-\\d+\\]: \\n'), name);
  }
});

// ---- panel ---------------------------------------------------------------------------------------------------------

const METHODS = ['t', 'flashText', 'flashCount', 'flashAvailable', 'flashOn', 'toggleFlash', 'flashTime', 'flashNotApplicable', 'flashSwitchClass',
  'flashSwitchTitle', 'flashShouldHandle', 'flashInConversation', 'answerSourceShown', 'answerSourceText', 'answerSourceTitle', 'flashReasoning',
  'flashResult', 'runFlash', 'flashErrorText', 'flashDone', 'onFlashCta', 'flashConsumeNote'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = { setInterval: () => 1, clearInterval: () => {} };
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function page(language = 'fr', answers = []) {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.local = { Messages: [], AgentProvider: 'convertigo', AgentModel: 'mistral-large-4', AgentReasoningEffort: 'medium' };
  p.flashModeValue = true;
  p.calls = [];
  p.updates = [];
  p.submitted = [];
  p.isEmbeddedInC8Oforms = () => true;
  p.isEmbeddedNoCodeAgent = () => true;
  p.getAgentContextUserId = () => 'alice@example.com';
  p.tick = () => {};
  p.scrollChatBottom = () => {};
  p.feedbackCard = (variant, title, message, actions) => ({ variant, title, message, actions, type: 'feedback' });
  p.notifyC8OformsFormUpdated = (detail, id) => p.updates.push(plain(detail));
  p.chatfooter = { getImageFiles: () => [], getAttachFiles: () => [], getQuestionText: () => p.typing || '', setQuestionText: text => p.submitted.push(text), submitQuestionFromUI: () => {} };
  p.c8o = { callJsonObject: (name, params) => {
    p.calls.push({ name, params: plain(params) });
    const answer = answers.shift();
    return { async: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ result: answer })) };
  } };
  return p;
}

test('Flash takes the first message of a new conversation only', () => {
  const p = page();
  assert.equal(p.flashShouldHandle('Un questionnaire de satisfaction'), true);
  assert.equal(p.flashShouldHandle('/mesures'), false, 'a slash command');
  assert.equal(p.flashShouldHandle('   '), false);
  p.chatfooter.getAttachFiles = () => ['liste.xlsx'];
  assert.equal(p.flashShouldHandle('Importe ce fichier'), false, 'an attachment goes to the agent');
  p.chatfooter.getAttachFiles = () => [];
  p.local.Messages.push({ type: 'user', msg: 'déjà là' });
  assert.equal(p.flashShouldHandle('Un formulaire'), false, 'not after a message of the user');
  p.local.Messages[0].flashDeclined = true;
  assert.equal(p.flashShouldHandle('Un formulaire de contact'), true, 'a request Flash declined can be rephrased');
  p.local.AgentConversationResumed = true;
  assert.equal(p.flashShouldHandle('Un formulaire'), false, 'a reopened conversation');
  const off = page();
  off.flashModeValue = false;
  assert.equal(off.flashShouldHandle('Un formulaire'), false);
  const bypass = page();
  bypass.local.FlashBypassOnce = true;
  assert.equal(bypass.flashShouldHandle('Un formulaire'), false, 'the request handed to the agent');
  assert.equal(bypass.flashShouldHandle('Un formulaire'), true, 'once');
});

test('a created form: the card sums it up, the form opens, the recorded conversation becomes the current one', async () => {
  const p = page('fr', [
    { status: 'running', jobId: 'gen-1', stage: 'repair', attempts: 2 },
    { status: 'created', formId: 'form-42', formName: 'Satisfaction', pages: 1, fields: 4, route: 'form', threadid: 'conv-flash-1' }
  ]);
  p.runFlash('Un questionnaire de satisfaction');
  const card = p.local.Messages[1];
  assert.equal(p.local.Messages[0].msg, 'Un questionnaire de satisfaction');
  assert.equal(card.title, 'En cours · 0 s');
  assert.equal(p.flashNotApplicable(), 'Used', 'while Flash runs');
  assert.equal(card.message, 'Écriture du formulaire (Mistral Large 4, effort medium)…');
  await flush();
  assert.equal(p.calls.length, 2);
  assert.equal(p.calls[0].name, 'lib_ConvertigoAssistant.AgentFlashForm');
  assert.deepEqual(p.calls[0].params, { request: 'Un questionnaire de satisfaction', userId: 'alice@example.com', reasoning: 'medium', provider: 'convertigo', model: 'mistral-large-4' });
  assert.deepEqual(p.calls[1].params, { request: 'Un questionnaire de satisfaction', jobId: 'gen-1', userId: 'alice@example.com', provider: 'convertigo', model: 'mistral-large-4', reasoning: 'medium' });
  assert.equal(card.state, 'ready');
  assert.equal(card.title, 'Formulaire créé en 1 s', 'the badge of the card carries the bolt');
  assert.equal(card.message, '« Satisfaction » : 1 page, 4 champs. Il est ouvert dans l’éditeur ; vos prochains messages vont à Tigo pour le modifier.');
  assert.equal(p.local.Conversation, 'conv-flash-1');
  assert.equal(p.flashConsumeNote(), '', 'the server keeps the note of a recorded conversation');
  assert.equal(p.updates[0].formId, 'form-42');
  assert.equal(p.updates[0].toolName, 'nocode-form-generate');
  assert.equal(p.flashShouldHandle('Ajoute un champ téléphone'), false, 'the next message goes to the agent');
  assert.equal(p.flashNotApplicable(), 'Used');
  assert.equal(p.flashSwitchClass(), 'agent-confirm-switch agent-flash-switch is-on is-inapplicable', 'greyed, the preference kept on');
  assert.equal(p.flashSwitchTitle(), 'Flash utilisé : la suite passe par Tigo');
  assert.equal(p.flashOn(), true);
});

test('without a recorded conversation, the first agent message carries the note once', async () => {
  const p = page('en', [{ status: 'created', formId: 'app-7', formName: 'Loans', pages: 5, tables: 1, base: 'Loans', route: 'app' }]);
  p.runFlash('Equipment loans with their list');
  await flush();
  const card = p.local.Messages[1];
  assert.equal(card.title, 'Application created in 1 s');
  assert.equal(card.message, '"Loans": 5 pages, 1 table in the no-code database « Loans ». It is open in the editor; your next messages go to Tigo to change it.');
  assert.equal(p.local.Conversation, undefined);
  const note = p.flashConsumeNote();
  assert.match(note, /^\[Context from the Tigo panel, not typed by the user: before this turn, the Flash mode of the panel created the No Code data application "Loans" \(id app-7/);
  assert.equal(p.flashConsumeNote(), '');
});

test('a declined request offers the agent, which gets the same request', async () => {
  const p = page('fr', [{ status: 'declined', kind: 'app', reason: 'Un circuit de validation entre plusieurs personnes dépasse Flash.' }]);
  p.runFlash('Un circuit de validation des congés');
  await flush();
  const card = p.local.Messages[1];
  assert.equal(card.title, 'Flash ne peut pas le faire seul');
  assert.equal(card.message, 'Un circuit de validation entre plusieurs personnes dépasse Flash. Tigo en mode agent peut s’en charger.');
  assert.deepEqual(plain(card.actions), [{ id: 'agent', label: 'Passer en mode agent', primary: true }, { id: 'dismiss', label: 'Reformuler' }]);
  assert.equal(p.flashNotApplicable(), '', 'a declined request leaves Flash on for a rephrased one');
  p.onFlashCta(card, { id: 'agent' });
  assert.equal(p.local.Messages.length, 0, 'the declined bubble and card leave the thread');
  p.local.Messages.push({ type: 'user', msg: 'Un circuit de validation des congés' });
  assert.equal(p.flashNotApplicable(), 'First_Only', 'greyed once the request went to the agent');
  assert.deepEqual(p.submitted, ['Un circuit de validation des congés']);
  assert.equal(p.local.FlashBypassOnce, true);
});

test('a refusal of the key, of the budget or of the session is said in the user\'s words', async () => {
  for (const [code, text] of [['gateway_budget', 'Le budget Tigo de ce compte est atteint.'], ['gateway_credential_missing', 'La clé Tigo de ce compte n’a pas pu être obtenue.'],
    ['auth_required', 'La session No Code a expiré : rechargez la page.']]) {
    const p = page('fr', [{ status: 'error', error: { code, message: 'English server text' } }]);
    p.runFlash('Un formulaire de contact');
    await flush();
    assert.equal(p.local.Messages[1].message, text + ' Tigo en mode agent peut s’en charger.');
    assert.equal(p.local.Messages[1].title, 'Flash n’a pas abouti');
  }
});

test('every text of Flash exists in the four languages of the panel', () => {
  const keys = ['Label', 'Title', 'Running', 'Writing', 'Effort', 'Repairing', 'Created', 'Created_Body', 'Created_App', 'App_Body', 'Declined', 'Declined_Body',
    'Failed', 'To_Agent', 'Rephrase', 'Page1', 'Pages', 'Field1', 'Fields', 'Table1', 'Tables', 'Error_Budget', 'Error_Key', 'Error_Auth',
    'Switch_Used', 'Switch_First_Only', 'Badge', 'Badge_Agent', 'Badge_Title', 'Badge_Agent_Title'];
  // every key is used by the Flash methods, and they use no other one
  const flashSource = members.filter(m => /^flash|^runFlash|^onFlashCta|^answerSource/.test(m.name.getText(pageAst))).map(m => m.getText(pageAst)).join('\n');
  const switchSource = read('_c8oProject/mobilePages/Page.yaml').match(/this\.flashText\(''[A-Za-z_]+''\)/g).join('\n').replace(/''/g, '"') + '"Switch_Used" "Switch_First_Only"';
  for (const key of keys) assert.ok((flashSource + switchSource).includes('"' + key + '"'), 'used: ' + key);
  for (const m of flashSource.matchAll(/flashText\("([A-Za-z0-9_]+)"[,)]/g)) assert.ok(keys.includes(m[1]), 'known: ' + m[1]);
  assert.match(flashSource, /this\.flashText\("Switch_" \+ why\)/, 'the two reasons of flashNotApplicable are Switch_ keys');
  for (const language of ['fr', 'en', 'es', 'it']) {
    const p = page(language);
    for (const key of keys) {
      assert.notEqual(p.t('Agent_Flash_' + key), 'Agent_Flash_' + key, language + ' ' + key);
    }
  }
  assert.equal(page('es').flashText('Repairing', { attempt: 1 }), 'Comprobación y reparación automática (1/2)…');
});

test('the switch sits with Confirmer avant de modifier, and the send hook takes the first message', () => {
  const yaml = read('_c8oProject/mobilePages/Page.yaml');
  assert.match(yaml, /↓SwitchesRow \[ngx\.components\.UIDynamicElement-\d+\]: \n[\s\S]{0,800}plain:agent-switches-row/);
  assert.match(yaml, /↓FlashSwitchIf \[ngx\.components\.UIControlDirective-\d+\]: \n[\s\S]{0,600}script:this\.flashAvailable\(\)/);
  assert.match(yaml, /page\.toggleFlash\(\);/);
  assert.match(yaml, /↓FlashSwitch \[ngx\.components\.UIDynamicElement-\d+\]: \n[\s\S]{0,400}MobileSmartSourceType: script:this\.flashSwitchClass\(\)\n/);
  assert.match(yaml, /MobileSmartSourceType: script:this\.flashSwitchTitle\(\)\n/);
  assert.match(pageClass(), /public runLocalCommand\(text\) \{\n\s*\/\/ Flash mode: the first message of a new No Code conversation, while the Flash switch is on\n\s*if \(this\.flashShouldHandle && this\.flashShouldHandle\(text\)\) \{\n\s*this\.runFlash\(text\);\n\s*return true;/);
  assert.match(yaml, /var flashNote = page\.flashConsumeNote \? page\.flashConsumeNote\(\) : "";/);
  assert.doesNotMatch(yaml + read('js/agent_bridge_client.js') + read('_c8oProject/sequences/AgentFlashForm.yaml'), /PROTOTYPE/);
});

test('the switch greys out once Flash no longer applies to the conversation, with its reason in the four languages', () => {
  const fresh = page();
  assert.equal(fresh.flashNotApplicable(), '');
  assert.equal(fresh.flashSwitchClass(), 'agent-confirm-switch agent-flash-switch is-on');
  assert.equal(fresh.flashSwitchTitle(), fresh.flashText('Title'));
  fresh.typing = '/mesures';
  assert.equal(fresh.flashNotApplicable(), 'First_Only', 'a slash command in the composer');
  fresh.typing = '';
  fresh.chatfooter.getAttachFiles = () => ['liste.xlsx'];
  assert.equal(fresh.flashNotApplicable(), 'First_Only', 'an attachment in the composer');
  const resumed = page();
  resumed.local.AgentConversationResumed = true;
  assert.equal(resumed.flashNotApplicable(), 'First_Only');
  const reopenedFlash = page();
  reopenedFlash.local.AgentConversationResumed = true;
  reopenedFlash.local.Messages.push({ type: 'user', msg: 'Un questionnaire' }, { type: 'assistant', msg: '⚡ Flash a créé…', answerSource: 'flash' });
  assert.equal(reopenedFlash.flashNotApplicable(), 'Used', 'a reopened Flash conversation says Flash was used');
  const off = page();
  off.flashModeValue = false;
  off.local.Messages.push({ type: 'user', msg: 'x' });
  assert.equal(off.flashSwitchClass(), 'agent-confirm-switch agent-flash-switch is-inapplicable');
  for (const [language, used, first] of [['fr', 'Flash utilisé : la suite passe par Tigo', 'Flash ne s’applique qu’au premier message'],
    ['en', 'Flash used: the rest goes through Tigo', 'Flash only applies to the first message'],
    ['es', 'Flash utilizado: lo siguiente pasa por Tigo', 'Flash solo se aplica al primer mensaje'],
    ['it', 'Flash usato: il seguito passa da Tigo', 'Flash si applica solo al primo messaggio']]) {
    const p = page(language);
    p.local.Messages.push({ type: 'user', msg: 'x', flash: true });
    assert.equal(p.flashSwitchTitle(), used, language);
    p.local.Messages[0].flash = false;
    assert.equal(p.flashSwitchTitle(), first, language);
  }
});

test('each answer says which path answered, where Flash is on or was used', () => {
  const p = page();
  const agent = { type: 'assistant', msg: 'C’est fait.' };
  const flash = { type: 'assistant', msg: '⚡ Flash a créé…', answerSource: 'flash' };
  assert.equal(p.answerSourceShown(agent), true);
  assert.equal(p.answerSourceText(agent), 'Tigo');
  assert.equal(p.answerSourceTitle(agent), 'Réponse de l’agent Tigo');
  assert.equal(p.answerSourceText(flash), '⚡ Flash');
  assert.equal(p.answerSourceTitle(flash), 'Réponse de Flash, sans tour d’agent');
  assert.equal(p.answerSourceShown({ type: 'assistant', msg: '' }), false, 'nothing under an empty answer');
  p.flashModeValue = false;
  assert.equal(p.answerSourceShown(agent), false, 'no marker where Flash is off and unused');
  p.local.Messages.push(flash);
  assert.equal(p.answerSourceShown(agent), true, 'a conversation Flash answered keeps its markers');
  p.isEmbeddedNoCodeAgent = () => false;
  assert.equal(p.answerSourceShown(agent), false, 'never in the Studio panel');
  const yaml = read('_c8oProject/mobilePages/Page.yaml');
  const foot = yaml.slice(yaml.indexOf('↓AnswerFoot ['), yaml.indexOf('↓IsMetrics [ngx.components.UIControlDirective-1792267235603]'));
  assert.ok(yaml.indexOf('↓AnswerFoot [') > yaml.indexOf('↓AssistantMessage [ngx.components.UIUseShared-1773100000008]'));
  assert.match(foot, /plain:agent-answer-foot/);
  assert.match(foot, /↓AnswerSourceIf [\s\S]*script:this\.answerSourceShown\(item\)[\s\S]*script:this\.answerSourceTitle\(item\)[\s\S]*script:this\.answerSourceText\(item\)[\s\S]*↓CopyAssistantMessage \[/);
  const head = yaml.slice(yaml.indexOf('↓CardHead [ngx.components.UIDynamicElement-1792600000007]'), yaml.indexOf('↓CardTime [ngx.components.UIDynamicElement-1792600000017]'));
  assert.match(head, /↓FlashBadgeIf [\s\S]*script:item\.variant === 'flash'[\s\S]*plain:agent-answer-source is-flash/);
  assert.match(yaml, /\.agent-flash-switch\.is-inapplicable \{ opacity: 0\.5; \}/);
});

test('the history marks what Flash answered', () => {
  const source = read('js/agent_bridge_client.js');
  assert.match(source, /appendTranscript\(state, "user", request, "flash"\);\n\s*appendTranscript\(state, "assistant", summary, "flash"\);/);
  assert.match(source, /if \(source === "flash"\) \{\n\s*entry\.source = "flash";\n\s*\}/);
  assert.match(source, /if \(item\.source === "flash" \|\| \(!item\.runid && content\.indexOf\("⚡ Flash "\) === 0\)\) \{\n\s*message\.answerSource = "flash";/);
});
