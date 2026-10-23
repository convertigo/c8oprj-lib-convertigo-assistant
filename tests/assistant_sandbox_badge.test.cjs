// The sandbox badge: what the agent of the open conversation may do, as the Bridge applied it when its session started
// (status sandbox, Bridge 0.4.28 and later). A Studio session is never limited; a No Code session gets the engine's
// agents.tool_policy where Tigo (Vibe) applies it, confined or not by the kernel (Landlock), and runs unlimited on
// Codex and Claude. The side column (wide) and the status dock (narrow) show it, in the Studio and in C8Oforms.
// node --test tests/assistant_sandbox_badge.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass, backendParts } = require('./helpers/assistant-source.cjs');

const client = read('js/agent_bridge_client.js');
const pageYaml = read('_c8oProject/mobilePages/Page.yaml');

function backend() {
  const sandbox = { trim: v => String(v ?? '').trim() };
  vm.runInNewContext(backendParts(['publicSessionSandbox', 'rememberSessionSandbox', 'rememberCodexSessionFromResult']), sandbox);
  return sandbox;
}

const filesConfined = { scope: 'nocode', policy: 'files', source: 'engine', configured: '', confined: true, landlockAbi: 6 };

test('the conversation keeps the sandbox its Bridge status names, cleaned, and an older Bridge leaves it as it was', () => {
  const b = backend();
  assert.deepEqual({ ...b.publicSessionSandbox(filesConfined) }, filesConfined);
  assert.deepEqual({ ...b.publicSessionSandbox({ scope: 'studio', policy: 'mcp-only', source: 'engine', configured: 'files', confined: true, landlockAbi: 6 }) },
    { scope: 'studio', policy: 'full', source: 'studio', configured: '', confined: false, landlockAbi: 0 }, 'a Studio session is never limited');
  assert.deepEqual({ ...b.publicSessionSandbox({ scope: 'nocode', policy: 'files', source: 'engine', configured: 'files', landlockAbi: 'x' }) },
    { scope: 'nocode', policy: 'files', source: 'engine', configured: '', confined: false, landlockAbi: 0 });
  assert.equal(b.publicSessionSandbox({ scope: 'nocode', policy: 'root' }), null);
  assert.equal(b.publicSessionSandbox(null), null);
  assert.equal(b.publicSessionSandbox('files'), null);

  const state = { provider: 'vibe' };
  b.rememberCodexSessionFromResult(state, { ok: true, state: { sessionId: 's-1', sandbox: { ...filesConfined, extra: 'dropped' } } });
  assert.deepEqual({ ...state.sandbox }, filesConfined);
  b.rememberCodexSessionFromResult(state, { ok: true, state: { sessionId: 's-1' } });
  assert.deepEqual({ ...state.sandbox }, filesConfined, 'an older Bridge says nothing');
  assert.match(client, /sandbox: publicSessionSandbox\(state\.sandbox\),\n\s+setupRequired:/, 'publicState hands it to the page');
});

const METHODS = ['getAgentSandboxView', 'agentSandboxText', 'agentUiLanguage', 'getAgentRunView', 'agentDockTab', 'toggleAgentDock',
  'agentLayoutText', 'worklogTrim', 'formatAgentDuration', 'applyAgentConversationState'];
const pageAst = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
const members = pageAst.statements[0].members.filter(m => m.name && METHODS.includes(m.name.getText(pageAst)));
assert.deepEqual(members.map(m => m.name.getText(pageAst)).sort(), [...METHODS].sort());
const pageSandbox = {};
vm.runInNewContext(ts.transpileModule('class View { ' + members.map(m => m.getText(pageAst)).join('\n') + ' }; this.View = View;',
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, pageSandbox);

function page(language, sandbox, conversation = 't-1') {
  const p = new pageSandbox.View();
  p.global = { currentLanguage: () => language };
  p.isAgentBridgeMode = () => true;
  p.local = { Conversation: conversation, Messages: [], AgentSandbox: sandbox ? { threadid: 't-1', sandbox } : null };
  return p;
}
const badge = (language, sandbox) => page(language, sandbox).getAgentSandboxView();
// values made in the page's context: compared as plain data
const plain = value => JSON.parse(JSON.stringify(value));

test('each policy has its level, icon, label and explanation; the kernel line says whether Landlock confines the agent', () => {
  let view = badge('fr', filesConfined);
  assert.deepEqual([view.level, view.icon, view.label, view.short], ['confined', 'shield-checkmark-outline', 'Fichiers · Landlock 6', 'Fichiers']);
  assert.deepEqual(plain(view.lines), [
    'L\'agent lit et écrit des fichiers dans le dossier de cette conversation seulement : ni shell, ni web.',
    'Le noyau confine l\'agent et tout ce qu\'il lance (Landlock v6).'
  ]);
  assert.equal(view.title, 'Bac à sable de la conversation : Fichiers · Landlock 6\n' + view.lines.join('\n'));

  view = badge('en', { ...filesConfined, policy: 'mcp-only', confined: false, landlockAbi: 0 });
  assert.deepEqual([view.level, view.icon, view.label], ['limited', 'shield-half-outline', 'MCP only']);
  assert.deepEqual(plain(view.lines), ['The agent uses the Convertigo No Code tools only: no shell, no files, no web.',
    'The kernel does not confine the agent on this server (no Landlock): only its configuration limits it.']);

  view = badge('en', { ...filesConfined, policy: 'sandboxed-shell' });
  assert.deepEqual([view.level, view.label], ['confined', 'Confined shell · Landlock 6']);

  view = badge('en', { ...filesConfined, confined: false, landlockAbi: 0, configured: 'sandboxed-shell' });
  assert.equal(view.lines[2], 'Requested by the administrator: Confined shell, not possible without Landlock.', 'the shell asked where the engine cannot confine it');

  view = badge('en', { ...filesConfined, policy: 'full', confined: false });
  assert.deepEqual([view.level, view.icon, view.label], ['open', 'shield-outline', 'Full access']);
  assert.deepEqual(plain(view.lines), ['The administrator gives No Code agents all their tools (shell, files, web), with the server\'s rights.']);

  view = badge('en', { scope: 'nocode', policy: 'full', source: 'harness', configured: '', confined: false, landlockAbi: 6 });
  assert.deepEqual([view.level, view.label], ['open', 'Full access']);
  assert.deepEqual(plain(view.lines), ['The No Code agent policy applies to Tigo (Vibe) only: this agent has all its tools, with the server\'s rights.']);

  view = badge('fr', { scope: 'studio', policy: 'full', source: 'studio', configured: '', confined: false, landlockAbi: 0 });
  assert.deepEqual([view.level, view.label], ['studio', 'Non limité']);
  assert.deepEqual(plain(view.lines), ['Session du Studio : l\'agent a tous ses outils (shell, fichiers, web), avec les droits du Studio.']);
});

test('the four Assistant languages have every text of the badge', () => {
  const keys = ['title', 'hover', 'studio', 'full', 'files', 'mcp-only', 'sandboxed-shell', 'studioLine', 'mcp-onlyLine', 'filesLine',
    'sandboxed-shellLine', 'fullLine', 'harnessLine', 'confinedLine', 'unconfinedLine', 'configuredLine'];
  const en = page('en').agentSandboxText.bind(page('en'));
  for (const language of ['fr', 'it', 'es']) {
    const p = page(language);
    for (const key of keys) {
      const text = p.agentSandboxText(key);
      assert.notEqual(text, key, language + ' ' + key);
      if (/Line$|^hover$/.test(key) || language === 'fr') {
        assert.notEqual(text, en(key), language + ' ' + key + ' is translated');
      }
    }
  }
  assert.equal(page('es', filesConfined).getAgentSandboxView().short, 'Archivos');
  assert.equal(page('it', filesConfined).getAgentSandboxView().label, 'File · Landlock 6');
});

test('the badge belongs to its conversation and keeps one object for change detection', () => {
  assert.equal(page('en', filesConfined, 't-2').getAgentSandboxView(), null, 'another conversation is open');
  assert.equal(page('en', null).getAgentSandboxView(), null);
  const p = page('en', filesConfined);
  assert.equal(p.getAgentSandboxView(), p.getAgentSandboxView());
  p.local.AgentSandbox = { threadid: 't-1', sandbox: { ...filesConfined, policy: 'mcp-only' } };
  assert.equal(p.getAgentSandboxView().short, 'MCP only', 'a new session of the conversation');
});

test('a conversation with a known sandbox keeps the side column and the dock, whose tab falls back on what is shown', () => {
  const p = page('en', filesConfined);
  const view = p.getAgentRunView();
  assert.equal(view.sandbox.short, 'Files');
  assert.equal(view.plan, undefined);
  assert.equal(p.agentDockTab(), 'sandbox', 'the only tab with something to show');
  assert.equal(page('en', null).getAgentRunView(), null, 'nothing to show without plan, usage or sandbox');

  p.local.AgentLastPlanView = { title: 'Plan', done: 0, total: 1, entries: [] };
  assert.equal(p.agentDockTab(), 'plan');
  p.toggleAgentDock('sandbox');
  assert.deepEqual([p.local.AgentDockOpen, p.agentDockTab()], [true, 'sandbox']);
  p.local.AgentSandbox = null;
  assert.equal(p.agentDockTab(), 'plan', 'back to the plan once the sandbox is gone');
});

test('a reopened conversation shows its last known sandbox, and none once no conversation is open', () => {
  const p = page('en', null);
  p.getAgentUsageView = () => null;
  p.getAgentPlanView = () => null;
  p.applyAgentConversationState({ threadid: 't-1', sandbox: filesConfined });
  assert.deepEqual(plain(p.local.AgentSandbox), { threadid: 't-1', sandbox: filesConfined });
  assert.equal(p.getAgentSandboxView().label, 'Files · Landlock 6');
  p.applyAgentConversationState({ threadid: 't-1' });
  assert.equal(p.local.AgentSandbox, null, 'a conversation whose Bridge said nothing');
  p.local.AgentSandbox = { threadid: 't-1', sandbox: filesConfined };
  p.applyAgentConversationState(null);
  assert.equal(p.local.AgentSandbox, null);
});

test('the page shows the badge in the side column, the dock row, a dock tab and its drawer, and follows each answer', () => {
  // the badge node is a child of its parent, before the sibling named
  const lines = pageYaml.split('\n');
  const indent = line => line.search(/\S/);
  const childOf = (parent, child, next) => {
    const start = lines.findIndex(line => line.trimStart().startsWith('↓' + parent + ' [ngx.components.'));
    assert.ok(start >= 0, parent);
    const names = [];
    for (let i = start + 1; i < lines.length && (!lines[i].trim() || indent(lines[i]) > indent(lines[start])); i++) {
      if (indent(lines[i]) === indent(lines[start]) + 2 && lines[i].trimStart().startsWith('↓')) names.push(lines[i].trim().split(' [')[0].slice(1));
    }
    const at = names.indexOf(child);
    assert.ok(at >= 0, child + ' in ' + parent);
    if (next) assert.equal(names[at + 1], next, child + ' before ' + next);
  };
  childOf('Side', 'HasSandbox', 'Slot');
  childOf('DockRow', 'HasDockSandbox', 'DockChevron');
  childOf('DockTabs', 'HasSandboxTab', null);
  childOf('DockDrawer', 'SandboxTabIf', null);
  assert.match(pageYaml, /MobileSmartSourceType: script:'agent-side-card agent-sandbox-card is-' \+ this\.getAgentRunView\(\)\.sandbox\.level/);
  assert.match(pageYaml, /MobileSmartSourceType: script:'agent-dock-sandbox agent-sandbox-chip is-' \+ this\.getAgentRunView\(\)\.sandbox\.level/);
  assert.match(pageYaml, /attrName: title\n\s+attrValue: \n\s+- xmlizable: \n\s+- ↑classname: [^\n]+\n\s+- MobileSmartSourceType: script:this\.getAgentRunView\(\)\.sandbox\.title/);
  assert.match(pageYaml, /page\.toggleAgentDock\('sandbox'\);/);
  assert.match(pageYaml, /script:this\.agentDockTab\(\) === 'sandbox' && this\.getAgentRunView\(\)\.sandbox/);
  assert.match(pageYaml, /if \(state\.threadid && state\.sandbox\) \{\n\s+page\.local\.AgentSandbox = \{ threadid: state\.threadid, sandbox: state\.sandbox \};/);
  for (const level of ['confined', 'limited', 'open', 'studio']) {
    assert.match(pageYaml, new RegExp('\\.agent-sandbox-chip\\.is-' + level + ' \\{'), level);
  }
});
