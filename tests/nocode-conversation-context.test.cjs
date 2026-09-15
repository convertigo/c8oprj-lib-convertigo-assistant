// Read the merged YAML directly; only the installed TypeScript package is required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { blockWith, pageClass } = require('./helpers/assistant-source.cjs');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, '_private/ionic/node_modules/typescript'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pageSource = pageClass();
const sourceFile = source => ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
const run = (source, context = {}) => {
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context;
};
const methods = (source, predicate) => {
  const ast = sourceFile(source), selected = [];
  function visit(n) {
    if (ts.isMethodDeclaration(n) && predicate(n.name.getText(ast), n.getText(ast))) selected.push(n.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast); return selected;
};
const pure = methods(pageSource, name => ['getFormsHistoryText', 'getFormsConversationContext', 'getFormsCatalogContext', 'isFormsRecentHistory', 'getFormsHistoryItems', 'getFormsConversationMeta', 'getFormsContextNotice'].includes(name));
assert.equal(pure.length, 7);
const Page = run('class Page { ' + pure.join('\n') + ' } this.Page = Page;').Page;
function page() {
  const p = new Page();
  p.local = { AgentHostContext: {} };
  p.isEmbeddedInC8Oforms = () => true;
  p.getC8OformsLanguageCode = () => 'fr';
  p.shouldShowAgentSettingsPanel = () => false;
  p.getAgentHostContextObject = () => p.local.AgentHostContext;
  p.formatConversationDate = date => String(date);
  p.tick = p.scrollChatBottom = () => {};
  p.events = { publish: (...args) => p.events.calls.push(args), calls: [] };
  p.notifications = [];
  p.notifyC8OformsFormUpdated = (...args) => p.notifications.push(args);
  return p;
}
function adapter(source, marker) {
  const body = blockWith(source, marker);
  const Probe = run('class Probe { invoke(page, props, vars, event) { return new Promise((resolve, reject) => { ' + body + ' }); } } this.Probe = Probe;', { window: { clearInterval() {} } }).Probe;
  const probe = new Probe();
  return (p, vars) => probe.invoke(p, {}, vars, {});
}
const applyCatalog = adapter('_c8oProject/mobileSharedActions/ApplyNoCodeAssistantCatalog.yaml', 'var catalog = unwrap(vars.response);');
const resume = adapter('_c8oProject/mobilePages/Page.yaml', '// Restore resource identity only.');

test('recent history is scoped, sorted, capped and does not mutate the source list', () => {
  const p = page(); p.local.NoCodeSelectedFormId = 'A';
  p.local.AgentConversations = [1, 2, 3, 4].map(i => ({ conversationId: String(i), updatedAt: i, title: 'Congés ' + i, nocodeContext: { formId: 'A', formName: 'Congés' } }));
  p.local.AgentConversations.push({ conversationId: 'B', updatedAt: 10, title: 'Autre', nocodeContext: { formId: 'B' } }, { conversationId: 'legacy', updatedAt: 11, title: 'Ancienne' });
  assert.equal(p.getFormsHistoryItems().map(c => c.conversationId).join(','), '4,3,2');
  assert.equal(p.local.AgentConversations[0].conversationId, '1');
  p.local.ShowConversationPanel = true;
  assert.equal(p.getFormsHistoryItems().length, 6);
  p.local.FormsHistoryCurrentOnly = true;
  assert.equal(p.getFormsHistoryItems().length, 4);
  p.local.FormsHistoryQuery = 'congés 2';
  assert.equal(p.getFormsHistoryItems()[0].conversationId, '2');
  p.local.FormsHistoryQuery = 'absent'; assert.equal(p.getFormsHistoryItems().length, 0);
  p.local.ShowAgentConfigPanel = true; assert.equal(p.isFormsRecentHistory(), false);
});

test('navigation follows the same app, but does not silently retarget an existing conversation', () => {
  const p = page(); p.local.Conversation = 'c'; p.local.FormsConversationContext = { formId: 'A', formName: 'Congés', pageId: 'p1' };
  const same = { formId: 'A', pageId: 'p2' }, other = { formId: 'B', pageId: 'p3' };
  assert.equal(p.getFormsCatalogContext(same), same);
  assert.equal(p.getFormsCatalogContext(other), p.local.FormsConversationContext);
  p.local.AgentHostContext = other; assert.match(p.getFormsContextNotice(), /Congés/);
  p.local.NewConversationMode = true; assert.equal(p.getFormsCatalogContext(other), other);
  p.local.NewConversationMode = false; p.isEmbeddedInC8Oforms = () => false;
  assert.equal(p.getFormsCatalogContext(other), other); assert.equal(p.getFormsContextNotice(), '');
});

test('resume loads exchanges without replay, and focuses only after ACL-checked catalog response', async () => {
  const p = page(); p.local.AgentHostContext = { formId: 'old' };
  const context = { formId: 'new', formName: 'Demandes', pageId: 'p1', elementId: 'field' };
  await resume(p, { state: { threadid: 'c', status: 'completed', runid: 'old-run', nocodeContext: context, formMutation: { success: true, formId: 'new', completedAt: 100, changed: true } }, data: { messages: [{ type: 'assistant', msg: 'Terminé.' }] } });
  assert.equal(p.local.LastC8OformsMutationNotificationKey, '100:new:old-run');
  assert.equal(p.local.Messages[0].msg, 'Terminé.'); assert.equal(p.notifications.length, 0);
  assert.equal(p.local.FormsResumePending, true);
  assert.equal(p.events.calls[0][0], 'AgentNoCodeContextReload');
  const response = { requestedFormId: 'new', forms: [], selectedForm: { id: 'new', name: 'Demandes' }, pages: [{ id: 'p1', name: 'Saisie' }], elements: [{ id: 'field', name: 'Email', pageId: 'p1' }] };
  await applyCatalog(p, { response, hostContext: context, formId: 'new' });
  assert.equal(p.notifications.length, 1); assert.equal(p.notifications[0][0].changed, false);
  assert.equal(p.notifications[0][0].formId, 'new'); assert.equal(p.notifications[0][0].elementId, 'field');
  assert.equal(p.local.NoCodeSelectedFormId, 'new'); assert.equal(p.local.NoCodeSelectedElementId, 'field');
  assert.equal(p.local.FormsResumePending, false);
});

test('missing page/element falls back safely; denied forms and stale catalogs never navigate', async () => {
  const p = page(); const context = { formId: 'A', pageId: 'gone', elementId: 'gone' };
  Object.assign(p.local, { Conversation: 'c', FormsConversationContext: context, FormsResumePending: true, AgentHostContext: { formId: 'B' } });
  await applyCatalog(p, { response: { requestedFormId: 'B', selectedForm: { id: 'B' } }, hostContext: { formId: 'B' }, formId: 'B' });
  assert.equal(p.notifications.length, 0); assert.equal(p.local.FormsResumePending, true);
  await applyCatalog(p, { response: { requestedFormId: 'A', selectedForm: { id: 'A' }, forms: [], elements: [], pages: [] }, hostContext: context, formId: 'A' });
  assert.equal(p.local.FormsContextPartial, true); assert.equal(p.notifications[0][0].elementId, ''); assert.equal(p.notifications[0][0].pageId, '');
  p.notifications = []; p.local.FormsResumePending = true;
  await applyCatalog(p, { response: { requestedFormId: 'A', selectedForm: null, forms: [] }, hostContext: context, formId: 'A' });
  assert.equal(p.local.FormsContextUnavailable, true); assert.equal(p.notifications.length, 0);
});

test('legacy and failed resumes preserve messages without inventing a resource', async () => {
  const p = page();
  await resume(p, { state: { threadid: 'legacy', status: 'completed' }, data: { messages: [{ msg: 'Historique' }] } });
  assert.equal(p.local.FormsContextMissing, true); assert.equal(p.notifications.length, 0);
  assert.equal(p.getFormsCatalogContext({ formId: 'unrelated' }).formId, undefined);
  await resume(p, { state: {}, data: {} });
  assert.equal(p.local.FormsResumeError, true); assert.equal(p.local.Messages[0].msg, 'Historique');
});

test('persisted/public context contains resource identity only, and Studio has none', () => {
  const source = sourceFile(read('js/agent_bridge_client.js'));
  const names = new Set(['noCodeConversationContext', 'savedNoCodeContext', 'writeConversationRecord', 'publicState', 'publicConversation']);
  const snippets = [];
  function visit(n) { if (ts.isFunctionDeclaration(n) && names.has(n.name?.text)) snippets.push(n.getText(source)); ts.forEachChild(n, visit); }
  visit(source); assert.equal(snippets.length, names.size);
  let record;
  const ctx = run(snippets.join('\n'), {
    trim: v => String(v ?? '').trim(), normalizeSkillProfile: s => s.skillProfile || 'studio', normalizeProvider: v => v || 'codex',
    conversationTitleFromText: v => v || '', conversationTitleForRecord: r => r.title || '', conversationSkillProfile: r => r.skillProfile,
    sanitizeCodexHome: () => '', isResidentProvider: () => true, readJsonFile: () => null,
    now: () => 100, File: function(p) { this.path = p; }, writeJsonFile: (_, r) => { record = r; }, readState: () => null
  });
  const state = { conversationFile: 'fixture', skillProfile: 'nocode', hostFormContext: { formId: 'A', formName: 'Congés', pageId: 'p', token: 'secret', hostOrigin: 'private', currentUrl: 'private' } };
  ctx.writeConversationRecord(state);
  assert.equal(record.nocodeContext.formId, 'A'); assert.equal(record.nocodeContext.pageId, 'p');
  assert.doesNotMatch(JSON.stringify(record.nocodeContext), /secret|private|hostOrigin|token/);
  assert.equal(ctx.publicState(state).nocodeContext.formId, 'A'); assert.equal(ctx.publicConversation(record).nocodeContext.formId, 'A');
  state.skillProfile = 'studio'; assert.equal(ctx.publicState(state).nocodeContext, null);
});
