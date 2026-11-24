// Lot 4 of the panel redesign: one word per thing (Settings / Réglages, Compétences, prompts pinned under the input
// bar, Advanced), one conversation in the singular, agents being checked say so, choices readable on light backgrounds.
// node --test tests/assistant_panel_glossary.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const footer = read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = {};
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}

test('the settings are Settings, Réglages, Impostazioni and Ajustes', () => {
  for (const title of ['Settings', 'Réglages', 'Impostazioni', 'Ajustes']) {
    assert.match(page, new RegExp('\\n\\s+Agent_Settings_Title: "' + title + '",'), title);
  }
  assert.doesNotMatch(page, /Agent_Settings_Title: "(AI Agent settings|Configuration Agent IA|Configurazione Agente IA|Configuración del Agente IA)"/);
  assert.match(page, /this\.t\("Agent_Settings_Title", "Réglages"\)/);
});

test('skills are Compétences in French, prompts are pinned under the input bar, the runtime tab is Advanced', () => {
  const text = plain(page);
  assert.match(text, /prompts:'Prompts', skills:'Compétences', mcp:'Connexions MCP', agent:'Agent et modèle', runtime:'Avancé'/);
  assert.match(text, /runtime:'Advanced'/);
  assert.match(text, /favorite:'Épingler sous la saisie', unfavorite:'Retirer de la saisie'/);
  assert.match(text, /favorite:'Pin under the input bar', unfavorite:'Unpin'/);
  assert.doesNotMatch(text, /'(Ajouter aux favoris|Retirer des favoris|Add to favorites|Remove from favorites|Runtime et stack|Runtime and stack)'/);
  assert.doesNotMatch(text, /promptHint:'[^']*favori/i);
  assert.match(plain(footer), /const fr = \{prompts:'Prompts',skills:'Compétences',/);
});

test('one conversation is in the singular', () => {
  const p = methods(['historySummary', 'historyText']);
  p.agentUiLanguage = () => 'fr';
  p.isEmbeddedInC8Oforms = () => false;
  p.local = { AgentConversations: [{ conversationId: 'a' }] };
  p.getHistoryItems = () => p.local.AgentConversations;
  p.historyMatches = 1;
  assert.equal(p.historySummary(), '1 conversation');
  p.local.AgentConversations = [{ conversationId: 'a' }, { conversationId: 'b' }];
  p.historyMatches = 2;
  assert.equal(p.historySummary(), '2 conversations');
  for (const one of ['one: "1 conversation", count: "{total} conversations", countSome: "{shown} sur {total}"', 'one: "1 conversazione", ', 'one: "1 conversación", ']) {
    assert.ok(page.includes(one), one);
  }
});

test('an agent being checked says so instead of "Needs setup"', () => {
  const states = page.split('↓ProviderState [').slice(1).map(block => plain(block.slice(0, 4000)));
  assert.equal(states.length, 4);
  for (const state of states) {
    assert.match(state, /\(local\?\.AgentSettingsRefreshRunning === true \|\| local\?\.AgentRuntimeLoading === true\) \? \(lang === 'fr' \? 'Vérification…' : \(lang === 'it' \? 'Verifica…' : \(lang === 'es' \? 'Comprobando…' : 'Checking…'\)\)\)/);
    assert.match(state, /\[class\.is-checking\]="!hasReadyAgentProvider\('(convertigo|vibe|codex|claude)'\) && \(local\?\.AgentSettingsRefreshRunning === true \|\| local\?\.AgentRuntimeLoading === true\)"/);
  }
});

test('choices read as chosen on light backgrounds', () => {
  const style = plain(page.slice(page.indexOf('↓TigoLot4Style [')));
  assert.match(style, /\.forms-integrated \.agent-choice-button\.active,\n\s+:host-context\(\.force-light\) \.agent-choice-button\.active \{\n\s+--background: #0e7490;/);
  assert.match(style, /\.agent-provider-state\.is-checking \{/);
});
