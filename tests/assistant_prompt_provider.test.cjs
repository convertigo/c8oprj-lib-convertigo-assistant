// The prompt bar shows a read-only reminder of the provider that answers, left of the model combo.
// node --test tests/assistant_prompt_provider.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { read, pageClass } = require('./helpers/assistant-source.cjs');
const ts = require(path.join(path.resolve(__dirname, '..'), '_private/ionic/node_modules/typescript'));

const footerSource = read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml');
const pageSource = read('_c8oProject/mobilePages/Page.yaml');

test('the provider label element exists in the prompt bar', () => {
  const span = footerSource.match(/↓ProviderLabel \[ngx\.components\.UIDynamicElement-\d+\]: [\s\S]*?(?=\n {8}↓Class \[)/);
  assert.ok(span, 'ProviderLabel span must exist under ControlsRight');
  assert.match(span[0], /beanData: '\{"ionBean":"SpanTag"\}'/);
  assert.match(span[0], /tagName: span/);
  assert.match(span[0], /MobileSmartSourceType: plain:agent-prompt-provider-label/);
  // Read-only: no combo, no dropdown, no click handler on the label.
  assert.doesNotMatch(span[0], /ionChange|\(click\)|SelectOption/);
  // Text and visibility both come from the single AgentProviderLabel input.
  assert.match(span[0], /MobileSmartSourceType: script:this\.AgentProviderLabel \|\| ''/);
  assert.match(span[0], /attrName: '\[hidden\]'[\s\S]*?script:!\(this\.AgentProviderLabel && \('' \+ this\.AgentProviderLabel\)\.length > 0\)/);
  // The accessible name reuses the component t(key, default) i18n mechanism.
  assert.match(span[0], /this\.t\(''Agent_Provider_Active_Aria'', ''Agent actif''\)/);
  // The footer declares the matching read-only component variable.
  assert.match(footerSource, /↓AgentProviderLabel \[ngx\.components\.UICompVariable-\d+\]: \n  comment: Read-only display name/);
});

test('the label is rendered before the model select', () => {
  const controlsRight = footerSource.indexOf('↓ControlsRight [ngx.components.UIDynamicElement-1782125437312]');
  const label = footerSource.indexOf('↓ProviderLabel [ngx.components.UIDynamicElement-', controlsRight);
  const modelSelect = footerSource.indexOf('↓ModelSelect [ngx.components.UIDynamicElement-1782125437316]', controlsRight);
  const reasoning = footerSource.indexOf('↓ReasoningIf [ngx.components.UIControlDirective-1782125441546]', controlsRight);
  assert.ok(controlsRight > 0 && label > controlsRight, 'the label belongs to the right-hand control group');
  assert.ok(label < modelSelect, 'the label comes before the model select');
  assert.ok(modelSelect < reasoning, 'the model select still comes before the reasoning select');
});

test('the page feeds the label from the existing provider label source', () => {
  const useVar = pageSource.match(/↓AgentProviderLabel \[ngx\.components\.UIUseVariable-\d+\]: [\s\S]*?\n {4}(?=↓)/);
  assert.ok(useVar, 'the page must bind AgentProviderLabel on the footer component');
  assert.match(useVar[0], /this\.getAgentProviderLabel\(\)/);
  // Unknown providers resolve to "Agent", which must stay hidden rather than show a fifth name.
  assert.match(useVar[0], /this\.getAgentProviderLabel\(\) !== ''Agent''/);
});

test('the label styling follows the prompt-bar controls and does not squeeze the input', () => {
  const style = footerSource.match(/↓AgentPromptProviderLabelStyle \[ngx\.components\.UIStyle-\d+\]: [\s\S]*?\n(?=↓)/);
  assert.ok(style, 'a dedicated UIStyle must carry the label rules');
  const css = style[0];
  // Same 13px/30px metrics as .agent-prompt-select, muted colour from the theme variables.
  assert.match(css, /\.agent-prompt-provider-label \{[\s\S]*?font-size: 13px;/);
  assert.match(css, /\.agent-prompt-provider-label \{[\s\S]*?min-height: 30px;/);
  assert.match(css, /color: color-mix\(in srgb, var\(--ion-text-color\) \d+%, transparent\);/);
  assert.match(css, /border: 1px solid color-mix\(in srgb, var\(--modern-border\) \d+%, transparent\);/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded colour: the dark theme uses the CSS variables');
  // It must never grow: fixed flex basis, ellipsis, narrower on small panels, gone on very small ones.
  assert.match(css, /flex: 0 0 auto;/);
  assert.match(css, /text-overflow: ellipsis;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.agent-prompt-provider-label \{[\s\S]*?max-width: 86px;/);
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.agent-prompt-provider-label \{[\s\S]*?display: none !important;/);
  // The legacy (non-agent) footer hides it like the other agent controls.
  assert.match(css, /:host-context\(ion-footer\.legacy-prompt-footer\) \.agent-prompt-provider-label \{\s*\n\s*display: none !important;/);
});

test('the provider label source resolves the four display names', () => {
  const source = pageClass();
  const ast = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const wanted = ['getAgentProviderLabel', 'cleanProjectName'];
  const picked = [];
  (function visit(node) {
    if (ts.isMethodDeclaration(node) && wanted.includes(node.name.getText(ast))) picked.push(node.getText(ast));
    ts.forEachChild(node, visit);
  })(ast);
  assert.equal(picked.length, wanted.length, 'both helpers must be found in the page class');
  const context = {};
  vm.runInNewContext(ts.transpileModule('class Probe { ' + picked.join('\n') + ' } this.Probe = Probe;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const probe = new context.Probe();
  probe.getAgentProvider = () => '';

  assert.equal(probe.getAgentProviderLabel('codex'), 'Codex');
  assert.equal(probe.getAgentProviderLabel('claude'), 'Claude');
  assert.equal(probe.getAgentProviderLabel('vibe'), 'Vibe');
  // The convertigo provider runs on the Vibe harness but must read Convertigo, never Vibe.
  assert.equal(probe.getAgentProviderLabel('convertigo'), 'Convertigo');
  assert.equal(probe.getAgentProviderLabel('Convertigo'), 'Convertigo');
  // Anything else stays neutral; the page then binds an empty label and the span stays hidden.
  assert.equal(probe.getAgentProviderLabel('somethingelse'), 'Agent');
  assert.equal(probe.getAgentProviderLabel(''), 'Agent');
});
