// The changes of a turn left unproven: just before a Vibe turn ends, the Agent Bridge sends the warning
// {phase: "turn/proof", reason: "unverified_changes", items: [{qname, kind}] (15 at most), count, nudged, message} for the
// objects the turn changed through the MCP with no successful proof after their last change. The Assistant keeps it on the
// turn (the state for the answer the page shows at its end, runs/<runid>.ndjson for a reopened conversation) and the page
// shows a discreet line under that answer: "Not verified after the last change: getCategories, Home (and 3 others)", the
// full QNames in the list it opens. No line without the warning (an older Bridge).
// node --test tests/assistant_unverified_changes.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const page = read('_c8oProject/mobilePages/Page.yaml');
const client = read('js/agent_bridge_client.js');

const WARNING = {
  phase: 'turn/proof', reason: 'unverified_changes', count: 5, nudged: true, message: '5 change(s) not proven after their last change',
  items: [
    { qname: 'ReproListes.sq:getCategories', kind: 'backend' },
    { qname: 'ReproListes.MobileApplication.NgxApp.pg:Home', kind: 'ui' },
    { qname: 'ReproListes.sq:setCategory', kind: 'backend' },
    { qname: 'ReproListes/_private/ionic/src/app/custom.ts', kind: 'file' }
  ]
};

// ---- server: the warning kept on the turn -------------------------------------------------------------------------

function server() {
  const files = new Map();
  const reported = [];
  class File {
    constructor(path) { this.path = String(path); }
    exists() { return files.has(this.path); }
  }
  const context = {
    File,
    trim: value => String(value ?? '').trim(),
    readTextFile: file => files.get(file.path) || '',
    runDetailsFile: (state, runid) => new File('runs/' + (runid || state.runid) + '.ndjson'),
    appendRunDetail: (state, value) => {
      const path = 'runs/' + state.runid + '.ndjson';
      files.set(path, (files.get(path) || '') + JSON.stringify(value) + '\n');
    },
    collectFeedbackBridgeWarning: (state, data) => reported.push(data.reason),
    maskRecordedEvents: () => {},
    panelPlan: (holder, plan) => plan,
    answerLooksIncomplete: () => false,
    incompleteFinalAnswer: () => '',
    rememberSecretValues: () => {},
    userAsksForCredentials: () => false,
    maskSecretText: (holder, text) => text,
    transcriptTime: () => '10:00',
    providerLabel: provider => provider,
    intValue: (value, fallback) => fallback
  };
  vm.runInNewContext(backendParts(['rememberBridgeWarning', 'unverifiedChangesOf', 'turnUnverifiedChanges', 'readRunDetails', 'transcriptMessages'],
    ['UNVERIFIED_ITEMS_MAX', 'UNVERIFIED_KINDS', 'RUN_DETAIL_MAX_EVENTS']), context);
  return { context, files, reported };
}

test('the warning is kept on its turn: for the answer at its end, and in the run\'s history', () => {
  const { context, files, reported } = server();
  const state = { runid: 'run-1', provider: 'vibe', status: 'in_progress' };
  context.rememberBridgeWarning(state, WARNING);
  assert.deepEqual(reported, ['unverified_changes'], 'counted in the feedback too');
  assert.deepEqual(plain(context.turnUnverifiedChanges(state)), { items: WARNING.items, count: 5, nudged: true });
  assert.deepEqual(plain(JSON.parse(files.get('runs/run-1.ndjson'))), { kind: 'proof', proof: { items: WARNING.items, count: 5, nudged: true } });
  // The next turn starts without it; the page never shows it under another turn's answer.
  state.runid = 'run-2';
  assert.equal(context.turnUnverifiedChanges(state), null);
  assert.match(client, /state\.warnings = \[\];\n\s+state\.unverifiedChanges = null;/, 'a new turn drops it');
  assert.match(client, /\/\/ The changes of this turn left unproven[^\n]*\n\s+unverified: turnUnverifiedChanges\(state\),\n\s+messages: responseMessages\(state\)/,
    'the answer the page reads at the end of the turn carries it (AIData.unverified)');
  // Another warning of the Bridge leaves the turn as it is.
  const kept = state.unverifiedChanges;
  context.rememberBridgeWarning(state, { phase: 'vibe/mcp', reason: 'mcp_lost_turn_stopped', message: 'stopped' });
  assert.equal(state.unverifiedChanges, kept);
  assert.deepEqual(reported, ['unverified_changes', 'mcp_lost_turn_stopped']);
});

test('what the warning may hold: 15 QNames at most, known kinds, a count never below the list; nothing without changes', () => {
  const { context } = server();
  const many = Array.from({ length: 20 }, (_, i) => ({ qname: 'P.sq:s' + i, kind: i % 2 ? 'ui' : 'weird' }));
  const proof = plain(context.unverifiedChangesOf({ items: many, count: 3, nudged: 'yes' }));
  assert.equal(proof.items.length, 15);
  assert.equal(proof.count, 15, 'at least the listed ones');
  assert.equal(proof.nudged, false, 'only a true nudged');
  assert.deepEqual(proof.items.slice(0, 2), [{ qname: 'P.sq:s0', kind: '' }, { qname: 'P.sq:s1', kind: 'ui' }]);
  assert.deepEqual(plain(context.unverifiedChangesOf({ items: [{ qname: '  P.sq:a\n' }, { qname: '' }, null], count: 40 })),
    { items: [{ qname: 'P.sq:a', kind: '' }], count: 40, nudged: false });
  assert.equal(context.unverifiedChangesOf({ items: [], count: 0 }), null);
  assert.equal(context.unverifiedChangesOf({}), null);
  assert.deepEqual(plain(context.unverifiedChangesOf({ items: [], count: 2 })), { items: [], count: 2, nudged: false }, 'a count alone still tells');
});

test('a reopened conversation gives each answer the unproven changes of its turn', () => {
  const { context, files } = server();
  const state = { runid: 'run-2', provider: 'vibe', status: 'completed', transcriptFile: 'transcript.ndjson' };
  context.rememberBridgeWarning({ runid: 'run-1' }, WARNING);
  files.set('runs/run-1.ndjson', files.get('runs/run-1.ndjson') + JSON.stringify({ key: 'tool:1', type: 'tool', title: 'sequence-run' }) + '\n');
  files.set('transcript.ndjson', [
    { role: 'user', runid: 'run-1', content: 'Ajoute la liste des catégories' },
    { role: 'assistant', runid: 'run-1', content: 'C’est fait.' },
    { role: 'user', runid: 'run-2', content: 'Merci' },
    { role: 'assistant', runid: 'run-2', content: 'Avec plaisir.' }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  const messages = plain(context.transcriptMessages(state, 50));
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[1].unverified, { items: WARNING.items, count: 5, nudged: true });
  assert.equal(messages[1].runEvents.length, 1, 'its work log as before');
  assert.equal(messages[3].unverified, undefined, 'a turn without the warning has no line');
  assert.equal(messages[0].unverified, undefined);
});

// ---- page: the line under the answer ------------------------------------------------------------------------------

const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = {};
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
function panel(language) {
  const p = methods(['unverifiedText', 'unverifiedShortName', 'unverifiedView', 'agentUiLanguage']);
  p.global = { currentLanguage: () => language };
  return p;
}

test('short names: the last segment of a QName without its type prefix, the name of a file', () => {
  const p = panel('fr');
  assert.equal(p.unverifiedShortName('ReproListes.sq:getCategories', 'backend'), 'getCategories');
  assert.equal(p.unverifiedShortName('P.pg:Home', 'ui'), 'Home');
  assert.equal(p.unverifiedShortName('ReproListes.MobileApplication.NgxApp.pg:Home.cp:Button', 'ui'), 'Button');
  assert.equal(p.unverifiedShortName('ReproListes.sq:getCategories.st:jsSource', ''), 'jsSource');
  assert.equal(p.unverifiedShortName('ReproListes/_private/ionic/src/app/custom.ts', 'file'), 'custom.ts');
  assert.equal(p.unverifiedShortName('C:\\workspace\\ReproListes\\js\\lib.js', 'file'), 'lib.js');
  assert.equal(p.unverifiedShortName('ReproListes', 'backend'), 'ReproListes');
});

test('the line: three short names, then how many others, in the four languages; the list gives every QName', () => {
  const item = { type: 'assistant', msg: 'C’est fait.', unverified: WARNING };
  const fr = panel('fr').unverifiedView(item);
  assert.equal(fr.line, 'Non vérifié après la dernière modification : getCategories, Home, setCategory (et 2 autres)');
  assert.deepEqual(plain(fr.items.map(change => [change.name, change.qname, change.kind])), [
    ['getCategories', 'ReproListes.sq:getCategories', 'back-end'],
    ['Home', 'ReproListes.MobileApplication.NgxApp.pg:Home', 'interface'],
    ['setCategory', 'ReproListes.sq:setCategory', 'back-end'],
    ['custom.ts', 'ReproListes/_private/ionic/src/app/custom.ts', 'fichier']
  ]);
  assert.equal(fr.more, 'et 1 autre, non listé', 'the count goes past the list');
  assert.deepEqual(fr.title.split('\n').slice(1), [...WARNING.items.map(change => change.qname), 'et 1 autre, non listé'], 'the tooltip lists every QName');
  assert.equal(panel('en').unverifiedView({ type: 'assistant', unverified: { items: WARNING.items, count: 7 } }).more, 'and 3 more, not listed');
  assert.match(fr.title.split('\n')[0], /^Modifiés pendant ce tour sans preuve/);
  const en = panel('en').unverifiedView({ type: 'assistant', unverified: WARNING });
  assert.equal(en.line, 'Not verified after the last change: getCategories, Home, setCategory (and 2 others)');
  assert.equal(panel('it').unverifiedView({ type: 'assistant', unverified: WARNING }).line, 'Non verificato dopo l’ultima modifica: getCategories, Home, setCategory (e altri 2)');
  assert.equal(panel('es').unverifiedView({ type: 'assistant', unverified: WARNING }).line, 'No verificado tras el último cambio: getCategories, Home, setCategory (y 2 más)');
  // Two changes, nothing more to say; one more, said in the singular.
  const two = { items: WARNING.items.slice(0, 2), count: 2, nudged: false };
  assert.equal(panel('fr').unverifiedView({ type: 'assistant', unverified: two }).line, 'Non vérifié après la dernière modification : getCategories, Home');
  assert.equal(panel('fr').unverifiedView({ type: 'assistant', unverified: two }).more, '');
  const four = { items: WARNING.items, count: 4 };
  assert.equal(panel('en').unverifiedView({ type: 'assistant', unverified: four }).line, 'Not verified after the last change: getCategories, Home, setCategory (and 1 other)');
  // The same short name twice counts as shown once.
  const twins = { items: [{ qname: 'A.pg:Home', kind: 'ui' }, { qname: 'B.pg:Home', kind: 'ui' }, { qname: 'A.sq:x', kind: 'backend' }], count: 3 };
  assert.equal(panel('en').unverifiedView({ type: 'assistant', unverified: twins }).line, 'Not verified after the last change: Home, x');
  // A count without names.
  assert.equal(panel('fr').unverifiedView({ type: 'assistant', unverified: { items: [], count: 3 } }).line, 'Non vérifié après la dernière modification : 3 modifications');
  assert.equal(panel('en').unverifiedView({ type: 'assistant', unverified: { items: [], count: 1 } }).line, 'Not verified after the last change: 1 change');
});

test('no line without the warning, under a user message or for an empty one; the view follows the language', () => {
  const p = panel('fr');
  assert.equal(p.unverifiedView({ type: 'assistant', msg: 'ok' }), null, 'an older Bridge');
  assert.equal(p.unverifiedView({ type: 'assistant', unverified: null }), null);
  assert.equal(p.unverifiedView({ type: 'assistant', unverified: { items: [], count: 0 } }), null);
  assert.equal(p.unverifiedView({ type: 'user', unverified: WARNING }), null);
  assert.equal(p.unverifiedView(null), null);
  const item = { type: 'assistant', unverified: WARNING };
  const first = p.unverifiedView(item);
  assert.equal(p.unverifiedView(item), first, 'cached for the change detection');
  p.global = { currentLanguage: () => 'en' };
  assert.match(p.unverifiedView(item).line, /^Not verified/);
  item.unverified = { items: WARNING.items.slice(0, 1), count: 1 };
  assert.equal(p.unverifiedView(item).line, 'Not verified after the last change: getCategories', 'a new proof, a new view');
});

test('the four languages have the same words', () => {
  const block = page.slice(page.indexOf('public unverifiedText('), page.indexOf('public unverifiedShortName('));
  const keys = language => [...new RegExp('\\b' + language + ': \\{([^\\n]*)\\}').exec(block)[1].matchAll(/(\w+): "/g)].map(m => m[1]);
  assert.deepEqual(keys('fr'), ['lead', 'other1', 'others', 'notListed1', 'notListed', 'change1', 'changes', 'backend', 'ui', 'file', 'hint']);
  for (const language of ['en', 'it', 'es']) {
    assert.deepEqual(keys(language), keys('fr'), language);
  }
});

test('the page: the line sits between the answer and its foot, the answer of a turn and a reopened one carry it', () => {
  const start = page.indexOf('↓UnverifiedIf [');
  assert.ok(start > page.indexOf('↓AssistantMessage [ngx.components.UIUseShared-1773100000008]'), 'after the answer');
  assert.ok(start < page.indexOf('↓AnswerFoot [ngx.components.UIDynamicElement-1795400000101]'), 'before Copy');
  const block = page.slice(start, page.indexOf('↓AnswerFoot [', start));
  assert.match(block, /directiveName: If\n[\s\S]*?MobileSmartSourceType: script:this\.unverifiedView\(item\)\n/);
  assert.match(block, /tagName: details\n/, 'an element the keyboard and screen readers open');
  assert.match(block, /tagName: summary\n[\s\S]*?attrName: '\[attr\.title\]'[\s\S]*?script:this\.unverifiedView\(item\)\.title/);
  assert.match(block, /"IconName":"plain:alert-circle-outline"[\s\S]*?attrName: aria-hidden/, 'the icon is decoration: the words say it');
  assert.match(block, /script:this\.unverifiedView\(item\)\.line/);
  assert.match(block, /directiveItemName: change\n[\s\S]*?script:this\.unverifiedView\(item\)\.items[\s\S]*?script:change\.qname/);
  assert.ok(block.split('\n').every(line => !/:$/.test(line)), 'a key with nested content keeps the space after its colon');
  assert.match(page, /target\.status = "";\n\s+\/\/ The changes the Bridge saw no proof of[^\n]*\n\s+target\.unverified = aiData && aiData\.unverified \? aiData\.unverified : null;/,
    'the answer of a finished turn');
  assert.match(page, /runPlan: msg\.runPlan \|\| null,\n[^\n]*\n\s+unverified: msg\.unverified \|\| null/, 'a reopened conversation');
  // Its style: the amber of a warning mixed with the text color, for the light and dark themes.
  assert.match(page, /\.agent-unverified \{[^}]*color: color-mix\(in srgb, var\(--modern-amber, #d97706\) 55%, var\(--modern-text, #0f172a\) 45%\)/);
  assert.match(page, /\.agent-unverified-summary:focus-visible \{ outline:/);
});
