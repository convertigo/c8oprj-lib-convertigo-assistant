// The stable and preview manifests come from one HTTP connector, AgentStackRelease. In a Studio every call runs on the
// project opened in the Studio, so on one connector instance whose request URL is a field: two of its transactions at once
// read the URL the other set (the stable read answered the preview manifest; "Impossible de vérifier la stack publiée",
// 25/11 on a Studio 8.4.8). The panel calls them one after the other.
// node --test tests/assistant_stack_manifest_queue.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, pageClass } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
function methods(names) {
  const found = ast.statements[0].members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(found.length, names.length, names.join());
  const context = { Promise };
  vm.runInNewContext(ts.transpileModule('class P {' + found.join('\n') + '}\nthis.P = P;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return new context.P();
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function panel() {
  const p = methods(['callAgentStackManifest']);
  const calls = [];
  p.c8o = { callJsonObject: (name, parameters) => {
    let settle;
    const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    calls.push({ name: name.split('.').pop(), parameters, settle });
    return { async: () => promise };
  } };
  return { p, calls };
}

test('a manifest read starts only once the previous one answered', async () => {
  const { p, calls } = panel();
  const stable = p.callAgentStackManifest('GetManifest', { manifestRevision: 'r' });
  const preview = p.callAgentStackManifest('GetPreviewManifest', { manifestRevision: 'r' });
  await flush();
  assert.equal(calls.length, 1, 'the preview read waits');
  assert.equal(calls[0].name, 'GetManifest');
  calls[0].settle.resolve({ channel: 'stable' });
  assert.equal((await stable).channel, 'stable');
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].name, 'GetPreviewManifest');
  assert.equal(calls[1].parameters.manifestRevision, 'r');
  calls[1].settle.resolve({ channel: 'preview' });
  assert.equal((await preview).channel, 'preview');
});

test('a failed read does not block the next one, and still fails for its caller', async () => {
  const { p, calls } = panel();
  const stable = p.callAgentStackManifest('GetManifest', {});
  const preview = p.callAgentStackManifest('GetPreviewManifest', {});
  await flush();
  calls[0].settle.reject(new Error('offline'));
  await assert.rejects(stable, /offline/);
  await flush();
  assert.equal(calls.length, 2);
  calls[1].settle.resolve({ channel: 'preview' });
  assert.equal((await preview).channel, 'preview');
});

test('every manifest read of the panel goes through the queue', () => {
  assert.equal((page.match(/callJsonObject\("lib_ConvertigoAssistant\.AgentStackRelease\./g) || []).length, 1, 'only the queue calls the connector');
  assert.match(page, /var stable = this\.callAgentStackManifest\("GetManifest", \{manifestRevision: String\(Date\.now\(\)\)\}\);/);
  assert.match(page, /: this\.callAgentStackManifest\("GetPreviewManifest", \{manifestRevision: String\(Date\.now\(\)\)\}\)/);
  assert.match(page, /var read = \(name, expected\) => this\.callAgentStackManifest\(name, \{\}\)/);
  assert.match(page, /var read = \(name, expected\) => this\.callAgentStackManifest\(name, \{manifestRevision: revision\}\)/);
});
