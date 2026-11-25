// Lot 3b of the panel redesign: Delete asks for a second click, the feedback invitation is a banner of the home screen
// (not a card in the thread), one + menu in the input bar holds the files, the image and the library.
// node --test tests/assistant_panel_delete_invite_menu.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const footer = read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml');
const plain = text => text.replace(/''/g, "'");
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names, globals = {}) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = { ...globals };
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
const slice = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start > 0, from);
  const end = text.indexOf(to, start);
  assert.ok(end > start, to);
  return plain(text.slice(start, end));
};

test('the first click on Delete arms it, a second one within five seconds deletes', () => {
  let now = 1000;
  const timers = [];
  const p = methods(['confirmConversationDelete', 'isConversationDeleteArmed'], { Date: { now: () => now }, setTimeout: (fn, ms) => timers.push([fn, ms]) });
  p.local = {};
  p.tick = () => {};
  const a = { conversationId: 'a' }, b = { conversationId: 'b' };
  assert.equal(p.confirmConversationDelete(a), false, 'first click');
  assert.equal(p.isConversationDeleteArmed(a), true);
  assert.equal(p.isConversationDeleteArmed(b), false);
  now += 2000;
  assert.equal(p.confirmConversationDelete(a), true, 'second click');
  assert.equal(p.isConversationDeleteArmed(a), false);
  assert.equal(p.confirmConversationDelete(b), false);
  now += 6000;
  assert.equal(p.confirmConversationDelete(b), false, 'too late: armed again');
  timers.forEach(([fn]) => fn());
  assert.equal(p.isConversationDeleteArmed(b), false, 'disarmed after five seconds');
  assert.equal(p.confirmConversationDelete({}), false);
});

test('the delete call runs only once confirmed, and the button says what the second click does', () => {
  const button = slice(page, '↓DeleteButton [', '↓RenameButton [');
  const ifAt = button.indexOf('↓IfConfirmed [');
  assert.ok(ifAt > 0 && ifAt < button.indexOf('↓DeleteConversation ['), 'the call sits under the condition');
  assert.match(button, /"ionBean": ?"IfAction"/);
  assert.match(button, /"condition": ?"script:this\.confirmConversationDelete\(scope\.conversation\)"/);
  assert.match(button, /\+ \(this\.isConversationDeleteArmed\(conversation\) \? ' is-armed' : ''\)/);
  assert.match(button, /!this\.isEmbeddedInC8Oforms\(\) \|\| this\.isConversationDeleteArmed\(conversation\)/, 'the No Code icon gets its words when armed');
  assert.match(button, /this\.isConversationDeleteArmed\(conversation\) \? this\.historyText\('removeConfirm'\) : this\.historyText\('remove'\)/);
  for (const words of ['removeConfirm: "Confirmer la suppression"', 'removeConfirm: "Confirm delete"', 'removeConfirm: "Conferma eliminazione"', 'removeConfirm: "Confirmar eliminación"']) {
    assert.ok(page.includes(words), words);
  }
});

test('the feedback invitation is a banner of the home screen, with the buttons of the former card', () => {
  const banner = slice(page, '↓FeedbackInviteBanner [', '\n        ↓');
  assert.ok(page.indexOf('↓StartCard [') < page.indexOf('↓FeedbackInviteBanner ['), 'under the start card');
  assert.match(banner, /\*ngIf="getFeedbackInviteBanner\(\) as invite"/);
  assert.match(banner, /\*ngFor="let cta of invite\.actions"[^>]*\(click\)="onFeedbackCta\(invite, cta\)"/);
  assert.match(banner, /\(click\)="dismissFeedbackInviteBanner\(\)"/);
  assert.match(pageClass(), /if \(result\.invite === true\) \{\n\s+\/\/ the invitation shows on the home screen, outside the thread/);
});

test('one + menu holds the files, the image and the library; next to it only the open part of the library stays', () => {
  const menu = slice(footer, '↓AddMenu [', '↓CommandMenu [');
  const library = menu.slice(menu.indexOf('↓LibraryOptions ['));
  assert.ok(menu.indexOf('↓ImagesOption [') < menu.indexOf('↓LibraryOptions [') && menu.indexOf('↓LibraryOptions [') < menu.indexOf('↓DropPasteNote ['));
  assert.match(library, /\*ngIf="EnableResources"/);
  assert.match(library, /\*ngFor="let tab of \['prompts', 'skills', 'mcp'\]"/);
  assert.match(library, /this\['showAddMenu'\] = false; toggleResourceTab\(tab\)/);
  const add = slice(footer, '↓AddAsset [', '↓ResourceTabs [');
  assert.match(add, /MobileSmartSourceType: script:!this\.isAssetInputEnabled\(\) && !this\.EnableResources/, 'the + shows for the library alone');
  const style = plain(footer.slice(footer.indexOf('↓TigoAddMenuStyle [')));
  assert.ok(style.length > 0);
  assert.match(style, /\.tigo-quick-tabs button\.tigo-quick-toggle:not\(\[aria-pressed="true"\]\) \{\n\s+display: none !important;/);
  const captions = footer.slice(footer.indexOf('public resourceCaption(key: string) {'), footer.indexOf('public toggleResourceTab('));
  for (const words of ["addSkills:'Compétences'", "addSkills:'Skills'", "addSkills:'Competenze'", "addSkills:'Habilidades'", "addMcp:'Connexions MCP'", "addMcp:'Conexiones MCP'"]) {
    assert.ok(plain(captions).includes(words), words);
  }
});
