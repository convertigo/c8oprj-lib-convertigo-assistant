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

test('remote bridge calls use the engine client with their own cookies and bounded requests', () => {
  const source = fs.readFileSync('js/agent_bridge_client.js', 'utf8');
  const start = source.indexOf('  function postForm(');
  const end = source.indexOf('\n  // background:', start);
  let status = 200, text = '{"ok":true}', closed = 0, called = 0, remembered;
  const configValues = {};
  const builder = {};
  for (const method of ['setConnectTimeout','setSocketTimeout','setConnectionRequestTimeout','setCookieSpec','setRedirectsEnabled']) {
    builder[method] = value => { configValues[method] = value; return builder; };
  }
  builder.build = () => configValues;
  const scope = vm.createContext({
    URL: function (text) { this.getHost = () => new ParsedURL(text).hostname; this.openConnection = () => assert.fail('no URLConnection for a remote engine request'); },
    Engine: {theApp:{httpClient4:{execute(post) {
      called++;
      assert.equal(post.headers.Cookie, 'session=synthetic');
      assert.equal(post.headers['X-Test'], 'present');
      assert.equal(post.headers['Proxy-Authorization'], undefined);
      assert.equal(post.entity.text, 'value=a%26b');
      return {getStatusLine:()=>({getStatusCode:()=>status}),getFirstHeader:()=>({getValue:()=> 'session=renewed'}),
        getEntity:()=>({getContent:()=>text}),close:()=>{closed++;}};
    }}}},
    Packages: {org:{apache:{http:{client:{methods:{HttpPost:function(){this.headers={};this.setHeader=(k,v)=>{this.headers[k]=v;};this.setEntity=v=>{this.entity=v;};this.setConfig=()=>{};}},
      config:{RequestConfig:{custom:()=>builder},CookieSpecs:{IGNORE_COOKIES:'ignore'}}},entity:{StringEntity:function(text){this.text=text;}}}}}},
    StandardCharsets:{UTF_8:'UTF-8'},bridgeSessionSlot:()=> 'slot',bridgeSessionCookie:()=> 'session=synthetic',
    rememberBridgeSessionCookie:(_params,slot,cookie)=>{remembered={slot,cookie};},
    encodeForm:()=> 'value=a%26b',readStream:s=>s,trim:s=>String(s||'').trim()
  });
  vm.runInContext(source.slice(start,end),scope);
  assert.equal(scope.postForm('https://bridge.example/convertigo/',{},1200,{'X-Test':'present'}).ok,true);
  assert.equal(closed,1);assert.deepEqual(remembered,{slot:'slot',cookie:'session=renewed'});
  for(const method of ['setConnectTimeout','setSocketTimeout','setConnectionRequestTimeout']) assert.equal(configValues[method],1200);
  assert.equal(configValues.setCookieSpec,'ignore');assert.equal(configValues.setRedirectsEnabled,false);
  for(status of [302,407,500]) assert.throws(()=>scope.postForm('https://bridge.example/convertigo/',{},1200,{'X-Test':'present'}),new RegExp('HTTP '+status));
  assert.equal(closed,4);
  status=200;text='not JSON';assert.throws(()=>scope.postForm('https://bridge.example/convertigo/',{},1200,{'X-Test':'present'}));assert.equal(closed,5);
  scope.Engine.theApp.httpClient4.execute=()=>{throw new Error('proxy unavailable');};
  assert.throws(()=>scope.postForm('https://bridge.example/convertigo/',{},1200,{}),/proxy unavailable/);
  assert.equal(called,5);
});
