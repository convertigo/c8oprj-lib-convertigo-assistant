const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { URL: ParsedURL } = require('node:url');

test('local bridge calls bypass the proxy without changing remote bridge routing', () => {
  const source = fs.readFileSync('js/agent_bridge_client.js', 'utf8');
  const start = source.indexOf('  function postForm(');
  const end = source.indexOf('\n  // background:', start);
  assert.ok(start >= 0 && end > start);
  const direct = {}, calls = [];
  const noop = () => {};
  const connection = {
    setRequestMethod: noop, setConnectTimeout: noop, setReadTimeout: noop,
    setRequestProperty: noop, setDoOutput: noop,
    getOutputStream: () => ({ write: noop, close: noop }),
    getResponseCode: () => 200, getHeaderField: () => '', getInputStream: () => ({}),
    disconnect: noop
  };
  const scope = vm.createContext({
    URL: function (text) {
      this.getHost = () => new ParsedURL(text).hostname;
      this.openConnection = (...args) => { calls.push(args); return connection; };
    },
    Packages: { java: { net: { Proxy: { NO_PROXY: direct } } } },
    java: { lang: { String: function () { this.getBytes = () => []; } } },
    StandardCharsets: { UTF_8: 'UTF-8' },
    bridgeSessionSlot: () => '', bridgeSessionCookie: () => '', rememberBridgeSessionCookie: noop,
    encodeForm: () => '', readStream: () => '{"ok":true}', trim: s => String(s || '').trim()
  });
  vm.runInContext(source.slice(start, end), scope);
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
    assert.equal(scope.postForm('http://' + host + ':18080/convertigo/', {}, 1000, {}).ok, true);
    assert.equal(calls.at(-1)[0], direct);
  }
  for (const host of ['bridge.example', 'localhost.example', '127.0.0.1.example']) {
    scope.postForm('https://' + host + '/convertigo/', {}, 1000, {});
    assert.equal(calls.at(-1).length, 0);
  }
});
