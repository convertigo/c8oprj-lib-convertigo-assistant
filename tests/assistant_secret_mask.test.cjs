// CRM promo run (Mistral Large 4 through Vibe, 13/11, Assistant 1.6.0-beta.23): the demo account's password
// showed in clear in the Tigo panel from about one minute into the filmed run, long before the final answer the user had
// asked it for: in the tool cards (the variables of requestable-execute, the step variables of seed_demo, the tasks of
// browser-verify and the verifier's report) and in the narration that repeated it ("demo@x.com / <password>").
// js/agent_bridge_client.js now masks secret values where the panel's data is built: the progress events as they are
// recorded, the texts that stream when they are handed to the panel, the history read back.
// node --test tests/assistant_secret_mask.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, backendParts, SECRET_MASK_FUNCTIONS, SECRET_MASK_CONSTANTS } = require('./helpers/assistant-source.cjs');

const client = read('js/agent_bridge_client.js');
const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';
const PWD = 'OrbitDesk-Demo42';
const EMAIL = 'demo@orbitdesk.io';
const clone = value => JSON.parse(JSON.stringify(value));
const leaks = (value, secret = PWD) => JSON.stringify(value).split(secret).length - 1;

function masking(names = [], constants = [], extra = {}) {
  const saved = [];
  const sandbox = Object.assign({
    trim: v => String(v ?? '').trim(),
    now: () => 1000,
    appendRunDetail: (_state, event) => saved.push(clone(event))
  }, extra);
  vm.runInNewContext(backendParts([...SECRET_MASK_FUNCTIONS, ...names], [...SECRET_MASK_CONSTANTS, ...constants]), sandbox);
  sandbox.saved = saved;
  return sandbox;
}

// A java.io.File stand-in over a map of files.
function fakeFiles(files) {
  class FakeFile {
    constructor(parent, name) { this.path = name === undefined ? String(parent) : (parent.path || String(parent)) + '/' + name; }
    getParentFile() { return new FakeFile(this.path.substring(0, this.path.lastIndexOf('/'))); }
    getPath() { return this.path; }
    getCanonicalPath() { return this.path; }
    exists() { return files.has(this.path); }
    toString() { return this.path; }
  }
  return { File: FakeFile, readTextFile: file => files.get(file.path) || '', filePath: file => file.path,
    appendTextFile: (file, text) => files.set(file.path, (files.get(file.path) || '') + text) };
}

function assignedFunction(name) {
  const ast = ts.createSourceFile('bridge.js', client, ts.ScriptTarget.Latest, true);
  let found;
  (function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === name) found = node.right.getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(found, name);
  return found;
}

test('a value named like a password is masked in JSON, escaped JSON, key=value text, markdown, SQL and URLs', () => {
  const m = masking();
  const mask = text => m.maskSecretText({}, text);
  const cases = [
    [JSON.stringify({ requestable: 'OrbitDesk.auth_login', variables: { user: EMAIL, password: PWD } }), PWD],
    [JSON.stringify(JSON.stringify({ seed: { email: EMAIL, password: PWD } })), PWD],
    ['DB_PASSWORD=Hunter-2024 npm start', 'Hunter-2024'],
    ['curl "https://api.example.com/login?user=ann&pwd=Zq9-long-value"', 'Zq9-long-value'],
    ['- **Mot de passe :** `' + PWD + '`', PWD],
    ['- **Password:** `' + PWD + '` (role SALES)', PWD],
    ['motDePasse = "Ete-2026!"', 'Ete-2026!'],
    ["apiKey = 'k3y-1234567890'", 'k3y-1234567890'],
    ['client_secret: abcd1234efgh', 'abcd1234efgh'],
    ['{"accessToken":"tok_123456789"}', 'tok_123456789'],
    ['--password S3cret-cli run', 'S3cret-cli'],
    ["UPDATE users SET password = 'Temp-Pass9' WHERE email = 'a@b.io'", 'Temp-Pass9'],
    ['{"name":"password","className":"variables.StepVariable","properties":{"value":"' + PWD + '"}},{"name":"lang","properties":{"value":"en"}}', PWD],
    ['postgres://orbit:Db-Secret7@db.local:5432/app', 'Db-Secret7'],
    ['Authorization: Bearer abc.def-123456789xyz', 'abc.def-123456789xyz'],
    // an answer streaming: the value is masked before its closing quote arrives
    ['Password: `OrbitDe', 'OrbitDe']
  ];
  for (const [text, secret] of cases) {
    const masked = mask(text);
    assert.equal(leaks(masked, secret), 0, text);
    assert.ok(masked.includes(MASK), text);
  }
  const step = mask(cases[12][0]);
  assert.match(step, /"value":"en"/, 'the other variables keep their values');
  assert.match(mask(cases[0][0]), /"user":"demo@orbitdesk\.io"/, 'the email stays');
  const sql = mask("INSERT INTO users (email, password_hash, role) VALUES ('a@b.io', 'h4sh-value-1', 'ADMIN'), ('c@d.io', 'h4sh-value-2', 'SALES')");
  assert.equal(sql, "INSERT INTO users (email, password_hash, role) VALUES ('a@b.io', '" + MASK + "', 'ADMIN'), ('c@d.io', '" + MASK + "', 'SALES')");
  // inside a JSON string, its line breaks escaped
  const escapedSql = mask(JSON.stringify({ sql: "INSERT INTO accounts (login, pwd)\nVALUES ('demo', 'Pw-77x'), ('ops', NULL)" }));
  assert.equal(leaks(escapedSql, 'Pw-77x'), 0);
  assert.match(escapedSql, /'demo'/);
});

test('names, labels, types, counts, code and paths are not secrets', () => {
  const m = masking();
  const kept = [
    '{"type":"password","name":"password","label":"Password","placeholder":"Your password"}',
    '{"showPassword":false,"passwordMinLength":8,"tokens":1234,"bypass":"yes-please"}',
    'password: string', 'password: this.form.password', 'pwd = request.getParameter', 'password: userPassword',
    'PWD=/Users/me/project', 'lib_UserManager.SignIn(user, password, rememberMe) is the real check',
    'The password field is required.', 'Basic configuration of the app', 'usage: 12000 input tokens',
    'contact: ann@acme.io / SALES', 'jane@acme.io / 555-0134', 'Cannot execute the SQL query. Cause: unexpected token: FOREIGN', 'Contacts show by their name, emails like ' + EMAIL + '.'
  ];
  for (const text of kept) assert.equal(m.maskSecretText({}, text), text, text);
  assert.equal(m.secretKeyName('passwordLabel'), false);
  assert.equal(m.secretKeyName('mot de passe'), true);
  assert.equal(m.secretKeyName('X-Api-Key'), true);
  assert.equal(m.secretKeyName('password_hash'), true);
  assert.equal(m.secretKeyName('tokens'), false);
});

test('a secret seen once is masked wherever the turn repeats it; a plain word or the project name is not followed', () => {
  const m = masking();
  const state = { projectNames: ['OrbitDesk'], primaryProject: 'OrbitDesk' };
  m.maskSecretText(state, JSON.stringify({ requestable: 'lib_UserManager.CreateAccount', variables: { user: EMAIL, password: PWD } }));
  assert.deepEqual(clone(state.secretValues), [PWD]);
  assert.equal(m.maskSecretText(state, 'Demo account `' + EMAIL + '` / `' + PWD + '` (role SALES).'), 'Demo account `' + EMAIL + '` / `' + MASK + '` (role SALES).');
  assert.equal(m.maskSecretText(state, 'I will reuse ' + PWD + ' for the next check.'), 'I will reuse ' + MASK + ' for the next check.');
  assert.equal(m.maskSecretText(state, 'Project OrbitDesk is ready.'), 'Project OrbitDesk is ready.', 'the project name stays');
  assert.equal(m.maskSecretText(state, PWD + '9 is another word'), PWD + '9 is another word', 'only where it stands alone');
  // escaped twice in a sub-agent report, in lower case in a tool's group key
  assert.equal(leaks(m.maskSecretText(state, JSON.stringify(JSON.stringify({ summary: 'signed in with ' + PWD })))), 0);
  assert.equal(leaks(m.maskSecretText(state, 'roles: sales. demo account ' + PWD.toLowerCase()), PWD.toLowerCase()), 0);
  // in place, but never followed: a plain word would be masked everywhere
  assert.equal(m.maskSecretText(state, '"password":"welcome"'), '"password":"' + MASK + '"');
  assert.equal(m.maskSecretText(state, 'welcome back'), 'welcome back');
  // An email and a value after a slash, in a sign-in context, with no key: a fresh turn finds it alone.
  const fresh = {};
  assert.equal(m.maskSecretText(fresh, 'Sign in with ' + EMAIL + ' / Nimbus-77, then open Deals.'), 'Sign in with ' + EMAIL + ' / ' + MASK + ', then open Deals.');
  assert.deepEqual(clone(fresh.secretValues), ['Nimbus-77']);
});

test('a secret cut by a text is held back while it streams and masked before an ellipsis', () => {
  const m = masking();
  const values = [PWD];
  assert.equal(m.maskKnownSecrets('Sign in with ' + EMAIL + ' / OrbitDesk-De', values, 'stream'), 'Sign in with ' + EMAIL + ' / ', 'the next read shows it whole, masked');
  assert.equal(m.maskKnownSecrets('{"task":"Sign in with ' + EMAIL + ' / OrbitDesk-De...', values), '{"task":"Sign in with ' + EMAIL + ' / ' + MASK + '...');
  assert.equal(m.maskKnownSecrets('{"qname":"OrbitDe...', values), '{"qname":"OrbitDe...', 'the leading letters are the project name');
  assert.equal(m.maskKnownSecrets('k-Demo42 is the end of a reasoning cut before it', values, 'start'), MASK + ' is the end of a reasoning cut before it');
  assert.equal(m.maskKnownSecrets('Project OrbitDesk', values, 'stream'), 'Project ', 'held back, not masked');
});

// pushProgressEvent and appendNarrativeEvent with their real helpers.
function recorder() {
  const files = new Map();
  const r = masking(['pushProgressEvent', 'appendNarrativeEvent', 'runDetailEvent', 'markProgressEventsIdle', 'takeStepReasoning',
    'cleanEventText', 'compactLine', 'eventKeyForText', 'isOpaqueCallId', 'readRunDetails', 'runDetailsFile'],
  ['RUN_DETAIL_MAX_DETAIL', 'RUN_DETAIL_MAX_EVENTS'], Object.assign(fakeFiles(files), { normalizeProgressLine: (_state, v) => String(v ?? '') }));
  r.historyFile = () => r.saved.map(line => JSON.stringify(line)).join('\n') + '\n';
  r.files = files;
  return r;
}

test('progress events are masked as they are recorded, in the state and in the run history', () => {
  const r = recorder();
  const state = { provider: 'convertigo', runid: 'run-1', progressEvents: [], projectNames: ['OrbitDesk'] };
  // the narration that says it before the tool call shows it (no key, no email): masked once the call shows it
  r.appendNarrativeEvent(state, 'I will create the demo account with ' + PWD + ' as its password.', 'progress');
  r.pushProgressEvent(state, { key: 'tool:call-1', type: 'tool', text: 'Running a sequence.', title: 'mcp_Convertigo.requestable_execute',
    status: 'completed', input: JSON.stringify({ requestable: 'lib_UserManager.CreateAccount', variables: { user: EMAIL, password: PWD } }),
    detail: JSON.stringify({ result: { user: 'ok' } }), toolName: 'mcp_Convertigo.requestable_execute' });
  r.pushProgressEvent(state, { key: 'subagent:verify-1', type: 'subagent', text: 'Sign in with ' + EMAIL + ' / ' + PWD + '.', title: 'Verifier',
    status: 'running', detail: JSON.stringify({ task: 'Sign in with ' + EMAIL + ' / ' + PWD, thought: 'Typing ' + PWD + ' in the Password field' }) });
  assert.equal(leaks(state.progressEvents), 0);
  assert.equal(state.progressEvents.length, 3);
  assert.ok(state.progressEvents.every(e => e.secretsMasked === true));
  assert.match(state.progressEvents[1].input, /"user":"demo@orbitdesk\.io","password":"\u2022+"/);
  // runs/<runid>.ndjson read back, with no secret known: the narration saved before the secret was known is saved
  // again, masked, in place of its first line
  r.files.set('/w/conv/runs/run-1.ndjson', r.historyFile());
  const history = r.readRunDetails({ conversationFile: '/w/conv/conversation.json' }, 'run-1');
  assert.deepEqual(clone(history.events.map(e => e.type)), ['narrative', 'tool', 'subagent']);
  assert.equal(leaks(history.events), 0);
  assert.match(history.events[0].text, /^I will create the demo account with \u2022{6} as its password\.$/);
  assert.ok(!r.saved.some(line => 'secretValues' in line), 'the secrets never reach the files');
});

test('the turn\'s answer is masked while it streams and at its end, unless the user asked for credentials', () => {
  const m = masking(['isTerminalStatus']);
  const answer = 'Done.\n\n## Demo account\n- **Email:** `' + EMAIL + '`\n- **Password:** `' + PWD + '`';
  const turn = (status, userQuestion) => ({ status, userQuestion, secretValues: [PWD] });
  const asked = 'Build the CRM. Create a demo account and give me its credentials at the end.';
  assert.equal(leaks(m.answerForPanel(turn('in_progress', asked), answer)), 0, 'the narration until the turn ends');
  assert.equal(m.answerForPanel(turn('completed', asked), answer), answer);
  assert.equal(m.answerForPanel(turn('completed', 'Donne-moi le mot de passe du compte de démo.'), answer), answer);
  assert.equal(leaks(m.answerForPanel(turn('completed', 'Make the dashboard header blue.'), answer)), 0);
  assert.match(m.answerForPanel(turn('completed', 'Make the dashboard header blue.'), answer), /demo@orbitdesk\.io/);
  assert.equal(leaks(m.answerForPanel(turn('failed', asked), answer)), 0, 'a failed turn has no answer to keep');
  for (const question of ['identifiants ?', 'the login please', 'mots de passe', 'demo account', 'compte de test', 'credentials']) {
    assert.equal(m.userAsksForCredentials(question), true, question);
  }
  assert.equal(m.userAsksForCredentials('Build a small CRM with companies and deals.'), false);
});

test('the responses the panel reads mask progress, events, live reasoning, plan and warnings, records written before included', () => {
  const m = masking(['progressWithoutAnswer', 'compactLine', 'isTerminalStatus', 'liveReasoning', 'publicState', 'responseForState',
    'responseMessages', 'runDetailEvent', 'turnUnverifiedChanges'], ['RUN_DETAIL_MAX_DETAIL', 'REASONING_LIVE_CHARS'], {
    normalizeSkillProfile: () => 'studio', isResidentProvider: () => false, normalizeProvider: v => v, sanitizeCodexHome: () => '',
    agentCommandsFor: () => [], savedNoCodeContext: () => null, publicSessionSandbox: () => null, normalizeEditProfile: () => ''
  });
  // a state restored from a conversation.json written before the masking
  const state = { threadid: 'agent-1', provider: 'convertigo', status: 'in_progress', runid: 'run-1', userQuestion: 'Give me the credentials.',
    progressLog: 'Creating the account.\nUsing ' + PWD + ' for the demo account.',
    lastStatusText: 'Using ' + PWD + ' for the demo account.',
    progressEvents: [
      { key: 'narrative:Using ' + PWD, type: 'narrative', text: 'Using ' + PWD + ' for the demo account.', title: 'Using ' + PWD + ' for the demo account.' },
      { key: 'tool:call-1', type: 'tool', text: 'Running a sequence.', title: 'mcp_Convertigo.requestable_execute',
        input: '{"requestable":"OrbitDesk.auth_login","variables":{"user":"' + EMAIL + '","password":"' + PWD + '"}}',
        reasoning: { head: 'I sign in with ' + PWD + ' first.', tail: '', chars: 30, omitted: 0 } }
    ],
    answer: 'Signed in as ' + EMAIL + ' with ' + PWD.substring(0, 12),
    reasoningPending: { head: 'The verifier typed ' + PWD + ' and the dashboard', tail: '', chars: 50, startedAt: 1 },
    plan: { entries: [{ content: 'Seed the demo account ' + EMAIL + ' / ' + PWD, status: 'pending' }] },
    warnings: [{ type: 'tool/update', title: 'login with password=' + PWD + ' failed', status: 'failed' }] };
  const response = m.responseForState(state);
  assert.equal(leaks(response), 0);
  assert.equal(leaks(response, PWD.substring(0, 12)), 0, 'the end of the streaming answer, held back');
  assert.match(JSON.stringify(response), /demo@orbitdesk\.io/);
  assert.match(response.AIData.progress, /Using \u2022+ for the demo account/);
  assert.match(response.state.reasoningLive.text, /typed \u2022+ and/);
  assert.equal(response.state.plan.entries[0].status, 'pending');
  assert.equal(leaks(state.plan), 1, 'the plan of the state is not changed, only what is shown');
  // the answer the user asked for, at the end of the turn
  state.status = 'completed';
  state.answer = 'Password: ' + PWD;
  state.reasoningPending = null;
  assert.equal(m.responseForState(state).AIData.explanation, 'Password: ' + PWD);
  assert.equal(m.responseForState(state).AIData.messages[0].msg, 'Password: ' + PWD);
  assert.equal(leaks(m.responseForState(state).AIData.progressEvents), 0);
});

test('the history masks runs recorded before the masking, keeps the user\'s messages and an answer that was asked for', () => {
  const files = new Map();
  const fs = fakeFiles(files);
  const conv = '/w/conv/agent-1';
  files.set(conv + '/transcript.ndjson', [
    { role: 'user', runid: 'r1', content: 'Create a demo account and give me its credentials. Use the password Hunter-2024 for the admin.' },
    { role: 'assistant', runid: 'r1', content: 'Demo account: ' + EMAIL + ' / ' + PWD + '. Admin: admin@orbitdesk.io / Hunter-2024.' },
    { role: 'user', runid: 'r2', content: 'Make the header blue.' },
    { role: 'assistant', runid: 'r2', content: 'Done. ' + PWD + ' still opens the demo account.' }
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  // runs/r1.ndjson as written before the masking
  files.set(conv + '/runs/r1.ndjson', [
    { key: 'narrative:Seeding', type: 'narrative', text: 'Seeding the demo account ' + PWD + '.' },
    { key: 'tool:c1', type: 'tool', title: 'mcp_Convertigo.requestable_execute', input: JSON.stringify({ variables: { user: EMAIL, password: PWD } }) },
    { kind: 'plan', plan: { entries: [{ content: 'Give ' + PWD + ' to the user', status: 'completed' }] } }
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  const m = masking(['transcriptMessages', 'readRunDetails', 'runDetailsFile', 'transcriptTime', 'intValue'], ['RUN_DETAIL_MAX_EVENTS'],
    Object.assign({}, fs, { answerLooksIncomplete: () => false, providerLabel: () => 'Tigo' }));
  const state = { conversationFile: conv + '/conversation.json', transcriptFile: conv + '/transcript.ndjson', runid: 'r3', status: 'completed', provider: 'convertigo' };
  const messages = m.transcriptMessages(state, 50);
  assert.equal(messages.length, 4);
  assert.match(messages[0].msg, /Hunter-2024/, 'the user\'s own message is shown as typed');
  assert.equal(messages[1].msg, 'Demo account: ' + EMAIL + ' / ' + PWD + '. Admin: admin@orbitdesk.io / Hunter-2024.', 'asked for');
  assert.equal(messages[3].msg, 'Done. ' + MASK + ' still opens the demo account.', 'the secret of the earlier run, not asked for here');
  assert.equal(leaks(messages[1].runEvents), 0);
  assert.equal(leaks(messages[1].runPlan), 0);
  assert.match(JSON.stringify(messages[1].runEvents), /demo@orbitdesk\.io/);
});

test('a sub-agent run is masked before its task is cut to the size of its card', () => {
  const lead = 'Sign in with ' + EMAIL + ' / ';
  let pad = '';
  while ((pad + lead).length < 152) pad += 'Check the list. '.charAt(pad.length % 16);
  pad = pad.slice(0, -1) + ' ';
  const task = pad + lead + PWD + ' and read the dashboard.';
  assert.equal(task.indexOf(PWD), 152, 'cut at 160 inside the password');
  const pushed = [];
  const m = masking(['subagentProfileLabel', 'subagentDurationMs', 'subagentEventDetail', 'subagentSteps', 'subagentThought', 'syncSubagentRuns'],
    ['SUBAGENT_LABELS'], { pushProgressEvent: (_state, item) => pushed.push(item) });
  m.C8O = { assistantAgentBridge: { readSubagentRuns: () => [{ runId: 'verify-1', profile: 'verifier', model: 'mistral/mistral-large-4', task,
    startedAt: 1, status: 'running', output: null, activity: [{ kind: 'thought', text: 'Typing the password.', reasoning: 'I fill Password with ' + PWD + '.', at: 2 },
      { text: 'fill #password ' + PWD.substring(0, 130) }] }] } };
  m.syncSubagentRuns({ threadid: 'agent-1', runid: '1000-1', language: 'en', provider: 'convertigo', secretValues: [PWD] });
  assert.equal(pushed.length, 1);
  assert.equal(leaks(pushed, PWD.substring(0, 8)), 0, 'no part of it in the card');
  assert.match(pushed[0].text, /demo@orbitdesk\.io \/ \u2022{6} a/);
});

test('a long reasoning is written masked beside the run, a secret cut between two pieces included', () => {
  const files = new Map();
  const fs = fakeFiles(files);
  const m = masking(['appendReasoningChunk', 'keepFullReasoning', 'flushFullReasoning', 'reasoningFullFile', 'runDetailsFile', 'settleReasoning',
    'finishedReasoning'], ['REASONING_KEEP_HEAD', 'REASONING_KEEP_TAIL', 'REASONING_FULL_MAX', 'REASONING_FULL_FLUSH'], fs);
  const state = { provider: 'convertigo', runid: 'run-1', conversationFile: '/w/conv/agent-1/conversation.json' };
  let text = '';
  for (let i = 0; i < 200; i++) text += 'Step ' + i + ' of the plan reads the pages and checks the list. ' + (i % 3 === 0 ? 'Then sign in, password: ' + PWD + ' and ' : '');
  for (let at = 0; at < text.length; at += 37) m.appendReasoningChunk(state, text.substring(at, at + 37), false);
  const finished = m.settleReasoning(state);
  const written = files.get('/w/conv/agent-1/runs/run-1.reasoning/r1.txt');
  assert.ok(finished.full, 'written whole beside the run');
  assert.equal(leaks(written), 0);
  assert.ok(text.length > 12000 && leaks(text) === 67);
  assert.equal(written.split(MASK).length - 1, 67, 'every occurrence, whatever piece it fell in');
  assert.equal(written.replace(/\u2022{6}/g, PWD), text, 'nothing else changed');
  assert.equal(leaks(finished), 0, 'the start and end the step keeps');
});

test('the full reasoning a user opens is masked with the secrets its run names', () => {
  const files = new Map();
  const fs = fakeFiles(files);
  const conv = '/w/conv/agent-1';
  files.set(conv + '/runs/r1.reasoning/r1.txt', 'Now I sign in with ' + PWD + ' and check the dashboard.');
  files.set(conv + '/runs/r1.ndjson', JSON.stringify({ key: 'tool:c1', type: 'tool', input: JSON.stringify({ variables: { password: PWD } }) }) + '\n');
  const m = masking(['readRunDetails', 'runDetailsFile'], ['RUN_DETAIL_MAX_EVENTS'], Object.assign({}, fs, {
    bridgeCallerRefusal: () => null, withCallerUserId: o => o, normalizeThreadId: v => String(v || ''), resolveWorkspaceRoot: () => '/w',
    normalizeUserKey: v => v || 'studio', readConversationRecord: () => ({ conversationDir: conv })
  }));
  vm.runInContext('var reasoningTextEndpoint = ' + assignedFunction('C8O.assistantAgentBridge.reasoningText') + ';', m);
  const result = m.reasoningTextEndpoint({ threadid: 'agent-1', parts: JSON.stringify([{ run: 'r1', f: 'r1' }]) });
  assert.equal(result.texts['r1/r1'], 'Now I sign in with ' + MASK + ' and check the dashboard.');
});

test('the conversation list masks a record\'s preview, progress and events', () => {
  const m = masking(['publicConversation'], [], {
    normalizeProvider: v => v, conversationSkillProfile: () => 'studio', savedNoCodeContext: () => null, normalizeSkillProfile: () => 'studio', normalizeEditProfile: () => '',
    conversationTitleForRecord: r => r.title, isResidentProvider: () => false, sanitizeCodexHome: () => '', readState: () => null
  });
  const record = { conversationId: 'agent-1', title: 'CRM', provider: 'convertigo',
    lastAnswerPreview: '- **Password:** `' + PWD + '`', progress: 'Signing in with ' + PWD + '.',
    progressEvents: [{ key: 'tool:c1', type: 'tool', input: '{"password":"' + PWD + '"}' }, { key: 'narrative:x', type: 'narrative', text: 'Sign-in with ' + PWD + ' works.' }],
    phase: 'Using ' + PWD, warnings: [{ title: 'pwd=' + PWD, status: 'failed' }] };
  const shown = m.publicConversation(record);
  assert.equal(leaks(shown), 0);
  assert.equal(shown.title, 'CRM');
});

test('the masking is written for the engine\'s JavaScript: no lookbehind, named group, arrow function, let, const or template', () => {
  // the code without its comments
  const source = backendParts(SECRET_MASK_FUNCTIONS, SECRET_MASK_CONSTANTS).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(source, /\(\?<[=!]/, 'lookbehind');
  assert.doesNotMatch(source, /\(\?<[A-Za-z]/, 'named group');
  assert.doesNotMatch(source, /\)\s*=>|\b[A-Za-z_$][\w$]*\s*=>/, 'arrow function');
  assert.doesNotMatch(source, /\b(let|const)\s/, 'let or const');
  assert.doesNotMatch(source, /`[^`\n]*\$\{/, 'template literal');
});

test('the page shows conversation texts only as the Assistant\'s sequences hand them, already masked', () => {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  const bridgeCalls = [...page.matchAll(/callJsonObject\(["']+lib_ConvertigoAgentBridge\.(\w+)/g)].map(match => match[1]);
  // The usage card of the conversation: counts and tool names, no argument, no text of the turn.
  assert.deepEqual(bridgeCalls, ['agent_session_metrics']);
  // The progress, events, live reasoning and history of a turn come from the response builders and the history reads.
  for (const name of ['responseForState', 'publicState', 'conversationAIData', 'setStateBuffer']) {
    const start = client.indexOf('  function ' + name + '(');
    const body = client.substring(start, client.indexOf('\n  }\n', start));
    assert.match(body, /panelProgress\(state\)/, name);
    assert.doesNotMatch(body, /progressWithoutAnswer\(|liveReasoning\(state\)|state\.warnings \|\| \[\]\s*[,}]/, name);
  }
});
