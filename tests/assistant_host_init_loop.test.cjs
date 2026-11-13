// The page asks its host for its context after an init. A web Studio that answered each request with init + context +
// select kept the two in a loop (about 25 round trips a second, the renderer at 100 %, out of memory after 3 h): the page
// no longer asks when the host sent its context with its init, and at most once every 2 s after an init. The Eclipse
// Studio (init at load, the context on request) still gets its request. node --test tests/assistant_host_init_loop.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, blockWith } = require('./helpers/assistant-source.cjs');

const block = blockWith('_c8oProject/mobileNgxApp.yaml', 'requestAssistantContextAfterInit');
const start = block.indexOf('// The page asks for its context after an init.');
const end = block.indexOf('\n        resolve();', start);
assert.ok(start > 0 && end > start);
const source = ts.transpileModule(block.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;

// A host and the page, run on a manual clock: `host` answers each context request.
function run(host, { seconds = 3 } = {}) {
  let now = 0, requests = 0;
  const queue = [];
  const later = (fn, ms) => queue.push({ at: now + (ms || 0), fn });
  const page = { global: {}, tick() {}, getInstance: () => ({ publish() {} }) };
  const win = { parent: null, addEventListener() {} };
  win.parent = { postMessage: () => {} };
  const deliver = msg => later(() => win.listener(msg), 1);
  win.sendToHost = msg => {
    if (msg.type === 'lib_ConvertigoAssistant.context.request') {
      requests++;
      host.onRequest(deliver);
    }
  };
  const sandbox = {
    window: win, page, Events: {}, setTimeout: later,
    Date: { now: () => now },
    mergeAgentHostContext() {}, autoOpenAgentFromStudioView() {}
  };
  const code = source
    .replace(/window\['sendToHost'\] = \(message\) => \{[\s\S]*?\n\s*\};\n/, '')
    .replace(/window\['setupMessageListener'\] = \(callback\) => \{[\s\S]*?\n\s*\};\n/, 'window.setupMessageListener = (callback) => { window.listener = callback; };\n');
  assert.ok(code.includes('window.listener = callback'), 'the listener of the page is captured');
  vm.runInNewContext(code, sandbox);
  host.onLoad(deliver);
  while (queue.length) {
    queue.sort((a, b) => a.at - b.at);
    const next = queue.shift();
    if (next.at > seconds * 1000) { break; }
    now = next.at;
    next.fn();
  }
  return requests;
}

const context = { type: 'lib_ConvertigoAssistant.context', payload: { assistantSurface: 'studio' } };
const select = { type: 'select', projectName: 'crm' };

test('a host that answers each request with init + context + select gets no loop', () => {
  const oldWebStudio = {
    onLoad(send) { send({ type: 'init' }); send(context); send(select); },
    onRequest(send) { send({ type: 'init' }); send(context); send(select); }
  };
  assert.ok(run(oldWebStudio) <= 2, 'a few requests at most, not 25 a second');
});

test('even when its context comes late, the requests after an init are at most one every 2 s', () => {
  const lateContext = {
    onLoad(send) { send({ type: 'init' }); },
    onRequest(send) { send({ type: 'init' }); }
  };
  assert.ok(run(lateContext, { seconds: 10 }) <= 6);
});

test('the Eclipse Studio (init at load, the context on request) still gets its request', () => {
  const eclipse = {
    onLoad(send) { send({ type: 'init' }); },
    onRequest(send) { send(context); }
  };
  assert.equal(run(eclipse), 1);
});
