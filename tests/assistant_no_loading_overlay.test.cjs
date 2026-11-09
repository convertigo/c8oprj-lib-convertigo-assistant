// The Tigo panel never shows the full-screen loading overlay of a sequence call (users saw it "sometimes",
// 09/11: the quota refresh after a turn, the upload before a send, the Figma generation). The Mobile Builder
// presents it (C8oPageBase.call) when a call outlasts its threshold, 500 ms by default, unless the call says
// noLoading. Every CallSequenceAction of the project carries noLoading, and no script calls the page's own
// call() loader. Progress stays inline: the chat spinner and a waiting composer for the upload, a spinner in
// the drop zone for the Figma generation.
// node --test tests/assistant_no_loading_overlay.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// Calls allowed to show the overlay, as "<file>#<bean id>". Keep it empty: add a call only with a reason.
const ALLOWED_WITH_LOADING = new Set([]);

function yamlFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(rel);
    return entry.name.endsWith('.yaml') ? [rel] : [];
  });
}

const files = ['c8oProject.yaml', ...yamlFiles('_c8oProject')];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// beanData of every bean, single-line ('{...}') or block (|), as the JSON the Mobile Builder reads.
function beanDatas(file) {
  const lines = read(file).split('\n'), found = [];
  for (let i = 0; i < lines.length; i++) {
    const header = /^( *)↓(.+?) \[([\w.]+)-(\d+)\]: $/.exec(lines[i]);
    if (!header) continue;
    const indent = header[1].length;
    // Properties of the bean (comment, beanData, ...) come before its first child bean.
    let at = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const depth = lines[j].search(/\S/);
      if (depth < 0) continue;
      if (depth <= indent || (depth === indent + 2 && lines[j].trimStart().startsWith('↓'))) break;
      if (depth === indent + 2 && lines[j].trimStart().startsWith('beanData: ')) { at = j; break; }
    }
    if (at < 0) continue;
    let raw = lines[at].trimStart().slice('beanData: '.length);
    if (raw === '|') {
      const body = [];
      for (let j = at + 1; j < lines.length && lines[j].search(/\S/) > indent + 2; j++) body.push(lines[j].trim());
      raw = body.join('\n');
    }
    assert.ok(raw.startsWith("'") && raw.endsWith("'"), `${file}:${at + 1} quoted beanData`);
    const json = JSON.parse(raw.slice(1, -1).replace(/''/g, "'"));
    found.push({ file, line: i + 1, name: header[2], type: header[3], id: header[4], json });
  }
  return found;
}

const beans = files.flatMap(beanDatas);
const calls = beans.filter((bean) => /Call\w*Action$/.test(bean.json.ionBean || ''));

test('the project still has its sequence calls (the parser sees them)', () => {
  assert.ok(calls.length >= 20, `found ${calls.length} call actions`);
  assert.ok(calls.some((c) => c.json.requestable === 'plain:lib_ConvertigoAssistant.AgentQuota'));
  assert.ok(calls.some((c) => c.json.requestable === 'plain:lib_ConvertigoAssistant.UploadFilesRouter'));
  assert.ok(calls.some((c) => c.json.requestable === 'plain:lib_ConvertigoAssistant.CreateFigmaComp'));
  // Every textual mention of a call bean is one the parser read, so none escapes the noLoading check.
  const mentions = files.reduce((n, file) => n + (read(file).match(/"ionBean\\?"\s*:\s*\\?"Call\w*Action/g) || []).length, 0);
  assert.equal(calls.length, mentions);
});

test('every sequence call of the project says noLoading', () => {
  const missing = calls
    .filter((c) => !ALLOWED_WITH_LOADING.has(`${c.file}#${c.id}`))
    .filter((c) => c.json.noLoading !== 'plain:true')
    .map((c) => `${c.file}:${c.line} ${c.name} (${c.json.requestable}) noLoading=${c.json.noLoading}`);
  assert.deepEqual(missing, [], 'these calls would show the loading overlay over the Tigo panel');
});

test('the allowlist names existing calls only', () => {
  const ids = new Set(calls.map((c) => `${c.file}#${c.id}`));
  for (const entry of ALLOWED_WITH_LOADING) assert.ok(ids.has(entry), entry);
});

test('no script calls the page loader directly', () => {
  // this.call(...), page.call(...), page['call'](...) are C8oPageBase.call, which shows the overlay; the SDK's
  // this.c8o.callJsonObject(...) does not. fn.call(this, ...) is Function.prototype.call and stays allowed.
  const pageCall = /(?<![\w.$])(?:this|page|self)\s*(?:\.\s*call|\[\s*['"]{1,2}call['"]{1,2}\s*\])\s*\(/g;
  const hits = [];
  for (const file of [...files, ...fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)]) {
    read(file).split('\n').forEach((line, i) => {
      if (pageCall.test(line)) hits.push(`${file}:${i + 1} ${line.trim().slice(0, 120)}`);
      pageCall.lastIndex = 0;
    });
  }
  assert.deepEqual(hits, []);
});

test('the upload before a send shows the chat spinner and blocks a second send instead', () => {
  const page = read('_c8oProject/mobilePages/Page.yaml');
  const start = page.indexOf('      ↓ShowSendPending [ngx.components.UICustomAction-');
  const upload = page.indexOf('      ↓CallSequence [ngx.components.UIDynamicAction-1751354620842]: ');
  assert.ok(start > 0 && upload > start, 'ShowSendPending runs with the upload, in the same RunQuestion event');
  const pending = page.slice(start, upload);
  assert.match(pending, /page\.local\.SendPending = true;/);
  assert.match(pending, /page\.local\.spinner = true;/);
  const failure = page.slice(upload, page.indexOf('        ↓files [ngx.components.UIControlVariable-1751354620845]: '));
  assert.match(failure, /↓Failure \[ngx\.components\.UIActionFailureEvent-\d+\]: /);
  assert.match(failure, /page\.local\.SendPending = false;[\s\S]*page\.local\.spinner = false;[\s\S]*setQuestionText\(draft, false\)/);
  assert.match(page, /page\.local\.UploadImageCursor = 0;\n *\t\tpage\.local\.SendPending = false;\n *\t\tpage\.local\.spinner = false;\n/);
  const footer = read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml');
  assert.match(footer, /if \(owner && owner\.local && owner\.local\.SendPending === true\) \{\n *\t+return;/);
});

test('the Figma generation shows a spinner in the drop zone', () => {
  const figma = read('_c8oProject/mobilePages/Figma.yaml');
  assert.match(figma, /↓ShowBusy [^\n]+\n[\s\S]*?page\.chatinput\.setBusy\(true\);/);
  const call = figma.slice(figma.indexOf('      ↓CallSequence [ngx.components.UIDynamicAction-1752575630370]: '));
  assert.match(call, /↓EndBusyOnFailure [^\n]+\n[\s\S]*?page\.chatinput\.setBusy\(false\);/);
  assert.match(call, /↓EndBusy [^\n]+\n[\s\S]*?page\.chatinput\.setBusy\(false\);/);
  const footer = read('_c8oProject/mobileSharedComponents/FigmaFooterComponent.yaml');
  assert.match(footer, /\tsetBusy\(busy\) \{/);
  assert.match(footer, /this\.busy !== true && this\.EnableChat !== false/);
  assert.match(footer, /attrName: '\[class\.figma-drop-button-busy\]'/);
  assert.match(footer, /\.figma-drop-button-busy \.figma-drop-icon-wrap::after \{/);
});
