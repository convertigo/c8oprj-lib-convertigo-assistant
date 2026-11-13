// The question placeholder follows the mode (agent or not) and the language of the panel, even when a first one was set
// before the translations or the agent mode were known: an English Tigo panel kept "Demandez comment construire quelque
// chose..." (Electron Studio, 1.6.0-beta.19). node --test tests/assistant_footer_placeholder.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');

function copyClass() {
  const start = page.indexOf('        \t\tsyncFooterPlaceholder() {');
  const end = page.indexOf('        \t\trefreshFooterLocale() {');
  assert.ok(start > 0 && end > start);
  // the class body is a single-quoted YAML scalar: its apostrophes are doubled
  const body = page.slice(start, end).replace(/''/g, "'");
  const js = ts.transpileModule('class P {\n' + body + '\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  return vm.runInNewContext(js + '\nP;', {});
}

const EN = { Question_Placeholder: 'Ask how to build something...', Agent_Question_Placeholder: 'Ask the agent to work on the project...' };

function placeholderAfterSync(current, { agent = true, translations = EN } = {}) {
  const P = copyClass();
  const p = new P();
  p.local = { EnableChat: true, QuestionPlaceholder: current };
  p.isAgentBridgeMode = () => agent;
  p.isEmbeddedInC8Oforms = () => false;
  p.getNoProjectSelectedMessage = () => 'Select a project first.';
  p.t = (key, fallback) => translations[key] || fallback;
  p.syncFooterPlaceholder();
  return p.local.QuestionPlaceholder;
}

test('a placeholder set before the translations or the agent mode gives way to the one of the current mode and language', () => {
  // the case seen in the Electron Studio: the French text of the other mode, in an English agent panel
  assert.equal(placeholderAfterSync('Demandez comment construire quelque chose...'), EN.Agent_Question_Placeholder);
  assert.equal(placeholderAfterSync("Demandez à l'agent d'intervenir sur le projet..."), EN.Agent_Question_Placeholder);
  assert.equal(placeholderAfterSync('Chiedi come costruire qualcosa...'), EN.Agent_Question_Placeholder);
  assert.equal(placeholderAfterSync('Pregunta cómo construir algo...', { agent: false }), EN.Question_Placeholder);
  assert.equal(placeholderAfterSync(EN.Question_Placeholder), EN.Agent_Question_Placeholder, 'the other mode, translated');
  assert.equal(placeholderAfterSync(''), EN.Agent_Question_Placeholder);
  assert.equal(placeholderAfterSync('Select a project first.'), EN.Agent_Question_Placeholder);
});

test('a placeholder that is not a default stays', () => {
  assert.equal(placeholderAfterSync(EN.Agent_Question_Placeholder), EN.Agent_Question_Placeholder);
  const disabled = 'Enable the local assistant to use the AI Agent in the Studio.';
  assert.equal(placeholderAfterSync(disabled), disabled);
  const french = { Question_Placeholder: 'Demandez comment construire quelque chose...', Agent_Question_Placeholder: "Demandez à l'agent d'intervenir sur le projet..." };
  assert.equal(placeholderAfterSync(french.Agent_Question_Placeholder, { translations: french }), french.Agent_Question_Placeholder, 'a French panel keeps its French text');
});
