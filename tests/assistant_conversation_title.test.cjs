// The title of a new conversation, made from its first message: Markdown removed, cut on a word at 140 characters.
// node --test tests/assistant_conversation_title.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');

function load() {
  const sandbox = { trim: v => String(v ?? '').trim() };
  vm.runInNewContext(backendParts(['conversationTitleFromText', 'isTechnicalConversationTitle'], ['CONVERSATION_TITLE_MAX']), sandbox);
  return sandbox;
}

test('a long first message gives a title cut on a word, with an ellipsis', () => {
  const s = load();
  const message = "Réalise l'application Convertigo PcaUpdateTracker décrite dans le cahier des charges joint, avec ses lots, ses tests de non-régression et ses preuves navigateur, puis rédige le bilan.";
  const title = s.conversationTitleFromText(message);
  assert.ok(title.length <= 141, title.length);
  assert.ok(title.endsWith('…'));
  assert.ok(message.startsWith(title.slice(0, -1)), 'the title is the start of the message');
  const kept = title.slice(0, -1);
  assert.match(message.charAt(kept.length), /[\s,;:.!?]/, 'cut between two words, not inside one');
});

test('a short message is the title, a title already cut stays as it is', () => {
  const s = load();
  assert.equal(s.conversationTitleFromText('Bonjour, réponds seulement OK.'), 'Bonjour, réponds seulement OK.');
  assert.equal(s.conversationTitleFromText('**Corrige** la page `Accueil`'), 'Corrige la page Accueil');
  const old = "Réalise l'application Convertigo PcaUpdateTracker décrite dans le fichier docs/spec.md du projet, avec...";
  assert.equal(s.conversationTitleFromText(old), old);
  assert.equal(s.conversationTitleFromText('untitled'), '');
});
