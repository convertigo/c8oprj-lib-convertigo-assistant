// Feedback to Convertigo (docs/tigo-feedback.md): consent, masking, counting by fingerprint, the MCP's raw frictions,
// sending to TigoAccess, and the /retours and /signaler commands of the page.
// node --test tests/assistant_feedback.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');

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
    stack: (provider, model) => ({ assistant: '1.5.3', bridge: '0.4.26', mcp: '0.2.26', studio: '8.4.7', provider: provider || '', model: model || '' }),
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
  assert.equal(store.pending.size, 1);
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
  'dropOpenFeedbackCards', 'offerFeedback', 'onFeedbackCta', 'canReportTurn', 'prefillFeedbackReport', 'feedbackSettingNote', 'feedbackSettingChoices'];
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
  assert.match(card.message, /\/retours envoyer/);
  assert.equal(JSON.parse(card.json).length, 2);
  const sent = { rows: [], json: '' };
  p.fillFeedbackCard(sent, { status: 'ok', available: true, mode: 'auto', locked: true, sentCount: 1, pending: [], result: { status: 'ok', accepted: 1, rejected: [] } }, 'send');
  assert.equal(sent.rows[0].value, 'Automatique (imposé par l\'administrateur)');
  assert.match(sent.message, /^1 rapport\(s\) envoyé\(s\)\. Aucun rapport en attente\.$/);
  const offline = { rows: [] };
  p.fillFeedbackCard(offline, { status: 'ok', available: true, mode: 'ask', pending: [{ kind: 'runtime_error', count: 1, finding: { subject: 'vibe', template: 'x' } }], result: { status: 'error', code: 'not_connected' } }, 'send');
  assert.match(offline.message, /^Activez Tigo/);
});

test('after a turn the thread invites once, cites the failed tools, and then reminds of waiting reports only when they grow', () => {
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
  p.offerFeedback({ status: 'ok', available: true, mode: 'off', invite: true, pending: [] }, 0);
  assert.equal(p.local.Messages.length, 1);
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
  later.onFeedbackCta(later.local.Messages[0], { id: 'later' });
  await settle();
  assert.deepEqual(later.calls, [{ action: 'later' }]);
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
