// The settings screen in the No Code Studio: a user sees the server's agent and keeps their own preferences; an
// administrator of the No Code Studio sets Tigo for every user (AgentServerSettings answers serverSettings.administrator).
// node --test tests/nocode-server-settings-ui.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
// the server sets Tigo (serverSettings.managed: a No Code Studio whose C8Oforms knows the Tigo right)
const MANAGED = "this.local?.AgentSettings?.serverSettings?.managed === true && this.local?.AgentSettings?.serverSettings?.administrator !== true";
const ADMIN = "this.local?.AgentSettings?.serverSettings?.managed === true && this.local?.AgentSettings?.serverSettings?.administrator === true";
const bean = (name) => {
  const start = page.indexOf('↓' + name + ' [');
  assert.ok(start >= 0, name);
  const indent = page.lastIndexOf('\n', start);
  const depth = start - indent - 1;
  const rest = page.slice(start).split('\n');
  const lines = [rest[0]];
  for (const line of rest.slice(1)) {
    if (line.trim() && line.search(/\S/) <= depth) break;
    lines.push(line);
  }
  // the YAML doubles the quotes of a single-quoted value
  return lines.join('\n').replace(/''/g, "'");
};

test('the tabs: no agent, runtime nor MCP tab for a user, a note of who sets them', () => {
  const tabs = bean('SettingsTabs');
  assert.match(tabs, /managed: \(local\?\.AgentSettings\?\.serverSettings\?\.managed === true && local\?\.AgentSettings\?\.serverSettings\?\.administrator !== true\), admin: \(local\?\.AgentSettings\?\.serverSettings\?\.managed === true && local\?\.AgentSettings\?\.serverSettings\?\.administrator === true\)/);
  assert.equal((tabs.match(/<button \*ngIf="!tab\.managed"/g) || []).length, 3, 'agent, runtime, mcp');
  assert.match(tabs, /\['agent', 'runtime', 'mcp'\]\.includes\(local\?\.ResourceAccordion \|\| 'agent'\)\) \? 'prefs'/, 'a user lands on the preferences');
  assert.match(tabs, /<p \*ngIf="tab\.admin" class="tigo-server-scope"/);
  assert.match(tabs, /<p \*ngIf="tab\.managed" class="tigo-server-scope"/);
  assert.match(tabs, /réglé par les administrateurs du No Code Studio/);
});

test('the categories of the administrators are left out for a user, the footer offers no model', () => {
  for (const name of ['AgentCategory', 'RuntimeCategory', 'McpCategory']) {
    const category = bean(name);
    // a structural attribute takes a plain expression: in script mode Mobile Builder writes *ngIf="{{...}}", which
    // Angular refuses (NG5002, build of 1.6.0-beta.4, 05/11)
    assert.ok(category.includes("attrName: '*ngIf'") && category.includes(`plain:!(${MANAGED})`), name);
  }
  assert.doesNotMatch(page, /attrName: '\*ngIf'\n\s+attrValue: \n\s+- xmlizable: \n\s+- ↑classname: [^\n]+\n\s+- MobileSmartSourceType: '?script:/, 'no *ngIf in script mode in the page');
  assert.ok(bean('SettingsCategories').includes(`(${MANAGED} && ['agent', 'runtime', 'mcp'].includes(this.local?.ResourceAccordion || 'agent')) ? 'prefs' : this.local?.ResourceAccordion`));
  for (const name of ['AgentModels', 'AgentReasoningLevels']) {
    const variable = page.slice(page.indexOf('↓' + name + ' [ngx.components.UIUseVariable-'));
    assert.match(variable.slice(0, 600).replace(/''/g, "'"), /serverSettings\.managed === true\) \? \[\] :/, name);
  }
  assert.match(bean('FeedbackSettings'), /this\.local\?\.AgentSettings\?\.serverSettings\?\.managed === true && \(this\.local\?\.AgentSettings\?\.serverSettings\?\.feedbackPolicy \|\| 'user'\) !== 'user'/,
    'the feedback choice of a user only when the server lets each user choose');
});

test('an administrator sets the defaults, the feedback policy and the update channel of the server', () => {
  const prefs = bean('ServerPrefsSettings');
  const runtime = bean('ServerRuntimeSettings');
  for (const block of [prefs, runtime]) {
    assert.ok(block.includes(`!(${ADMIN})`), 'administrators only');
    assert.match(block, /page\.c8o\.callJsonObject\('lib_ConvertigoAssistant\.AgentServerSettings', \{ action: 'save', settings: JSON\.stringify\(settings\) \}\)/);
  }
  assert.match(prefs, /var key = 'writeConfirm';/);
  assert.match(prefs, /var key = 'feedbackPolicy';/);
  assert.match(prefs, /\['off', 'user', 'ask', 'auto'\]/);
  assert.match(runtime, /var key = 'stackChannel';/);
  assert.match(runtime, /page\.refreshAgentStackServerStatus\(\)/);
  assert.match(runtime, /agents\.tool_policy/, 'the confinement, read only');
  assert.doesNotMatch(runtime, /var key = 'toolPolicy'/, 'never saved from the panel');
  assert.match(bean('ContinueButton'), /Enregistrer pour tout le serveur et continuer/);
});
