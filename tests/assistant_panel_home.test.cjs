// Lot 3 of the panel redesign: the Studio home lists its latest conversations, its two start choices are a compact
// pair, a new conversation starts again from the model and effort of the settings, the budget shows in words.
// node --test tests/assistant_panel_home.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const footer = read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, context = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const js = ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, context);
  return new context.P();
}
const node = (header, next) => {
  const start = page.indexOf(header);
  assert.ok(start > 0, header);
  return plain(page.slice(start, page.indexOf(next, start + header.length)));
};

test('the Studio home lists its latest conversations once the list is read, as the No Code home does', () => {
  const make = (local, screen = 'home', embedded = false) => {
    const p = methods(['isFormsRecentHistory', 'isStudioHomeRecent', 'getFormsHistoryItems']);
    p.local = local;
    p.isEmbeddedInC8Oforms = () => embedded;
    p.isAgentBridgeMode = () => true;
    p.shouldBlockRemoteStudioAgent = () => false;
    p.shouldShowAgentSettingsPanel = () => false;
    p.isAgentEnvironmentCheckPending = () => false;
    p.isPanelScreen = name => name === screen;
    return p;
  };
  const list = [1, 2, 3, 4, 5].map(i => ({ conversationId: 'c' + i, updatedAt: i }));
  const home = make({ AgentConversations: list });
  assert.equal(home.isFormsRecentHistory(), true);
  assert.deepEqual(home.getFormsHistoryItems().map(c => c.conversationId), ['c5', 'c4', 'c3']);
  assert.equal(make({ AgentConversations: list, AgentConversationsLoading: true }).isFormsRecentHistory(), false, 'while the list loads');
  assert.equal(make({ AgentConversations: [] }).isFormsRecentHistory(), false, 'nothing to list');
  assert.equal(make({ AgentConversations: list }, 'conversation').isFormsRecentHistory(), false);
  assert.equal(make({ AgentConversations: list }, 'settings').isFormsRecentHistory(), false);
  const noCode = make({ AgentConversations: list }, 'home', true);
  assert.equal(noCode.isFormsRecentHistory(), true, 'the No Code home is unchanged');
});

test('the latest conversations have their title, View all and no second strip in the Studio', () => {
  assert.match(node('              ↓Title [', '              ↓CloseButton ['), /\(this\.isFormsRecentHistory\(\) && !this\.isEmbeddedInC8Oforms\(\)\) \? this\.t\('Agent_Resume_Conversation', 'Reprendre une conversation'\)/);
  assert.match(node('              ↓FormsHistoryAll [', '          ↓NewConversationButton ['), /this\.isEmbeddedInC8Oforms\(\) \? this\.getFormsHistoryText\('all'\) : this\.t\('Agent_View_All_Conversations', 'Voir toutes les conversations'\)/);
  assert.match(node('          ↓AgentSessionStrip [', '            ↓SessionIcon ['), /\(this\.isFormsRecentHistory && this\.isFormsRecentHistory\(\) && !this\.isEmbeddedInC8Oforms\(\)\) \? 'agent-session-strip agent-history-choice agent-hidden'/);
  assert.equal((page.match(/\n\s+Agent_View_All_Conversations: "[^"\n]+",/g) || []).length, 4);
});

test('the two start choices are a compact pair on the Studio home: with the project, without one', () => {
  assert.match(node('      ↓StartCard [', '        ↓CardContent ['), /\+ \(\(this\.isPanelScreen && this\.isPanelScreen\('home'\) && !\(this\.isEmbeddedInC8Oforms && this\.isEmbeddedInC8Oforms\(\)\)\) \? ' agent-start-compact' : ''\)/);
  const style = plain(page.slice(page.indexOf('↓TigoLot3Style [')));
  assert.match(style, /\.agent-start-compact \.agent-start-choice \{\n\s+display: inline-flex !important;/);
  assert.match(style, /\.agent-start-compact \.agent-start-choice \.agent-session-meta \{\n\s+display: none !important;/);
  const labels = { en: ['With', 'No project'], fr: ['Avec', 'Sans projet'], it: ['Con', 'Senza progetto'], es: ['Con', 'Sin proyecto'] };
  for (const [lang, [withProject, without]] of Object.entries(labels)) {
    const i18n = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DisplayObjects/mobile/assets/i18n', lang + '.json'), 'utf8'));
    assert.equal(i18n.Agent_Start_With_Project, withProject, lang);
    assert.equal(i18n.Agent_Start_Now, without, lang);
  }
});

test('a new conversation starts again from the model and the effort of the settings', () => {
  const make = local => {
    const p = methods(['restoreDefaultAgentChoice']);
    p.local = local;
    p.getNoCodeServerAgent = () => null;
    p.resolveAgentReasoning = (list) => list.find(Boolean) || '';
    return p;
  };
  const models = [{ id: 'mistral-large-4', defaultReasoning: 'medium', reasoningLevels: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }] }, { id: 'glm-5-3', defaultReasoning: 'high', reasoningLevels: [{ id: 'high' }] }];
  const p = make({ AgentProvider: 'convertigo', AgentModels: models, AgentProviderSupportsReasoning: true, AgentModel: 'glm-5-3', AgentReasoningEffort: 'high',
    AgentSettingsChoice: { provider: 'convertigo', model: 'mistral-large-4', reasoning: 'medium' } });
  p.restoreDefaultAgentChoice();
  assert.equal(p.local.AgentModel, 'mistral-large-4');
  assert.equal(p.local.AgentReasoningEffort, 'medium');
  assert.equal(p.local.AgentReasoningLevels.length, 3);
  const other = make({ AgentProvider: 'vibe', AgentModels: models, AgentModel: 'glm-5-3', AgentSettingsChoice: { provider: 'convertigo', model: 'mistral-large-4' } });
  other.restoreDefaultAgentChoice();
  assert.equal(other.local.AgentModel, 'glm-5-3', 'another agent keeps its model');
  const noCode = make({ AgentProvider: 'convertigo', AgentModels: models, AgentModel: 'glm-5-3', AgentSettingsChoice: { provider: 'convertigo', model: 'mistral-large-4' } });
  noCode.getNoCodeServerAgent = () => ({ model: 'glm-5-3' });
  noCode.restoreDefaultAgentChoice();
  assert.equal(noCode.local.AgentModel, 'glm-5-3', 'the No Code server model stays');
  assert.match(page, /if \(!preserveSelection\) \{ this\.local\.AgentSettingsChoice = \{ provider: provider, model: model, reasoning: clean\(preferencesConfirmed \? preferences\.reasoning : storedReasoning\) \}; \}/);
  assert.match(page, /this\.local\.ShowAgentConfigPanel = false;\n\s+this\.local\.AgentSettingsChoice = \{ provider: this\.local\.AgentProvider, model: this\.local\.AgentModel, reasoning: this\.local\.AgentReasoningEffort \};/);
  const home = node('          ↓OpenConversationPanel [', '          ↓LoadConversations [');
  assert.ok(home.indexOf('page.restoreDefaultAgentChoice();') > 0 && home.indexOf('page.restoreDefaultAgentChoice();') < home.indexOf('page.setEnableChat();'));
});

test('the budget shows in words next to its ring', () => {
  assert.match(page, /label:label,percentText:percent == null \? "" : Math\.round\(percent\) \+ " %",summary:summary,/);
  const trigger = footer.slice(footer.indexOf('↓QuotaTrigger ['), footer.indexOf('↓QuotaPopover ['));
  assert.ok(trigger.includes("MobileSmartSourceType: script:AgentQuotaView?.percentText || ''"), 'the percent after the ring');
  const style = footer.slice(footer.indexOf('↓TigoBudgetPercentStyle ['));
  assert.match(style, /\.agent-quota-trigger \{\n\s+flex: 0 0 auto !important;\n\s+width: auto !important;/);
});
