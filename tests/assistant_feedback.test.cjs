// Feedback to Convertigo (docs/tigo-feedback.md): consent, masking, counting by fingerprint, the MCP's raw frictions,
// sending to TigoAccess, and the /retours and /signaler commands of the page.
// node --test tests/assistant_feedback.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'agent_feedback.js'), 'utf8');

function feedback(options = {}) {
  const sandbox = {};
  vm.runInNewContext(SOURCE, sandbox);
  const F = sandbox.C8O.assistantFeedback;
  let id = 0;
  const store = {
    settings: options.settings || {}, pending: new Map(), incoming: options.incoming || [], sent: [], posts: [],
    symbols: options.symbols || {}, key: options.key === undefined ? 'sk-test' : options.key, answer: options.answer,
    studio: () => options.studio !== false,
    symbol: name => store.symbols[name] || '',
    clock: Date.UTC(2026, 9, 22, 10, 0, 0),
    now: () => store.clock,
    uuid: () => 'report-' + String(++id).padStart(4, '0'),
    sha256: text => crypto.createHash('sha256').update(String(text)).digest('hex'),
    projectNames: () => ['PcaUpdateTracker'],
    stack: (provider, model) => ({ assistant: '1.5.3', bridge: '0.4.26', mcp: '0.2.26', studio: '8.4.7', provider: provider || '', model: model || '', channel: options.channel || 'release' }),
    readSettings: () => store.settings,
    writeSettings: value => { store.settings = value; },
    listPending: () => [...store.pending.values()].map(r => JSON.parse(JSON.stringify(r))).sort((a, b) => String(a.firstAt).localeCompare(String(b.firstAt)) || a.reportId.localeCompare(b.reportId)),
    savePending: report => { store.pending.set(report.reportId, JSON.parse(JSON.stringify(report))); },
    removePending: reportId => { store.pending.delete(reportId); },
    listIncoming: () => store.incoming.map(item => ({ ...item })),
    removeIncoming: name => { store.incoming = store.incoming.filter(item => item.__file !== name); },
    readSent: () => store.sent,
    writeSent: value => { store.sent = value; },
    readKey: () => store.key,
    post: fields => {
      store.posts.push(fields);
      if (store.answer instanceof Error) throw store.answer;
      if (store.answer) return store.answer(fields);
      return { response: { status: 'ok', accepted: JSON.parse(fields.reports).map(r => r.reportId), rejected: [] } };
    }
  };
  F._store = store;
  return { F, store };
}

test('masking removes what could name the customer, its systems or a credential', () => {
  const { F } = feedback();
  const text = F.redact('Mail jane.doe@acme.fr, see https://acme.example/app?x=1 with sk-abcdefghijklmnop and Bearer abcdefghijklmnop, '
    + 'file /Users/jane/dev/PcaUpdateTracker/js/app.js on 10.0.0.12:8080, password=hunter22, token 0123456789abcdef0123456789abcdef, project PcaUpdateTracker.', ['PcaUpdateTracker']);
  for (const leak of ['jane', 'acme', 'sk-abcdef', 'hunter22', '10.0.0.12', '0123456789abcdef', 'PcaUpdateTracker']) {
    assert.ok(!text.includes(leak), leak + ' leaked in: ' + text);
  }
  assert.equal(text, 'Mail <email>, see <url> with <secret> and Bearer <secret>, file <path> on <ip>, password=<secret>, token <secret>, project <project>.');
  assert.equal(F.redact('hash 0123456789abcdef0123456789abcdef0123'), 'hash <hex>');
  // A long name made of words stays; an encoded value with digits goes.
  assert.equal(F.redact('databaseobject-tree-get/requestable-execute'), 'databaseobject-tree-get/requestable-execute');
  assert.equal(F.redact('key dGhpcyBpcyBhIHNlY3JldCB2YWx1ZSAxMjM0NTY3ODkw=='), 'key <data>');
});

test('an error template keeps the shape of an error, so the same error with other values counts once', () => {
  const { F } = feedback();
  const a = F.template('Database object not found: PcaUpdateTracker.pg:Home. Objects named "Home": PcaUpdateTracker.Application.NgxApp.pg:Home\nseen 42 times', ['PcaUpdateTracker']);
  const b = F.template('Database object not found: PcaUpdateTracker.pg:List. Objects named "List": PcaUpdateTracker.Application.NgxApp.pg:List\nseen 7 times', ['PcaUpdateTracker']);
  assert.equal(a, b);
  assert.equal(a, 'Database object not found: <name>. Objects named …: <name> / seen N times');
  assert.equal(F.template('q_test_dates already exists in PcaUpdateTracker.DatabasePca; logic App.loginDemo of loginDemo', ['PcaUpdateTracker']),
    '<name> already exists in <name>; logic <name> of <name>');
  assert.equal(F.template('Unable to evaluate step expression code for "expression" property of SimpleStep'), 'Unable to evaluate step expression code for … property of SimpleStep');
  assert.equal(F.convertigoTool('mcp_Convertigo.sql_transaction_create'), 'sql-transaction-create');
  assert.equal(F.convertigoTool('file_system.bash'), '');
  assert.equal(F.errorMessage('{"code":"-1","message":"sql-transaction-create: invalid spec\\n- IN ({ids})"}', false), 'sql-transaction-create: invalid spec\n- IN ({ids})');
  assert.equal(F.errorMessage('{"status":"ok","rows":[]}', false), '');
  // A Vibe result: the MCP error is the escaped text of a content block, or a cut preview of it.
  const result = JSON.stringify({ type: 'success', content: [{ type: 'text', text: JSON.stringify({ code: '-1', message: 'Database object not found: PfDelta.sq:nexistepas. QName shape: ...' }) }] });
  assert.equal(F.errorMessage(result, false), 'Database object not found: PfDelta.sq:nexistepas. QName shape: ...');
  assert.match(F.errorMessage(result.slice(0, 120), false), /^Database object not found: PfDelta\.sq/);
  assert.equal(F.errorMessage('raw failure', true), 'raw failure');
});

test('consent: off by default, the user chooses unless the administrator imposes a mode, Studio only', () => {
  let { F } = feedback();
  assert.equal(F.mode(), 'off');
  assert.equal(F.setMode('ask').status, 'ok');
  assert.equal(F.mode(), 'ask');
  assert.equal(F.setMode('later').code, 'unknown_mode');
  ({ F } = feedback({ symbols: { 'assistant.feedback.policy': 'auto' } }));
  assert.equal(F.mode(), 'auto');
  assert.deepEqual(JSON.parse(JSON.stringify(F.setMode('off'))), { status: 'error', code: 'locked_by_policy', mode: 'auto' });
  ({ F } = feedback({ studio: false, settings: { mode: 'auto' } }));
  assert.equal(F.mode(), 'off');
  assert.equal(F.status().available, false);
});

test('the invitation: while nobody chose a mode and nothing is imposed; "not now" brings it back in a week', () => {
  let { F, store } = feedback();
  assert.equal(F.status().invite, true);
  assert.equal(F.run({ action: 'later' }).invite, false);
  assert.equal(store.settings.mode, 'off');
  store.clock += 6 * 24 * 3600 * 1000;
  assert.equal(F.invite(), false);
  store.clock += 2 * 24 * 3600 * 1000;
  assert.equal(F.invite(), true);
  // A choice, even "off", ends the invitation.
  assert.equal(F.run({ action: 'mode', mode: 'off' }).invite, false);
  assert.equal(store.settings.decidedAt, store.clock);
  ({ F } = feedback({ settings: { mode: 'ask' } }));
  assert.equal(F.invite(), false);
  ({ F } = feedback({ symbols: { 'assistant.feedback.policy': 'off' } }));
  assert.equal(F.status().invite, false);
  assert.equal(F.later().code, 'locked_by_policy');
  ({ F } = feedback({ studio: false }));
  assert.equal(F.invite(), false);
});

test('tool errors are collected only with consent, Convertigo tools only, and counted by their template', () => {
  let { F, store } = feedback();
  assert.equal(F.collectToolError({ tool: 'mcp_Convertigo.databaseobject_delete', message: 'Database object not found: A.pg:X' }), null);
  ({ F, store } = feedback({ settings: { mode: 'ask' } }));
  F.collectToolError({ tool: 'mcp_Convertigo.databaseobject_delete', message: 'Database object not found: PcaUpdateTracker.pg:Home', provider: 'convertigo', model: 'glm-5-3' });
  F.collectToolError({ tool: 'mcp_Convertigo.databaseobject_delete', message: 'Database object not found: PcaUpdateTracker.pg:List', provider: 'convertigo', model: 'glm-5-3' });
  F.collectToolError({ tool: 'file_system.bash', message: 'exit 1' });
  const pending = F.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'tool_error');
  assert.equal(pending[0].count, 2);
  assert.equal(pending[0].finding.subject, 'databaseobject-delete');
  assert.ok(!JSON.stringify(pending).includes('PcaUpdateTracker'));
  assert.equal(pending[0].stack.model, 'glm-5-3');
  assert.equal(pending[0].stack.channel, 'release');
  assert.equal(store.pending.size, 1);
});

test('the channel says whether the Assistant runs from a release or a git clone on a branch; nothing else passes', () => {
  let { F } = feedback({ settings: { mode: 'ask' }, channel: 'dev' });
  F.collectRuntimeError({ provider: 'vibe', message: 'boom' });
  assert.equal(F.pending()[0].stack.channel, 'dev');
  ({ F } = feedback({ settings: { mode: 'ask' }, channel: '/Users/jane/dev' }));
  F.collectRuntimeError({ provider: 'vibe', message: 'boom' });
  assert.equal(F.pending()[0].stack.channel, undefined);
});

test('a user report is an explicit act: prepared even when collection is off, never under an "off" policy', () => {
  let { F } = feedback();
  const summary = F.turnSummary([
    { type: 'narrative', text: 'Je crée le schéma.' },
    { type: 'tool', toolName: 'mcp_Convertigo.sql_transaction_create', status: 'completed', detail: '{"code":"-1","message":"invalid spec"}' },
    { type: 'tool', toolName: 'mcp_Convertigo.sql_transaction_create', status: 'completed', detail: '{"status":"ok"}' },
    { type: 'tool', toolName: 'file_system.bash', status: 'failed' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { steps: 4, tools: [{ name: 'sql-transaction-create', calls: 2, failures: 1 }, { name: 'file_system', calls: 1, failures: 1 }] });
  assert.equal(F.userReport({ comment: '' }).code, 'comment_required');
  const done = F.userReport({ comment: 'Les pages de PcaUpdateTracker restent vides, voir jane@acme.fr', provider: 'convertigo', turn: summary });
  assert.equal(done.status, 'ok');
  assert.equal(done.report.kind, 'user_report');
  assert.equal(done.report.comment, 'Les pages de <project> restent vides, voir <email>');
  assert.equal(done.report.turn.tools[0].failures, 1);
  ({ F } = feedback({ symbols: { 'assistant.feedback.policy': 'off' } }));
  assert.equal(F.userReport({ comment: 'x' }).code, 'locked_by_policy');
});

test('the raw frictions the MCP leaves get the same masking and counting, then leave incoming/', () => {
  const raw = { kind: 'agent_friction', finding: { area: 'tool', subject: 'business-sequence-create', severity: 'medium', summary: 'vars cannot read input.* in PcaUpdateTracker' }, provider: 'convertigo', model: 'glm-5-3' };
  const { F, store } = feedback({ settings: { mode: 'ask' }, incoming: [{ ...raw, __file: 'a.json' }, { ...raw, __file: 'b.json' }, { kind: 'other', __file: 'c.json' }] });
  const pending = F.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].count, 2);
  assert.equal(pending[0].finding.summary, 'vars cannot read input.* in <project>');
  assert.equal(store.incoming.length, 0);
});

test('sending: the Tigo key is needed, accepted reports leave, a refusal or an outage keeps them', () => {
  let { F, store } = feedback({ settings: { mode: 'ask' }, key: '' });
  F.collectRuntimeError({ provider: 'convertigo', message: 'gateway 401' });
  assert.equal(F.send().code, 'not_connected');
  assert.equal(store.pending.size, 1);

  ({ F, store } = feedback({ settings: { mode: 'ask' }, answer: new Error('down') }));
  F.collectRuntimeError({ provider: 'convertigo', message: 'gateway 401' });
  assert.equal(F.send().code, 'service_unavailable');
  assert.equal(store.pending.size, 1);

  ({ F, store } = feedback({ settings: { mode: 'ask' } }));
  F.collectRuntimeError({ provider: 'convertigo', message: 'gateway 401' });
  F.collectRuntimeError({ provider: 'vibe', message: 'process exited 137' });
  const result = F.send();
  assert.equal(result.status, 'ok');
  assert.equal(result.accepted, 2);
  assert.equal(store.pending.size, 0);
  assert.equal(store.sent.length, 2);
  assert.equal(store.posts[0].apiKey, 'sk-test');
  const sent = JSON.parse(store.posts[0].reports);
  assert.equal(sent[0].schemaVersion, 'tigo-feedback/1');
  assert.equal(sent[0].finding.template, 'gateway N');
});

test('reports go to TigoAccess in HTTPS; only a loopback test server is reached in plain HTTP', () => {
  const { F } = feedback();
  assert.equal(F.endpoint(''), 'https://backend-apps.convertigo.net/convertigo/projects/TigoAccess/.json?__sequence=submitFeedback&__disableAutologin=true');
  assert.match(F.endpoint('studio-8-4-feedback.localhost:18112'), /^http:\/\/studio-8-4-feedback\.localhost:18112\//);
  assert.match(F.endpoint('127.0.0.1:8080'), /^http:\/\//);
  assert.match(F.endpoint('localhost.evil.com'), /^https:\/\//);
  assert.throws(() => F.endpoint('evil.com/x?y'), /Invalid TigoAccess host/);
});

test('automatic mode sends after a turn; the outbox and a batch stay bounded', () => {
  let { F, store } = feedback({ settings: { mode: 'ask' } });
  F.collectRuntimeError({ provider: 'convertigo', message: 'boom' });
  assert.equal(F.flush().skipped, true);
  assert.equal(store.posts.length, 0);
  ({ F, store } = feedback({ settings: { mode: 'auto' } }));
  const word = i => 'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(i / 26)) + 'abcdefghijklmnopqrstuvwxyz'.charAt(i % 26);
  for (let i = 0; i < 120; i++) {
    F.collectRuntimeError({ provider: 'convertigo', message: 'failure ' + word(i) });
  }
  assert.equal(store.pending.size, 100);
  F.flush();
  assert.equal(JSON.parse(store.posts[0].reports).length, 50);
  assert.equal(store.pending.size, 50);
});

const METHODS = ['agentFeedbackText', 'feedbackCommand', 'fillFeedbackCard', 'agentUiLanguage', 'feedbackErrorText', 'feedbackTurnFailures', 'feedbackCard',
  'dropOpenFeedbackCards', 'offerFeedback', 'offerFeedbackOnOpen', 'onFeedbackCta', 'offerAutoAfterSend', 'canReportTurn', 'prefillFeedbackReport', 'feedbackSettingNote', 'feedbackSettingChoices'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function page(language, answers = []) {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.cards = [];
  p.calls = [];
  p.published = [];
  p.local = { Messages: [] };
  p.showFeedbackCard = (action, args) => p.cards.push([action, JSON.parse(JSON.stringify(args))]);
  p.tick = () => {};
  p.scrollChatBottom = () => {};
  p.events = { publish: (topic, data) => p.published.push([topic, data]) };
  p.feedbackStatusCached = () => p.local.FeedbackStatus || null;
  p.c8o = { callJsonObject: (name, params) => {
    p.calls.push(JSON.parse(JSON.stringify(params)));
    const answer = answers.shift();
    return { async: () => answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer) };
  } };
  return p;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the commands map to their action and never reach the agent', () => {
  const p = page('fr');
  assert.equal(p.feedbackCommand('/retours'), true);
  assert.equal(p.feedbackCommand('/retours envoyer'), true);
  assert.equal(p.feedbackCommand('/feedback ask'), true);
  assert.equal(p.feedbackCommand('/retours off'), true);
  assert.equal(p.feedbackCommand('/retours plus-tard'), true);
  assert.equal(p.feedbackCommand('/signaler Les pages restent vides'), true);
  assert.equal(p.feedbackCommand('/report'), true);
  assert.equal(p.feedbackCommand('/compact'), false);
  assert.deepEqual(p.cards, [['status', { mode: '' }], ['send', { mode: '' }], ['mode', { mode: 'ask' }], ['mode', { mode: 'off' }], ['unknown', { mode: '' }],
    ['report', { comment: 'Les pages restent vides' }], ['usage', { comment: '' }]]);
});

test('the card shows the mode, one row per waiting report and what to do next; its JSON is what is sent', () => {
  const p = page('fr');
  const card = { rows: [], json: '' };
  p.fillFeedbackCard(card, { status: 'ok', available: true, mode: 'ask', locked: false, sentCount: 3, pending: [
    { kind: 'tool_error', count: 2, finding: { subject: 'databaseobject-delete', template: 'Database object not found: <project>.pg:Home' } },
    { kind: 'user_report', count: 1, finding: { subject: 'turn', summary: 'Pages vides' }, comment: 'Pages vides' }
  ] }, 'status');
  assert.deepEqual(Array.from(card.rows, r => r.label + ' = ' + r.value), ['Mode = Relire avant envoi', 'En attente = 2', 'Envoyés = 3',
    'Erreur d\'outil · databaseobject-delete = Database object not found: <project>.pg:Home ×2', 'Signalement = Pages vides']);
  assert.match(card.message, /puis Envoyer ou Effacer\.$/);
  assert.equal(JSON.parse(card.json).length, 2);
  assert.deepEqual(Array.from(card.actions, a => a.id), ['send', 'clear']);
  const sent = { rows: [], json: '' };
  p.fillFeedbackCard(sent, { status: 'ok', available: true, mode: 'auto', locked: true, sentCount: 1, pending: [], result: { status: 'ok', accepted: 1, rejected: [] } }, 'send');
  assert.equal(sent.rows[0].value, 'Automatique (imposé par l\'administrateur)');
  assert.match(sent.message, /^1 rapport\(s\) envoyé\(s\)\. Aucun rapport en attente\.$/);
  assert.equal(sent.actions.length, 0);
  const offline = { rows: [] };
  p.fillFeedbackCard(offline, { status: 'ok', available: true, mode: 'ask', pending: [{ kind: 'runtime_error', count: 1, finding: { subject: 'vibe', template: 'x' } }], result: { status: 'error', code: 'not_connected' } }, 'send');
  assert.match(offline.message, /^Activez Tigo/);
});

test('after a turn the thread invites until it is answered, cites the failed tools, and reminds of waiting reports when they grow', () => {
  const p = page('fr');
  const events = [{ type: 'tool', status: 'failed' }, { type: 'tool', status: 'completed', detail: '{"content":[{"type":"text","text":"{\\"code\\":\\"-1\\",\\"message\\":\\"x\\"}"}]}' },
    { type: 'tool', status: 'completed', detail: '{"status":"ok"}' }, { type: 'narrative', status: 'failed' }];
  assert.equal(p.feedbackTurnFailures(events), 2);
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }, 2);
  assert.equal(p.local.Messages.length, 1);
  const invite = p.local.Messages[0];
  assert.equal(invite.type, 'feedback');
  assert.equal(invite.variant, 'invite');
  assert.match(invite.message, /^Ce tour a rencontré 2 erreur\(s\) d'outil\. Partagez avec Convertigo/);
  assert.deepEqual(Array.from(invite.actions, a => a.id), ['ask', 'auto', 'later']);
  // The next turn moves the open invitation to the end of the thread: one card, never two.
  p.local.Messages.push({ type: 'assistant', msg: 'next answer' });
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }, 0);
  assert.deepEqual(Array.from(p.local.Messages, m => m.type), ['assistant', 'feedback']);
  assert.match(p.local.Messages[1].message, /^Partagez avec Convertigo/);
  // Imposed by the administrator: no card at all.
  const locked = page('fr');
  locked.offerFeedback({ status: 'ok', available: true, mode: 'off', locked: true, invite: false, pending: [] }, 3);
  assert.equal(locked.local.Messages.length, 0);
  // Review mode: a reminder when the waiting reports grow, one open card at a time.
  const ask = page('fr');
  const waiting = n => ({ status: 'ok', available: true, mode: 'ask', invite: false, pending: Array.from({ length: n }, () => ({})) });
  ask.offerFeedback(waiting(2), 0);
  assert.equal(ask.local.Messages[0].message, '2 retour(s) prêt(s) pour Convertigo. Relisez-les avant de les envoyer.');
  ask.offerFeedback(waiting(2), 0);
  assert.equal(ask.local.Messages.length, 1);
  ask.offerFeedback(waiting(3), 0);
  assert.equal(ask.local.Messages.length, 1);
  assert.match(ask.local.Messages[0].message, /^3 retour/);
  assert.equal(ask.local.FeedbackStatus.mode, 'ask');
});

test('the card buttons choose a mode, snooze, send or open the review card', async () => {
  const p = page('fr', [{ status: 'ok', mode: 'ask', invite: false, pending: [], result: { status: 'ok', mode: 'ask' } }]);
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }, 0);
  const card = p.local.Messages[0];
  p.onFeedbackCta(card, card.actions[0]);
  assert.equal(card.busy, true);
  p.onFeedbackCta(card, card.actions[1]);
  await settle();
  assert.deepEqual(p.calls, [{ action: 'mode', mode: 'ask' }]);
  assert.equal(card.actions.length, 0);
  assert.match(card.message, /^Merci ! Les retours sont préparés ici/);
  assert.equal(p.local.FeedbackStatus.mode, 'ask');

  const later = page('en', [{ status: 'ok', mode: 'off', invite: false, pending: [], result: { status: 'ok', snoozedUntil: 1 } }]);
  later.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }, 0);
  later.onFeedbackCta(later.local.Messages[0], later.local.Messages[0].actions[2]);
  await settle();
  assert.deepEqual(later.calls, [{ action: 'later', topic: 'invite' }]);
  assert.match(later.local.Messages[0].message, /^All right, we will ask again in a week/);

  const send = page('fr', [{ status: 'ok', mode: 'ask', pending: [{}], result: { status: 'error', code: 'not_connected', pending: 1 } }]);
  send.offerFeedback({ status: 'ok', available: true, mode: 'ask', pending: [{}] }, 0);
  send.onFeedbackCta(send.local.Messages[0], { id: 'send' });
  await settle();
  assert.equal(send.local.Messages[0].state, 'error');
  assert.match(send.local.Messages[0].message, /^Activez Tigo/);
  assert.equal(send.local.Messages[0].actions.length, 2);

  const review = page('fr');
  review.offerFeedback({ status: 'ok', available: true, mode: 'ask', pending: [{}] }, 0);
  review.onFeedbackCta(review.local.Messages[0], { id: 'review' });
  assert.equal(review.local.Messages.length, 0);
  assert.deepEqual(review.cards, [['status', { mode: '' }]]);
});

test('"Report a problem" sits on the last finished turn only and puts the command in the draft', () => {
  const p = page('fr');
  const first = { type: 'worklog' };
  const answer = { type: 'assistant', msg: 'ok' };
  const last = { type: 'assistant', runEvents: [{ type: 'tool' }] };
  p.local.Messages = [first, answer, last, { type: 'metrics' }];
  assert.equal(p.canReportTurn(last), false);
  p.local.FeedbackStatus = { status: 'ok', available: true, mode: 'off', locked: false };
  assert.equal(p.canReportTurn(last), true);
  assert.equal(p.canReportTurn(first), false);
  assert.equal(p.canReportTurn({ ...last, writing: true }), false);
  p.local.FeedbackStatus = { status: 'ok', available: true, mode: 'off', locked: true };
  assert.equal(p.canReportTurn(last), false);
  let prevented = 0;
  p.prefillFeedbackReport({ preventDefault: () => prevented++, stopPropagation: () => prevented++ });
  assert.equal(prevented, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p.published)), [['TigoPromptInsert', { text: '/signaler ' }]]);
  const en = page('en');
  en.prefillFeedbackReport(null);
  assert.equal(en.published[0][1].text, '/report ');
});

test('the setting lists the three modes and says what waits or who decided', () => {
  const p = page('fr');
  assert.equal(p.feedbackSettingChoices(), p.feedbackSettingChoices());
  assert.deepEqual(Array.from(p.feedbackSettingChoices()), ['off', 'ask', 'auto']);
  assert.equal(p.feedbackSettingNote(), '');
  p.local.FeedbackStatus = { mode: 'ask', locked: false, pending: [{}, {}] };
  assert.equal(p.feedbackSettingNote(), '2 rapport(s) en attente : /retours pour les relire.');
  p.local.FeedbackStatus = { mode: 'auto', locked: true, pending: [] };
  assert.equal(p.feedbackSettingNote(), 'Mode imposé par l\'administrateur.');
  for (const language of ['fr', 'en', 'it', 'es']) {
    const texts = page(language);
    for (const key of ['inviteTitle', 'inviteText', 'inviteFailures', 'inviteAsk', 'inviteAuto', 'inviteLater', 'inviteDoneAsk', 'inviteDoneAuto', 'inviteDoneLater',
      'pendingText', 'review', 'sendNow', 'reportLink', 'reportLinkTitle', 'settingLabel', 'settingText', 'settingPending']) {
      assert.notEqual(texts.agentFeedbackText(key), key, language + ' ' + key);
    }
  }
});

test('a reopened conversation shows the unanswered invitation, or the waiting reports, again at its end, after a finished turn only', async () => {
  const p = page('fr', [{ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }]);
  p.local.Messages = [{ type: 'user', msg: 'Bonjour' }, { type: 'assistant', msg: 'Bonjour !', runEvents: [] }];
  p.offerFeedbackOnOpen();
  await settle();
  assert.deepEqual(p.calls, [{ action: 'status' }]);
  assert.deepEqual(Array.from(p.local.Messages, m => m.type), ['user', 'assistant', 'feedback']);
  assert.equal(p.local.Messages[2].variant, 'invite');
  // Answered or snoozed: the status says no invitation, nothing comes back.
  const answered = page('fr', [{ status: 'ok', available: true, mode: 'ask', invite: false, pending: [] }]);
  answered.local.Messages = [{ type: 'assistant', msg: 'ok' }];
  answered.offerFeedbackOnOpen();
  await settle();
  assert.equal(answered.local.Messages.length, 1);
  // Review mode: the reminder of the waiting reports comes back too, even when this page already showed it.
  const waiting = page('fr', [{ status: 'ok', available: true, mode: 'ask', invite: false, pending: [{}, {}] }]);
  waiting.offerFeedback({ status: 'ok', available: true, mode: 'ask', invite: false, pending: [{}, {}] }, 0);
  waiting.local.Messages = [{ type: 'user', msg: 'Bonjour' }, { type: 'assistant', msg: 'ok' }];
  waiting.offerFeedbackOnOpen();
  await settle();
  assert.deepEqual(Array.from(waiting.local.Messages, m => m.variant || m.type), ['user', 'assistant', 'pending']);
  assert.match(waiting.local.Messages[2].message, /^2 retour\(s\) prêt\(s\)/);
  // Nothing waiting: nothing comes back.
  const sent = page('fr', [{ status: 'ok', available: true, mode: 'ask', invite: false, pending: [] }]);
  sent.local.Messages = [{ type: 'assistant', msg: 'ok' }];
  sent.offerFeedbackOnOpen();
  await settle();
  assert.equal(sent.local.Messages.length, 1);
  // A new conversation, or one still running: no call at all.
  const empty = page('fr');
  empty.local.Messages = [{ type: 'user', msg: 'Bonjour' }, { type: 'assistant', msg: '…', writing: true }];
  empty.offerFeedbackOnOpen();
  assert.equal(empty.calls.length, 0);
});

test('the review card sends or clears from its own buttons and shows what is left', async () => {
  const left = { status: 'ok', available: true, mode: 'ask', locked: false, sentCount: 3, pending: [], result: { status: 'ok', accepted: 2, rejected: [] } };
  const p = page('fr', [left]);
  const card = { type: 'metrics', rows: [], json: '' };
  p.fillFeedbackCard(card, { status: 'ok', available: true, mode: 'ask', locked: false, sentCount: 1, pending: [{ kind: 'tool_error', count: 1, finding: { subject: 'x', template: 'y' } }] }, 'status');
  p.onFeedbackCta(card, card.actions[0]);
  await settle();
  assert.deepEqual(p.calls, [{ action: 'send' }]);
  assert.equal(card.message, '2 rapport(s) envoyé(s). Aucun rapport en attente.');
  assert.equal(card.actions.length, 0);
  assert.equal(card.rows[2].value, '3');
  const cleared = page('fr', [{ status: 'ok', available: true, mode: 'ask', pending: [], result: { status: 'ok', cleared: 1 } }]);
  const other = { type: 'metrics', rows: [], json: '', actions: [{ id: 'clear' }] };
  cleared.onFeedbackCta(other, other.actions[0]);
  await settle();
  assert.deepEqual(cleared.calls, [{ action: 'clear' }]);
  assert.match(other.message, /^1 rapport\(s\) effacé\(s\)\./);
  // The service is down: the reports and the buttons stay, the card says why.
  const down = page('fr', [{ status: 'ok', available: true, mode: 'ask', pending: [{ kind: 'tool_error', count: 1, finding: { subject: 'x', template: 'y' } }], result: { status: 'error', code: 'service_unavailable' } }]);
  const kept = { type: 'metrics', rows: [], json: '', actions: [{ id: 'send' }] };
  down.onFeedbackCta(kept, kept.actions[0]);
  await settle();
  assert.match(kept.message, /^Service de retours injoignable/);
  assert.equal(kept.actions.length, 2);
});

test('one name per provider, whatever the agent calls it; the conversation names the provider of a friction', () => {
  const { F, store } = feedback({ settings: { mode: 'ask' }, incoming: [
    { kind: 'agent_friction', finding: { area: 'tool', subject: 'requestable-execute', summary: 'no close names' }, provider: 'Anthropic', model: 'claude-opus-5-5', __file: 'a.json' }
  ] });
  assert.deepEqual(['Anthropic', 'claude-code', 'OpenAI', 'codex', 'Mistral', 'vibe', 'convertigo'].map(F.provider), ['claude', 'claude', 'codex', 'codex', 'vibe', 'vibe', 'convertigo']);
  F.collectToolError({ tool: 'mcp_Convertigo.requestable_execute', message: 'There is no sequence named x', provider: 'claude', model: 'claude-opus-5-5' });
  // End of turn: the conversation runs Claude Code on its default model; the agent named the model that answered.
  F.ingest({ provider: 'claude', model: 'default' });
  const stacks = [...store.pending.values()].map(r => r.kind + ' ' + r.stack.provider + ' ' + r.stack.model).sort();
  assert.deepEqual(stacks, ['agent_friction claude claude-opus-5-5', 'tool_error claude claude-opus-5-5']);
  // A model chosen for the conversation wins over the agent's word.
  const chosen = feedback({ settings: { mode: 'ask' }, incoming: [{ kind: 'agent_friction', finding: { subject: 's', summary: 'x' }, provider: 'Zhipu', model: 'glm-x', __file: 'b.json' }] });
  chosen.F.ingest({ provider: 'convertigo', model: 'glm-5-3' });
  const report = [...chosen.store.pending.values()][0];
  assert.equal(report.stack.provider + ' ' + report.stack.model, 'convertigo glm-5-3');
});

test('the model of a report: the chosen one, else the one that answered, else the default of the CLI', () => {
  const sandbox = {};
  vm.runInNewContext(backendParts(['trim', 'feedbackModel']) + '\nthis.feedbackModel = feedbackModel;', sandbox);
  assert.equal(sandbox.feedbackModel({ model: 'glm-5-3', usage: { agentModel: 'x' } }), 'glm-5-3');
  assert.equal(sandbox.feedbackModel({ model: '', usage: { agentModel: 'claude-opus-5-5' } }), 'claude-opus-5-5');
  assert.equal(sandbox.feedbackModel({ model: '' }), 'default');
});

test('server: the nudge follows an "off" choice, the offer of "auto" a review mode; each "not now" has its own delay', () => {
  const { F, store } = feedback();
  assert.equal(F.status().nudge, false);
  F.setMode('off');
  assert.equal(F.nudge(), true);
  assert.equal(F.offerAuto(), false);
  F.later('nudge');
  assert.equal(F.nudge(), false);
  assert.equal(store.settings.decidedAt > 0, true, 'a snooze keeps the choice');
  store.clock += 8 * 24 * 3600 * 1000;
  assert.equal(F.nudge(), true);
  F.setMode('ask');
  assert.equal(F.status().offerAuto, true);
  assert.equal(F.run({ action: 'later', topic: 'auto' }).offerAuto, false);
  store.clock += 20 * 24 * 3600 * 1000;
  assert.equal(F.offerAuto(), false);
  store.clock += 11 * 24 * 3600 * 1000;
  assert.equal(F.offerAuto(), true);
  assert.equal(F.later('other').code, 'unknown_topic');
  const locked = feedback({ symbols: { 'assistant.feedback.policy': 'ask' } }).F;
  assert.equal(locked.offerAuto(), false);
});

test('server: turned on from a failed turn, the errors of that turn are collected at once', () => {
  const { F } = feedback({ settings: { mode: 'off', decidedAt: 1 } });
  const events = [
    { type: 'tool', toolName: 'mcp__convertigo__databaseobject-tree-get', status: 'completed', detail: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ code: '-1', message: 'Database object not found: PcaUpdateTracker.sq:x' }) }] }) },
    { type: 'tool', toolName: 'mcp__convertigo__project-list', status: 'completed', detail: '{"status":"ok"}' },
    { type: 'tool', toolName: 'Bash', status: 'failed', detail: 'exit 1' }
  ];
  const result = F.run({ action: 'mode', mode: 'ask', events, provider: 'Anthropic', model: 'default' });
  assert.equal(result.result.collected, 1);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].finding.subject, 'databaseobject-tree-get');
  assert.equal(result.pending[0].stack.provider, 'claude');
  // Turned off: nothing is collected.
  const off = feedback({ settings: { mode: 'ask', decidedAt: 1 } }).F;
  assert.equal(off.run({ action: 'mode', mode: 'off', events }).result.collected, undefined);
});

test('page: "off" chosen, a failed turn nudges; in review mode the reminder and a manual send offer "auto"', async () => {
  const p = page('fr', [{ status: 'ok', available: true, mode: 'ask', invite: false, nudge: false, offerAuto: true, pending: [{}, {}], result: { status: 'ok', mode: 'ask', collected: 2 } }]);
  p.local.Conversation = 'agent-1';
  p.local.AgentProvider = 'claude';
  p.local.AgentModel = 'default';
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: false, nudge: true, pending: [] }, 0);
  assert.equal(p.local.Messages.length, 0, 'no nudge without errors');
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: false, nudge: true, pending: [] }, 2, true);
  assert.equal(p.local.Messages.length, 0, 'no nudge on reopen');
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: false, nudge: true, pending: [] }, 2);
  const nudge = p.local.Messages[0];
  assert.equal(nudge.variant, 'nudge');
  assert.match(nudge.message, /^Ce tour a rencontré 2 erreur\(s\) d'outil\. Les partager/);
  assert.deepEqual(Array.from(nudge.actions, a => a.id), ['ask', 'report', 'later']);
  p.onFeedbackCta(nudge, nudge.actions[0]);
  await settle();
  assert.deepEqual(p.calls, [{ action: 'mode', mode: 'ask', threadid: 'agent-1', provider: 'claude', model: 'default' }]);
  assert.match(nudge.message, /Les 2 erreur\(s\) de ce tour sont prêtes/);
  assert.deepEqual(Array.from(nudge.actions, a => a.id), ['send', 'review']);
  // "Report this turn" puts /signaler in the draft.
  const report = page('fr');
  report.onFeedbackCta({ type: 'feedback', actions: [] }, { id: 'report' });
  assert.equal(report.published[0][1].text, '/signaler ');
  // The reminder of review mode offers "always share".
  const ask = page('fr');
  ask.offerFeedback({ status: 'ok', available: true, mode: 'ask', offerAuto: true, pending: [{}] }, 0);
  assert.deepEqual(Array.from(ask.local.Messages[0].actions, a => a.id), ['send', 'review', 'auto']);
  // After a manual send: switch to automatic, or keep reviewing for a month.
  const sent = page('fr', [{ status: 'ok', available: true, mode: 'ask', offerAuto: true, pending: [], result: { status: 'ok', accepted: 2, rejected: [] } },
    { status: 'ok', available: true, mode: 'ask', offerAuto: false, pending: [], result: { status: 'ok', snoozedUntil: 1 } }]);
  const card = { type: 'feedback', variant: 'pending', actions: [{ id: 'send' }] };
  sent.onFeedbackCta(card, card.actions[0]);
  await settle();
  assert.equal(card.message, '2 rapport(s) envoyé(s). Les prochains peuvent partir tout seuls à la fin de chaque tour, masqués comme ceux-ci.');
  assert.deepEqual(Array.from(card.actions, a => a.id), ['auto', 'keep']);
  sent.onFeedbackCta(card, card.actions[1]);
  await settle();
  assert.deepEqual(sent.calls[1], { action: 'later', topic: 'auto' });
  assert.match(card.message, /^D'accord, vous gardez la relecture/);
});

// A server: each signed-in user has a store of their own (F._storeFor), and the server's feedback key replaces the
// Studio's Tigo key.
function server(options = {}) {
  const sandbox = {};
  vm.runInNewContext(SOURCE, sandbox);
  const F = sandbox.C8O.assistantFeedback;
  const stores = {};
  const posts = [];
  let id = 0;
  const clock = { now: Date.UTC(2026, 9, 22, 10, 0, 0) };
  F._storeFor = userKey => {
    if (stores[userKey]) return stores[userKey];
    const store = stores[userKey] = {
      userKey, settings: {}, pending: new Map(), incoming: [], sent: [], names: [], writes: 0,
      studio: () => false,
      serverKey: () => options.serverKey === undefined ? 'sk-' + 'f'.repeat(43) : options.serverKey,
      reporter: () => crypto.createHmac('sha256', 'server-salt').update(userKey).digest('hex'),
      symbol: name => (options.symbols || {})[name] || '',
      now: () => clock.now,
      uuid: () => 'report-' + String(++id).padStart(4, '0'),
      sha256: text => crypto.createHash('sha256').update(String(text)).digest('hex'),
      projectNames: () => ['C8Oforms_tenant'],
      stack: (provider, model) => ({ assistant: '1.6.0', bridge: '0.4.27', mcp: '0.2.27', studio: '8.4.7', provider: provider || '', model: model || '', channel: 'release' }),
      readSettings: () => store.settings,
      writeSettings: value => { store.settings = value; },
      listPending: () => [...store.pending.values()].map(r => JSON.parse(JSON.stringify(r))).sort((a, b) => a.reportId.localeCompare(b.reportId)),
      savePending: report => { store.pending.set(report.reportId, JSON.parse(JSON.stringify(report))); },
      removePending: reportId => { store.pending.delete(reportId); },
      listIncoming: () => store.incoming.map(item => ({ ...item })),
      removeIncoming: name => { store.incoming = store.incoming.filter(item => item.__file !== name); },
      readSent: () => store.sent,
      writeSent: value => { store.sent = value; },
      readNames: () => store.names,
      writeNames: value => { store.names = value; store.writes++; },
      readKey: () => store.serverKey(),
      post: fields => {
        posts.push({ userKey, fields });
        if (options.answer) return options.answer(fields);
        return { response: { status: 'ok', accepted: JSON.parse(fields.reports).map(r => r.reportId), rejected: [] } };
      }
    };
    return store;
  };
  return { F, stores, posts, clock };
}

test('on a server each user has their own consent and reports, once the server feedback key is installed', () => {
  const { F, stores, posts } = server();
  const jane = F.forUser('jane_acme.fr--1111111111111111');
  const paul = F.forUser('paul_acme.fr--2222222222222222');
  assert.equal(jane.available(), true);
  assert.equal(jane.status().invite, true);
  assert.equal(jane.setMode('ask').status, 'ok');
  assert.equal(jane.mode(), 'ask');
  assert.equal(paul.mode(), 'off', 'one user\'s choice is not another\'s');
  jane.collectToolError({ tool: 'Convertigo_nocode-form-edit', message: 'Unknown component in form', provider: 'convertigo', model: 'glm-5-3', surface: 'nocode' });
  paul.collectToolError({ tool: 'Convertigo_nocode-form-edit', message: 'Unknown component in form' });
  assert.equal(stores['jane_acme.fr--1111111111111111'].pending.size, 1);
  assert.equal(stores['paul_acme.fr--2222222222222222'].pending.size, 0);
  const pending = jane.pending();
  assert.equal(pending[0].stack.surface, 'nocode');
  assert.match(pending[0].reporter, /^[a-f0-9]{64}$/);
  assert.notEqual(pending[0].reporter, stores['paul_acme.fr--2222222222222222'].reporter(), 'each user has their own pseudonym');
  assert.equal(jane.send().accepted, 1);
  assert.equal(posts[0].fields.apiKey, 'sk-' + 'f'.repeat(43));
  assert.equal(JSON.parse(posts[0].fields.reports)[0].reporter, pending[0].reporter, 'what the user reviewed is what is sent');
  // Without the server key nothing shows; the default object of a server (no user) never has feedback.
  assert.equal(server({ serverKey: '' }).F.forUser('jane_acme.fr--1111111111111111').status().available, false);
  const bare = server();
  bare.F._store = bare.F._storeFor('');
  assert.equal(bare.F.available(), false);
});

test('a server report says its surface; a Studio report has no pseudonym', () => {
  const { F } = feedback({ settings: { mode: 'ask' } });
  F.collectRuntimeError({ provider: 'vibe', message: 'boom' });
  F.collectRuntimeError({ provider: 'vibe', message: 'other', surface: 'nocode' });
  F.collectRuntimeError({ provider: 'vibe', message: 'third', surface: 'tablet' });
  const pending = F.pending();
  assert.deepEqual(pending.map(r => r.stack.surface), ['studio', 'nocode', 'studio']);
  assert.ok(pending.every(r => r.reporter === undefined));
  const { F: S } = server();
  const user = S.forUser('jane_acme.fr--1111111111111111');
  user.setMode('ask');
  user.collectRuntimeError({ provider: 'convertigo', message: 'gateway 502' });
  assert.equal(user.pending()[0].stack.surface, 'nocode');
});

test('masking: no-code names, host names and ids; generic words and public services stay readable', () => {
  const { F } = feedback();
  const others = ['Demande de congés', 'Coordonnées', 'Clients VIP', 'Email', 'nocode-form-get', '42'];
  const text = F.redact('La page coordonnées du formulaire Demande de congés lit la table clients vip de acme-forms.example.com, id 3f2b9c1e-8d4a-4b6f-9e2d-1a2b3c4d5e6f, champ Email; '
    + 'java.net.UnknownHostException: llm.convertigo.com; voir README.md et agent_feedback.js', [], others);
  assert.equal(text, 'La page <name> du formulaire <name> lit la table <name> de <host>, id <id>, champ Email; '
    + 'java.net.UnknownHostException: llm.convertigo.com; voir README.md et agent_feedback.js');
  assert.equal(F.redact('test-nocode.convertigo.net answered 502'), '<host> answered 502');
  // An error template of a no-code tool: the same error on another form counts once.
  assert.equal(F.template('Field Code client not found in table Clients VIP', [], ['Code client', 'Clients VIP']),
    F.template('Field Montant not found in table Commandes', [], ['Montant', 'Commandes']));
  assert.equal(F.usableName('Text'), '');
  assert.equal(F.usableName('  Demande   de congés '), 'Demande de congés');
  assert.equal(F.usableName('nocode-baserow-catalog-list'), '');
  assert.equal(F.usableName('2026-10-22'), '');
});

test('the names a no-code tool result shows are found, even in JSON within JSON or a cut result', () => {
  const { F } = feedback();
  const form = { title: 'Demande de congés', pages: [{ title: 'Coordonnées', components: [{ key: 'nomClient', label: 'Nom du client', type: 'textfield' }, { key: 'submit', label: 'Submit' }] }] };
  const result = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(form) }] });
  assert.deepEqual(Array.from(F.namesIn(F.resultText(result))), ['Demande de congés', 'Coordonnées', 'nomClient', 'Nom du client']);
  const catalog = '{"databases":[{"name":"CRM Acme","tables":[{"name":"Clients VIP","fields":[{"name":"Code client"},{"name":"Email"}]}]}],"next":"{\\"name\\":\\"Commandes 2026';
  assert.deepEqual(Array.from(F.namesIn(catalog)), ['CRM Acme', 'Clients VIP', 'Code client']);
});

test('a server user\'s names are kept for masking only when feedback can be sent, and mask their reports', () => {
  const { F, stores } = server();
  const jane = F.forUser('jane_acme.fr--1111111111111111');
  jane.setMode('ask');
  assert.equal(jane.rememberNames(['Demande de congés', 'text', 'Coordonnées', 'Demande de congés']), 2);
  assert.equal(jane.rememberNames(['coordonnées']), 0, 'case-insensitive');
  jane.collectToolError({ tool: 'Convertigo_nocode-form-edit', message: 'Page Coordonnées of form "x" has no component nomClient' });
  jane.userReport({ comment: 'Le formulaire demande de congés ne se publie pas', surface: 'nocode' });
  const sent = JSON.stringify(jane.pending());
  assert.ok(!/Coordonn|cong/i.test(sent), sent);
  assert.equal(stores['jane_acme.fr--1111111111111111'].writes, 1);
  // Off by the administrator, or no server key: nothing is kept.
  const off = server({ symbols: { 'assistant.feedback.policy': 'off' } });
  assert.equal(off.F.forUser('paul').rememberNames(['Clients VIP']), 0);
  const nokey = server({ serverKey: '' });
  assert.equal(nokey.F.forUser('paul').rememberNames(['Clients VIP']), 0);
  // Turned on from a failed turn: the names of that turn's no-code results mask its errors.
  const later = server().F.forUser('lea');
  later.setMode('ask');
  const events = [
    { type: 'tool', toolName: 'Convertigo_nocode-form-get', status: 'completed', detail: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ title: 'Inscription Gala' }) }] }) },
    { type: 'tool', toolName: 'Convertigo_nocode-form-edit', status: 'failed', detail: 'Form Inscription Gala is locked' }
  ];
  assert.equal(later.collectTurn(events, 'convertigo', 'glm-5-3', 'nocode'), 1);
  assert.equal(later.pending()[0].finding.template, 'Form <name> is locked');
});

test('an administrator who imposes the automatic mode: each user is told once', () => {
  const { F } = server({ symbols: { 'assistant.feedback.policy': 'auto' } });
  const jane = F.forUser('jane');
  assert.equal(jane.status().notice, true);
  assert.equal(jane.status().invite, false);
  assert.equal(jane.run({ action: 'seen' }).notice, false);
  assert.equal(F.forUser('paul').status().notice, true);
  assert.equal(server().F.forUser('jane').status().notice, false, 'nothing to tell when the user chooses');
});

test('on a server the automatic mode sends one user\'s reports at most every ten minutes', () => {
  const { F, posts, clock } = server({ symbols: { 'assistant.feedback.policy': 'auto' } });
  const jane = F.forUser('jane');
  jane.collectRuntimeError({ provider: 'convertigo', message: 'gateway 502' });
  assert.equal(jane.flush().accepted, 1);
  jane.collectRuntimeError({ provider: 'convertigo', message: 'gateway 504' });
  assert.equal(jane.flush().waiting, true);
  assert.equal(posts.length, 1);
  clock.now += 10 * 60 * 1000;
  assert.equal(jane.flush().accepted, 1);
  // The server key's hourly limit: the reports wait for the next turn after the gap.
  const limited = server({ symbols: { 'assistant.feedback.policy': 'auto' }, answer: () => ({ response: { status: 'error', code: 'rate_limited' } }) });
  const paul = limited.F.forUser('paul');
  paul.collectRuntimeError({ provider: 'convertigo', message: 'x' });
  assert.equal(paul.flush().code, 'rate_limited');
  assert.equal(paul.pending().length, 1);
  assert.equal(paul.flush().waiting, true);
});

test('the page: an imposed automatic mode is told once, a rate limit keeps the reports, nothing says "Studio only"', async () => {
  const p = page('fr', [{ status: 'ok', available: true, mode: 'auto', locked: true, notice: false, pending: [], result: { status: 'ok' } }]);
  p.offerFeedback({ status: 'ok', available: true, mode: 'auto', locked: true, notice: true, pending: [] }, 0);
  assert.equal(p.local.Messages.length, 1);
  const notice = p.local.Messages[0];
  assert.equal(notice.variant, 'notice');
  assert.match(notice.message, /^Votre administrateur partage avec Convertigo/);
  p.offerFeedback({ status: 'ok', available: true, mode: 'auto', locked: true, notice: true, pending: [] }, 0);
  assert.equal(p.local.Messages.length, 1, 'one notice');
  p.onFeedbackCta(notice, notice.actions[0]);
  await settle();
  assert.deepEqual(p.calls, [{ action: 'seen' }]);
  assert.equal(notice.actions.length, 0);
  assert.match(notice.message, /^Votre administrateur/);
  assert.match(p.feedbackErrorText('rate_limited'), /^Trop d'envois/);
  for (const language of ['fr', 'en', 'it', 'es']) {
    assert.doesNotMatch(page(language).agentFeedbackText('unavailable'), /Studio/);
    assert.match(page(language).agentFeedbackText('inviteText'), /formulai|form|modulo/);
  }
});

test('AgentFeedback and the turn hooks find a server user from the session, never from the page', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '..', '_c8oProject', 'sequences', 'AgentFeedback.yaml'), 'utf8');
  assert.match(yaml, /if\(studio&&admin\)\{include\("js\/agent_feedback\.js"\);feedback=C8O\.assistantFeedback;\}/);
  assert.match(yaml, /var userKey=C8O\.assistantAgentBridge\.feedbackUserKey\(\);\n\s+if\(userKey\.length\)\{feedback=C8O\.assistantFeedback\.forUser\(userKey\);\}/);
  assert.doesNotMatch(yaml, /forUser\([^)]*userId/);
  const made = [];
  const sandbox = {
    C8O: { assistantFeedback: { forUser: key => { made.push(key); return { user: key }; } } },
    Engine: { isStudioMode: () => false },
    trim: value => String(value ?? '').trim(),
    include: () => {}
  };
  vm.runInNewContext(backendParts(['feedbackModule']), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.feedbackModule({ userKey: 'alice_example.com--1234' }))), { user: 'alice_example.com--1234' });
  assert.equal(sandbox.feedbackModule({ userKey: '' }), null);
  assert.equal(sandbox.feedbackModule({ userKey: 'studio' }), null, 'a server never writes the Studio\'s store');
  sandbox.Engine.isStudioMode = () => true;
  assert.equal(sandbox.feedbackModule({ userKey: 'alice_example.com--1234' }), sandbox.C8O.assistantFeedback);
  assert.deepEqual(made, ['alice_example.com--1234']);
});
