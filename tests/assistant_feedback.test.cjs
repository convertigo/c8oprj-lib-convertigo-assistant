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
    now: () => Date.UTC(2026, 9, 22, 10, 0, 0),
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

const METHODS = ['agentFeedbackText', 'feedbackCommand', 'fillFeedbackCard', 'agentUiLanguage'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function page(language) {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.cards = [];
  p.showFeedbackCard = (action, args) => p.cards.push([action, JSON.parse(JSON.stringify(args))]);
  return p;
}

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
