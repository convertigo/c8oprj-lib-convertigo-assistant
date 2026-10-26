// The Tigo panel passes the MCP's preview captures (nocode-form-preview-capture) to the No Code Studio page that hosts
// it, and brings the page's PNG back to AgentHostRequestResult. A page that cannot capture answers unsupported at once;
// a page whose tab is not shared yet makes the panel show a card, whose click lets the page ask the browser to share.
// node --test tests/assistant_preview_capture_panel.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');
const root = path.resolve(__dirname, '..');
const pageYaml = fs.readFileSync(path.join(root, '_c8oProject/mobilePages/Page.yaml'), 'utf8');

const METHODS = ['forwardAgentHostRequests', 'onPreviewCaptureResult', 'sendPreviewCaptureResult', 'offerPreviewShare', 'onPreviewShareCta',
  'agentPreviewText', 'agentUiLanguage', 'feedbackCard', 'normalizeAgentHostContextValue', 'onFeedbackCta', 'agentFeedbackText', 'toolCallMedia',
  'applyAgentHostContext'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const sandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
function panel({ capabilities = ['preview-capture'], embedded = true } = {}) {
  const view = new sandbox.View();
  const posted = [], calls = [];
  view.global = { currentLanguage: () => 'fr' };
  view.local = { Messages: [{ type: 'assistant', writing: true }], Conversation: 'agent-1' };
  view.agentHostContext = { capabilities };
  view.tick = () => {};
  view.scrollChatBottom = () => {};
  view.isEmbeddedInC8Oforms = () => embedded;
  view.postAgentHostMessage = (message) => { posted.push(JSON.parse(JSON.stringify(message))); return embedded; };
  view.getAgentContextUserId = () => 'gregoryv@convertigo.com';
  view.c8o = { callJsonObject: (name, params) => { calls.push([name, JSON.parse(JSON.stringify(params))]); return { async: () => Promise.resolve({}) }; } };
  return { view, posted, calls };
}
const request = (id, extra) => Object.assign({ requestId: id, kind: 'preview-capture', formId: '1792769924346', formName: 'Congés', page: '2', device: 'mobile' }, extra);

test('a request is passed to the page that declares preview-capture, once', () => {
  const { view, posted, calls } = panel();
  view.forwardAgentHostRequests([request('cap-1')], 'agent-1');
  view.forwardAgentHostRequests([request('cap-1')], 'agent-1');
  assert.deepEqual(posted, [{ type: 'ConvertigoAssistant.preview-capture', payload: { requestId: 'cap-1', formId: '1792769924346', formName: 'Congés', page: '2', device: 'mobile' } }]);
  assert.equal(calls.length, 0);
  view.forwardAgentHostRequests([request('cap-2', { kind: 'other' }), request('', {})], 'agent-1');
  assert.equal(posted.length, 1, 'only preview captures, with an id');
});

test('a page that cannot capture, or no page, answers unsupported at once', () => {
  for (const options of [{ capabilities: [] }, { embedded: false }]) {
    const { view, posted, calls } = panel(options);
    view.forwardAgentHostRequests([request('cap-1')], 'agent-1');
    assert.equal(posted.length, 0);
    assert.deepEqual(calls, [['lib_ConvertigoAssistant.AgentHostRequestResult',
      { threadid: 'agent-1', requestId: 'cap-1', status: 'failed', image: '', reason: 'unsupported', userId: 'gregoryv@convertigo.com' }]]);
  }
});

test('the page\'s PNG goes to AgentHostRequestResult; anything else than a PNG fails the capture', () => {
  const { view, calls } = panel();
  view.forwardAgentHostRequests([request('cap-1'), request('cap-2')], 'agent-1');
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'done', image: PNG });
  view.onPreviewCaptureResult({ requestId: 'cap-2', status: 'done', image: 'data:text/html;base64,PGI+' });
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'done', image: PNG });
  assert.deepEqual(calls.map(([, p]) => [p.requestId, p.status, p.image, p.reason]), [['cap-1', 'done', PNG, ''], ['cap-2', 'failed', '', 'capture_failed']]);
  const failing = panel();
  failing.view.forwardAgentHostRequests([request('cap-3')], 'agent-1');
  failing.view.onPreviewCaptureResult({ requestId: 'cap-3', status: 'failed', reason: 'render_timeout' });
  assert.equal(failing.calls[0][1].reason, 'render_timeout');
});

test('a tab not shared yet: the request waits and one card of the turn asks the user', () => {
  const { view, posted, calls } = panel();
  view.forwardAgentHostRequests([request('cap-1'), request('cap-2')], 'agent-1');
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'waiting_sharing' });
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'waiting_sharing' });
  view.onPreviewCaptureResult({ requestId: 'cap-2', status: 'waiting_sharing' });
  assert.deepEqual(calls.map(([, p]) => [p.requestId, p.status]), [['cap-1', 'waiting_sharing'], ['cap-2', 'waiting_sharing']]);
  const cards = view.local.Messages.filter((m) => m.type === 'feedback');
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.variant, 'preview');
  assert.equal(card.title, 'Aperçu pour Tigo');
  assert.match(card.message, /voir l’aperçu de « Congés »/);
  assert.deepEqual(JSON.parse(JSON.stringify(card.actions)).map((a) => a.label), ['Autoriser l’aperçu', 'Pas maintenant']);
  assert.deepEqual(JSON.parse(JSON.stringify(card.previewRequestIds)), ['cap-1', 'cap-2']);
  view.onFeedbackCta(card, card.actions[0]);
  assert.deepEqual(posted.at(-1), { type: 'ConvertigoAssistant.preview-share.start', payload: { requestIds: ['cap-1', 'cap-2'] } });
  assert.equal(card.actions.length, 0);
  assert.equal(card.message, 'Acceptez le partage de cet onglet dans la fenêtre du navigateur.');
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'done', image: PNG });
  assert.equal(calls.at(-1)[1].status, 'done');
  assert.equal(card.message, 'Aperçu partagé avec Tigo.');
});

test('Pas maintenant declines what waits, and the page drops it', () => {
  const { view, posted, calls } = panel();
  view.forwardAgentHostRequests([request('cap-1')], 'agent-1');
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'waiting_sharing' });
  const card = view.local.Messages.find((m) => m.variant === 'preview');
  view.onFeedbackCta(card, card.actions[1]);
  assert.deepEqual(posted.at(-1), { type: 'ConvertigoAssistant.preview-share.decline', payload: { requestIds: ['cap-1'] } });
  assert.deepEqual(calls.at(-1)[1], { threadid: 'agent-1', requestId: 'cap-1', status: 'failed', image: '', reason: 'declined', userId: 'gregoryv@convertigo.com' });
  assert.equal(card.message, 'D’accord, Tigo continue sans voir l’aperçu.');
  view.onPreviewCaptureResult({ requestId: 'cap-1', status: 'done', image: PNG });
  assert.equal(calls.length, 2, 'a late image of a declined capture is not sent');
});

test('the capture shows as a thumbnail in its call row, with its description', () => {
  const { view, calls } = panel();
  const media = view.toolCallMedia({ rawTitle: 'convertigo_nocode-form-preview-capture', status: 'completed', input: '{"formId":"1","question":"Le bouton est-il visible ?"}',
    detail: '{"status":"captured","captureId":"cap-1","path":"/workspace/agents/vibe/users/g/conversations/agent-1/attachments/preview-1-2-mobile-1.png","width":780,"description":"**Formulaire** Congés"}' });
  assert.equal(media.path, '/workspace/agents/vibe/users/g/conversations/agent-1/attachments/preview-1-2-mobile-1.png');
  assert.equal(media.question, 'Le bouton est-il visible ?');
  assert.equal(media.description, 'Formulaire Congés');
  assert.deepEqual(calls[0], ['lib_ConvertigoAssistant.AgentWorkspaceImage', { path: media.path }]);
  assert.equal(view.toolCallMedia({ rawTitle: 'nocode-form-preview-capture', status: 'completed', detail: '{"status":"unavailable","reason":"no_page"}' }), null);
});

test('the host context keeps what the page can do; the read of the turn and the page\'s answer are wired', () => {
  const { view } = panel();
  for (const name of ['ensureC8OformsEmbeddedStyles', 'applyC8OformsHostLanguage', 'applyC8OformsHostTheme', 'scheduleAgentSettingsRefreshAfterHostContext', 'syncFooterPlaceholder']) {
    view[name] = () => {};
  }
  view.applyAgentHostContext({ embedMode: 'c8oforms', capabilities: ['preview-capture', 7], previewSharing: false });
  assert.deepEqual(JSON.parse(JSON.stringify(view.local.AgentHostContext)), { embedMode: 'c8oforms', previewSharing: false, capabilities: ['preview-capture', '7'] });
  assert.match(pageYaml, /if \(response\.hostRequests && page\.forwardAgentHostRequests\) \{\n\s+page\.forwardAgentHostRequests\(\[\]\.concat\(response\.hostRequests\), state\.threadid \|\| response\.threadid \|\| page\.local\.Conversation\);/);
  assert.match(pageYaml, /if \(type === ''ConvertigoAssistant\.preview-capture\.result''\) \{\n\s+this\.onPreviewCaptureResult\(data\.payload \|\| \{\}\);/);
});
