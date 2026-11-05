// Settings page as tabs (docked Studio panel) or a side list (maximized): one section at a time, each tab shows its state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '_c8oProject/mobilePages/Page.yaml'), 'utf8');

const block = (from, to) => {
  const start = page.indexOf(from);
  assert.ok(start > 0, from);
  // Without an end marker the block runs to the end of the page (the last style of the page).
  const end = to ? page.indexOf(to, start) : page.length;
  assert.ok(end > start, to);
  // YAML single-quoted scalars double the single quotes of the templates.
  return page.slice(start, end).replace(/''/g, "'");
};

test('the tabs come first in the settings and open sections through the accordion change handler', () => {
  const settings = block('↓CreateSettings [', '↓SettingsCategories [');
  const tabs = settings.slice(settings.indexOf('↓SettingsTabs ['));
  assert.ok(settings.indexOf('↓SettingsTabs [') < settings.indexOf('↓ResourceSearch ['), 'tabs before the library toolbar');
  for (const section of ['agent', 'prefs', 'runtime', 'prompts', 'skills', 'mcp']) {
    assert.match(tabs, new RegExp("onTigoResourcesAccordionChange\\(\\{target: \\{tagName: 'ION-ACCORDION-GROUP'\\}, detail: \\{value: '" + section + "'\\}\\}\\)"), section);
  }
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /\[attr\.aria-selected\]="tab\.section === 'agent'"/);
  assert.match(tabs, /class="tigo-library-tabs"/);
});

test('each tab shows the state of its section', () => {
  const tabs = block('↓SettingsTabs [', '↓ResourceSearch [');
  assert.match(tabs, /getAgentProviderLabel\(\)/);
  assert.match(tabs, /getAgentModelLabel\(\)/);
  assert.match(tabs, /getAgentReasoningLabel\(\)/);
  assert.match(tabs, /getAgentRevealMode\(\)/);
  assert.match(tabs, /agentFeedbackText\(feedbackSettingMode\(\)\)/);
  assert.match(tabs, /isAgentStackUpdateAvailable\(\)/);
  assert.match(tabs, /getAgentStackChannel\(\) === 'preview'/);
  assert.match(tabs, /local\?\.ResourcePromptItems\?\.length/);
  for (const word of ['Pr\u00e9f\u00e9rences', 'Preferenze', 'Preferencias', 'Preferences', 'Biblioth\u00e8que', 'Libreria', 'Biblioteca', 'Library']) {
    assert.ok(tabs.includes(word), word);
  }
});

test('Reveal, feedback and confirm-before-modifying live in the Preferences category', () => {
  const agent = block('↓AgentCategory [', '↓PrefsCategory [');
  const prefs = block('↓PrefsCategory [', '↓RuntimeCategory [');
  assert.match(prefs, /Value: plain:prefs|"Value":"plain:prefs"/);
  for (const name of ['RevealSettings1', 'FeedbackSettings', 'ConfirmSettings']) {
    assert.ok(prefs.includes('↓' + name + ' ['), name + ' in Preferences');
    assert.ok(!agent.includes('↓' + name + ' ['), name + ' no longer in Agent');
  }
  for (const name of ['ProviderSettings', 'ModelSettings', 'ReasoningIf']) {
    assert.ok(agent.includes('↓' + name + ' ['), name + ' stays in Agent');
  }
});

test('each agent card shows whether that agent is ready, once the Bridge listed the providers', () => {
  const choices = block('↓AgentChoices [', '↓AgentNotReady [');
  for (const provider of ['convertigo', 'vibe', 'codex', 'claude']) {
    assert.match(choices, new RegExp("hasReadyAgentProvider\\('" + provider + "'\\)"), provider);
  }
  assert.equal((choices.match(/hasAgentSettingsProvidersLoaded\(\)/g) || []).length, 4);
});

test('the style replaces the accordion headers and switches to a side list on wide views', () => {
  const style = block('↓TigoSettingsTabsStyle [', null);
  assert.match(style, /tigo-settings-categories > ion-accordion > ion-item\[slot="header"\]/);
  assert.match(style, /ion-accordion\.accordion-collapsed/);
  assert.match(style, /@media \(min-width: 1100px\)/);
  assert.match(style, /grid-template-columns: 270px minmax\(0, 1fr\)/);
  // The older rule fixes the cards at 74 px with !important: the compact cards must override it.
  assert.match(style, /ion-button\.agent-provider-option \{\s*height: auto !important;/);
});
