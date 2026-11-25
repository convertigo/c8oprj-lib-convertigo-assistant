// Lot 5 of the panel redesign: pinned conversations first, archived ones out of the list until the Archived filter, the
// marks kept in the conversation record (AgentMarkConversation), the list beside the conversation on wide panels.
// node --test tests/assistant_panel_wide_marks.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const client = read('js/agent_bridge_client.js');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, globals = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = { ...globals };
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
const slice = (from, to) => {
  const start = page.indexOf(from);
  assert.ok(start > 0, from);
  const end = page.indexOf(to, start + from.length);
  return plain(page.slice(start, end > start ? end : page.length));
};
const DAY = 86400000, NOW = Date.now();
const list = () => [
  { conversationId: 'old', title: 'Old', updatedAt: NOW - 3 * DAY },
  { conversationId: 'new', title: 'New', updatedAt: NOW },
  { conversationId: 'pin', title: 'Pinned', updatedAt: NOW - 5 * DAY, pinned: true },
  { conversationId: 'arc', title: 'Archived', updatedAt: NOW - DAY, archived: true }
];

test('pinned conversations come first under their label, archived ones only under the Archived filter', () => {
  const p = methods(['getHistoryItems', 'historyText', 'historyDayLabel', 'historyArchivedCount', 'toggleHistoryArchived']);
  p.agentUiLanguage = () => 'fr';
  p.isEmbeddedInC8Oforms = () => false;
  p.historyCurrentProject = () => '';
  p.tick = () => {};
  p.local = { AgentConversations: list() };
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['pin', 'new', 'old']);
  assert.equal(p.historyDays.pin, 'Épinglées');
  assert.ok(p.historyDays.new && p.historyDays.new !== 'Épinglées', 'the others keep their day');
  assert.equal(p.historyArchivedCount(), 1);
  p.toggleHistoryArchived();
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['arc']);
  p.toggleHistoryArchived();
  p.local.AgentConversations[1].pinned = true;
  p.local.HistoryMarksVersion = 1;
  assert.deepEqual(p.getHistoryItems().map(c => c.conversationId), ['new', 'pin', 'old'], 'a new mark changes the list at once');
});

test('the latest conversations of the home screens leave archived ones out and put pinned ones first', () => {
  const p = methods(['getFormsHistoryItems']);
  p.isFormsRecentHistory = () => true;
  p.local = { AgentConversations: list() };
  assert.deepEqual(p.getFormsHistoryItems().map(c => c.conversationId), ['pin', 'new', 'old']);
});

test('a mark shows at once, is kept by AgentMarkConversation and comes back when the call fails', async () => {
  const calls = [];
  let answer = Promise.resolve({ result: { ok: true, status: 'marked' } });
  const p = methods(['markConversation']);
  p.local = {};
  p.tick = () => {};
  p.getAgentContextUserId = () => 'studio';
  p.c8o = { callJsonObject: (name, params) => { calls.push([name, params]); return { async: () => answer }; } };
  const c = { conversationId: 'a', provider: 'convertigo' };
  p.markConversation(c, 'pinned');
  assert.equal(c.pinned, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.pinned, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['lib_ConvertigoAssistant.AgentMarkConversation', { threadid: 'a', provider: 'convertigo', userId: 'studio', __context: 'byside', pinned: 'true' }]);
  answer = Promise.reject(new Error('offline'));
  p.markConversation(c, 'archived');
  assert.equal(c.archived, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.archived, false, 'put back');
  assert.equal(p.local.HistoryMarksVersion, 3);
  p.markConversation({}, 'pinned');
  assert.equal(calls.length, 2);
});

function markConversationFunction(stubs) {
  const source = ts.createSourceFile('client.js', client, ts.ScriptTarget.Latest, true);
  let text = '';
  (function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(source) === 'C8O.assistantAgentBridge.markConversation') { text = node.right.getText(source); }
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(text, 'markConversation');
  const context = { ...stubs };
  vm.runInNewContext('this.mark = ' + text + ';', context);
  return context.mark;
}

test('the client keeps the marks in the live state, or in the record of a closed conversation', () => {
  const written = [];
  const base = {
    bridgeCallerRefusal: () => null, withCallerUserId: o => o, normalizeConversationId: v => String(v || ''), trim: v => String(v ?? '').trim(),
    resolveWorkspaceRoot: () => '/ws', normalizeUserKey: () => 'studio', normalizeProvider: v => v, ensureState: s => s,
    conversationRecordFileFor: () => 'record.json', writeJsonFile: (file, record) => written.push(['record', { ...record }]),
    publicConversation: record => ({ conversationId: record.conversationId, pinned: record.pinned === true, archived: record.archived === true })
  };
  const state = { threadid: 't', workspaceRoot: '/ws', userKey: 'studio', provider: 'convertigo' };
  let record = { conversationId: 't' };
  const live = markConversationFunction({ ...base, readState: () => state, saveState: s => written.push(['state', { ...s }]),
    writeConversationRecord: s => { record = { conversationId: 't', pinned: s.pinned === true, archived: s.archived === true }; }, readJsonFile: () => record });
  const result = live({ threadid: 't', pinned: 'true', archived: '' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'marked');
  assert.equal(state.pinned, true);
  assert.equal('archived' in state, false, 'an empty mark keeps its value');
  assert.equal(result.pinned, true);
  const closedRecord = { conversationId: 'c', pinned: true };
  const closed = markConversationFunction({ ...base, readState: () => null, readJsonFile: () => closedRecord });
  assert.equal(closed({ threadid: 'c', archived: 'true', pinned: 'false' }).archived, true);
  assert.deepEqual(written.at(-1), ['record', { conversationId: 'c', pinned: false, archived: true }]);
  const missing = markConversationFunction({ ...base, readState: () => null, readJsonFile: () => null });
  assert.equal(missing({ threadid: 'x', pinned: 'true' }).status, 'not_found');
  assert.equal(missing({ pinned: 'true' }).status, 'not_found');
  assert.match(client, /pinned: state\.pinned === true,\n\s+archived: state\.archived === true\n\s+\};\n\s+writeJsonFile\(new File\(state\.conversationFile\), record\);/, 'the record written from the state keeps the marks');
  assert.match(client, /externalSessionId: String\(record\.externalSessionId \|\| ""\),\n\s+pinned: record\.pinned === true,\n\s+archived: record\.archived === true\n/, 'the list carries them');
});

test('AgentMarkConversation calls the client with the two marks', () => {
  const sequence = read('_c8oProject/sequences/AgentMarkConversation.yaml');
  assert.match(sequence, /C8O\.assistantAgentBridge\.markConversation\(\{/);
  for (const name of ['threadid', 'pinned', 'archived', 'provider', 'userId']) {
    assert.match(sequence, new RegExp('↓' + name + ' \\[variables\\.RequestableVariable-\\d+\\]'), name);
  }
  assert.match(read('c8oProject.yaml'), /↓AgentMarkConversation \[sequences\.GenericSequence\]: 🗏 sequences\/AgentMarkConversation\.yaml/);
});

test('each row pins and archives, the Archived filter shows them, the wide list sits beside the conversation', () => {
  const row = slice('↓MarkButtons [', '\n                  ↓');
  assert.match(row, /\(click\)="markConversation\(conversation, 'pinned'\)"/);
  assert.match(row, /\(click\)="markConversation\(conversation, 'archived'\)"/);
  assert.match(row, /\[name\]="conversation\?\.pinned \? 'pin' : 'pin-outline'"/);
  const filter = slice('↓ArchivedFilter [', '\n                    ↓');
  assert.match(filter, /\*ngIf="historyArchivedCount\(\) > 0 \|\| local\?\.HistoryShowArchived === true"/);
  assert.match(filter, /\(click\)="toggleHistoryArchived\(\)"/);
  const wide = slice('↓WideList [', '\n  ↓SideIf [');
  assert.match(wide, /<aside \*ngIf="isWideListShown\(\)" slot="fixed" class="tigo-wide-list"/, 'fixed beside the thread, as the side column');
  assert.match(wide, /\*ngFor="let c of getHistoryItems\(\)"/);
  assert.match(wide, /\(click\)="resumeFromWideList\(c\)"/);
  const style = slice('↓TigoLot5Style [', '\n↓');
  assert.match(style, /\.tigo-wide-list \{\n\s+display: none;/);
  assert.match(style, /@media \(min-width: 1100px\) \{\n\s+\.tigo-wide-list \{\n\s+display: flex;/);
  assert.match(style, /\.modern-content:has\(\.tigo-wide-list\) \.modern-center\.agent-desktop-center \{\n\s+padding-left: 296px;/);
  const p = methods(['resumeFromWideList']);
  const published = [];
  p.local = { Conversation: 'cur' };
  p.events = { publish: (topic, data) => published.push([topic, data.scope.conversation.conversationId]) };
  p.resumeFromWideList({ conversationId: 'cur' });
  p.resumeFromWideList({ conversationId: 'other' });
  assert.deepEqual(published, [['AgentResumeConversation', 'other']]);
});
