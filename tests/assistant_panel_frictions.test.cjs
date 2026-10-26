// Frictions a No Code user met in the Tigo panel (test-nocode, 26/10): the "Résumé Convertigo" and "Résumé par défaut"
// buttons compacted the conversation at the first click (three compactions in a minute while looking for something to
// copy), and the first one sent the Low Code handoff (Studio, PROGRESS.md); no message could be copied with one click;
// the dock's context gauge moved by itself (Ionic animates the buffer circles of a bar whose buffer is below 1); the
// suggestions scrolled on one line with a hidden scrollbar, the last one cut at the panel's edge; a Vibe `bash` call
// read "I am using the Convertigo MCP."
// node --test tests/assistant_panel_frictions.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, pageClass } = require('./helpers/assistant-source.cjs');
const root = path.resolve(__dirname, '..');
const pageYaml = fs.readFileSync(path.join(root, '_c8oProject/mobilePages/Page.yaml'), 'utf8');
const footerYaml = fs.readFileSync(path.join(root, '_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml'), 'utf8');

const METHODS = ['compactAgentConversation', 'compactButtonLabel', 'agentUiText', 'agentUiLanguage', 'copyMetricsJson', 'copyAgentMessage', 'agentCopyIcon', 'copyAgentClipboard'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter((m) => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map((m) => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const timers = [];
const copied = [];
const sandbox = {
  setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; },
  clearTimeout: () => {},
  navigator: { clipboard: { writeText: (text) => { copied.push(text); return Promise.resolve(); } } }
};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map((m) => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);

function page(profile, language) {
  const view = new sandbox.View();
  const sent = [];
  view.global = { currentLanguage: () => language || 'fr' };
  view.local = {};
  view.tick = () => {};
  view.getAgentSkillProfile = () => profile;
  view.chatfooter = { setQuestionText: (text) => sent.push(text), submitQuestionFromUI: () => sent.push('<submit>') };
  return { view, sent };
}

test('a compaction button asks for a second click, says so, and forgets it after 6 s', () => {
  const { view, sent } = page('');
  assert.equal(view.compactButtonLabel('generic'), 'Compacter : résumé de l\'agent');
  view.compactAgentConversation('generic');
  assert.deepEqual(sent, [], 'the first click compacts nothing');
  assert.equal(view.compactButtonLabel('generic'), 'Confirmer la compaction');
  assert.equal(view.compactButtonLabel('convertigo'), 'Compacter : résumé Convertigo', 'only the clicked button changes');
  const disarm = timers[timers.length - 1];
  assert.equal(disarm.ms, 6000);
  disarm.run();
  assert.equal(view.compactButtonLabel('generic'), 'Compacter : résumé de l\'agent');
  view.compactAgentConversation('generic');
  view.compactAgentConversation('convertigo');
  assert.deepEqual(sent, [], 'a click on another button arms that one instead');
  view.compactAgentConversation('convertigo');
  assert.equal(sent.length, 2);
  assert.match(sent[0], /^\/compact Convertigo handoff\. Keep: the Studio/);
  assert.equal(sent[1], '<submit>');
  assert.equal(view.compactButtonLabel('convertigo'), 'Compacter : résumé Convertigo');
});

test('a No Code agent never gets the Low Code handoff, and its button is hidden', () => {
  const { view, sent } = page('nocode');
  view.compactAgentConversation('convertigo');
  view.compactAgentConversation('convertigo');
  assert.deepEqual(sent, ['/compact', '<submit>']);
  const hidden = "'script:(this.getAgentSkillProfile && this.getAgentSkillProfile() === ''nocode'') ? ''agent-context-button agent-hidden'' : ''agent-context-button'''";
  assert.equal(pageYaml.split(hidden).length - 1, 2, 'in the side panel and in the dock');
  assert.equal(pageYaml.split("script:this.compactButtonLabel('convertigo')").length - 1, 2);
  assert.equal(pageYaml.split("script:this.compactButtonLabel('generic')").length - 1, 2);
  assert.equal(pageYaml.split("script:this.compactButtonLabel('custom')").length - 1, 1);
});

test('the labels say that the buttons compact, in the four languages', () => {
  for (const [language, label, confirm] of [['en', 'Compact: agent\'s summary', 'Confirm compaction'], ['it', 'Compatta: riepilogo dell\'agente', 'Conferma la compattazione'], ['es', 'Compactar: resumen del agente', 'Confirmar la compactación']]) {
    const { view } = page('', language);
    assert.equal(view.compactButtonLabel('generic'), label);
    view.compactAgentConversation('generic');
    assert.equal(view.compactButtonLabel('generic'), confirm);
  }
});

test('a question or an answer is copied as written, and its button says so for 2 s', async () => {
  const { view } = page('');
  const answer = { type: 'assistant', msg: '## Formulaire\n\n- **Nom** : texte\n- `Date`' };
  assert.equal(view.agentCopyIcon(answer), 'copy-outline');
  view.copyAgentMessage(answer);
  await Promise.resolve();
  assert.equal(copied[copied.length - 1], answer.msg, 'the Markdown source, not the rendered text');
  assert.equal(answer.copied, true);
  assert.equal(view.agentCopyIcon(answer), 'checkmark-outline');
  assert.equal(view.agentUiText('copiedMessage'), 'Copié');
  const reset = timers[timers.length - 1];
  assert.equal(reset.ms, 2000);
  reset.run();
  assert.equal(answer.copied, false);
  view.copyAgentMessage({ type: 'image', msg: '' });
  assert.equal(copied.length, 1, 'nothing to copy');
  const card = { json: '{"a":1}' };
  view.copyMetricsJson(card);
  await Promise.resolve();
  assert.equal(copied[copied.length - 1], '{"a":1}', 'the metrics card copies through the same helper');
});

test('each user and assistant message has its copy button, hidden when it has no text', () => {
  for (const [name, kind] of [['CopyUserMessage', 'user'], ['CopyAssistantMessage', 'assistant']]) {
    const start = pageYaml.indexOf('↓' + name + ' [');
    assert.ok(start > 0, name);
    const block = pageYaml.slice(start, pageYaml.indexOf('resolve();', start));
    assert.match(block, /tagName: button/);
    assert.ok(block.includes("'script:''agent-copy-message is-" + kind + "'' + (item && item.msg ? '''' : '' agent-hidden'')'"));
    assert.ok(block.includes('"IconName":"script:this.agentCopyIcon(item)"'));
    assert.ok(block.includes("'script:item && item.copied ? this.agentUiText(''copiedMessage'') : this.agentUiText(''copyMessage'')'"));
    assert.ok(block.includes('page.copyAgentMessage(props.stack.root.scope.item);'));
  }
  assert.ok(pageYaml.indexOf('↓CopyUserMessage [') > pageYaml.indexOf('↓UserMessage [ngx.components.UIUseShared-1773100000003]'));
  assert.ok(pageYaml.indexOf('↓CopyAssistantMessage [') > pageYaml.indexOf('↓AssistantMessage [ngx.components.UIUseShared-1773100000008]'));
});

test('the dock gauge hides the moving buffer circles; the suggestions wrap instead of scrolling', () => {
  assert.match(pageYaml, /\.agent-dock-gauge::part\(stream\) \{ display: none; \}/);
  assert.match(pageYaml, /\.agent-context-gauge::part\(stream\) \{ display: none; \}/);
  assert.match(footerYaml, /\.tigo-prompts-row:not\(\[hidden\]\) \{ display:flex!important; flex-wrap:wrap; align-items:center; gap:4px; overflow:visible; \}/);
  assert.doesNotMatch(footerYaml, /\.tigo-prompts-row[^{]*\{[^}]*overflow-x:auto/);
});

test('a Vibe shell or file call reads as a local command, not as the Convertigo MCP', () => {
  const src = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  const start = src.indexOf('  function progressTextForTool(');
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) { end = k + 1; break; }
  }
  const labels = { shell: 'SHELL', tool: 'MCP', projectList: 'LIST', inspect: 'INSPECT', apply: 'APPLY', rename: 'RENAME', save: 'SAVE', execute: 'EXECUTE', logs: 'LOGS', builder: 'BUILDER', palette: 'PALETTE' };
  const progressTextForTool = new Function('labels', 'function lang() { return labels; }\n' + src.slice(start, end) + '\nreturn progressTextForTool;')(labels);
  assert.equal(progressTextForTool({}, 'bash: f=/workspace/x.json; grep -o defaultFrom "$f" | head'), 'SHELL');
  assert.equal(progressTextForTool({}, 'read_file: /workspace/agents/vibe/x/tool-results/a.json'), 'SHELL');
  assert.equal(progressTextForTool({}, 'mcp_Convertigo.nocode_form_contract_get'), 'MCP');
  assert.equal(progressTextForTool({}, 'Convertigo_project-list'), 'LIST');
  assert.equal(progressTextForTool({}, 'bashful-tool'), 'MCP', 'a name that only starts like bash');
});
