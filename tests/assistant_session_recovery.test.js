const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('_c8oProject/mobileNgxApp.yaml', 'utf8');
const pageSource = fs.readFileSync('_c8oProject/mobilePages/Page.yaml', 'utf8');
function action(name) {
  const block = appSource.slice(appSource.indexOf('  ↓' + name + ' ['));
  const match = block.match(/→: \|\n( +)'([\s\S]*?)\n\1'/);
  assert.ok(match, name);
  return match[2].replace(new RegExp('\\n' + match[1], 'g'), '\n').replace(/''/g, "'");
}
const initialize = new Function('page', 'window', 'document', 'resolve', 'reject', 'fetch', 'DOMParser', 'AbortController', 'setTimeout', 'clearTimeout', action('AuthenticateStudioSession'));
const pageMethod = pageSource.match(/public installAgentSessionRecovery\(\) \{([\s\S]*?)\n\s*public debug\(/);
assert.ok(pageMethod);
const install = new Function(pageMethod[1].replace(/\}\s*$/, '').replace(/var page: any/g, 'var page').replace(/''/g, "'"));
const denied = () => ({message: 'Unable to create the managed Convertigo MCP token: A WEB_ADMIN session is required.'});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture({remote = false, iframe = false, response = '<admin><authenticated>true</authenticated></admin>', networkError = false, hash = ''} = {}) {
  const requests = [], exchanges = [], timers = new Map();
  let timerId = 0;
  const window = {
    location: {pathname: remote ? '/' : '/convertigo/projects/lib_ConvertigoAssistant/DisplayObjects/mobile/path-to-xfirst', search: '', hash},
    history: {state: {}, replaceState(_state, _title, url) { window.location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; }},
    java: {receiveFromJS(text) { requests.push(JSON.parse(text)); }}
  };
  window.top = iframe ? {} : window;
  const page = {global: {}};
  class Parser {
    parseFromString(text) {
      return {querySelector(name) {
        if (name === 'authenticated') {
          const match = text.match(/<authenticated>([^<]*)<\/authenticated>/);
          return match ? {textContent: match[1]} : null;
        }
        return name === 'error' && text.includes('<error>') ? {} : null;
      }};
    }
  }
  let initFailure;
  initialize(page, window, {title: 'Assistant'}, () => {}, e => { initFailure = e; }, async (url, options) => {
    exchanges.push({url, options});
    if (networkError) throw new Error('network');
    return {ok: true, text: async () => response};
  }, Parser, AbortController, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
  return {page, window, requests, exchanges, timers, initFailure: () => initFailure,
    reply(id = requests.at(-1).requestId) { page.global.completeStudioSessionRenewal({requestId: id, authToken: 'one-use-token'}); }};
}

(async () => {
  const f = fixture();
  let calls = 0;
  const result = f.page.global.callWithStudioSessionRecovery(() => ++calls === 1 ? Promise.reject(denied()) : 'resumed');
  await flush();
  assert.equal(f.requests.length, 1);
  f.reply('wrong-id');
  assert.equal(f.exchanges.length, 0);
  f.reply();
  assert.equal(await result, 'resumed');
  assert.equal(calls, 2);
  assert.equal(f.exchanges[0].url, '/convertigo/admin/services/engine.Authenticate');
  assert.equal(f.exchanges[0].options.credentials, 'same-origin');
  f.reply();
  assert.equal(f.exchanges.length, 1, 'one response consumed once');
  assert.equal(f.timers.size, 0);

  const concurrent = fixture();
  const p1 = concurrent.page.global.renewStudioSession();
  const p2 = concurrent.page.global.renewStudioSession();
  assert.equal(p1, p2);
  concurrent.reply();
  await p1;
  assert.equal(concurrent.requests.length, 1, 'single flight');

  const twice = fixture();
  let twiceCalls = 0;
  const fail = twice.page.global.callWithStudioSessionRecovery(() => { twiceCalls++; throw denied(); });
  await flush(); twice.reply();
  await assert.rejects(fail);
  assert.equal(twiceCalls, 2, 'never retry twice');
  assert.equal(twice.requests.length, 1);

  for (const options of [{remote: true}, {iframe: true}]) {
    const blocked = fixture(options);
    await assert.rejects(blocked.page.global.callWithStudioSessionRecovery(() => Promise.reject(denied())));
    assert.equal(blocked.requests.length, 0);
  }
  const other = fixture();
  await assert.rejects(other.page.global.callWithStudioSessionRecovery(() => Promise.reject(new Error('network'))));
  assert.equal(other.requests.length, 0, 'do not replay generic failures');

  for (const options of [{response: '<admin><authenticated>false</authenticated></admin>'}, {response: '<html>ERROR</html>'}, {networkError: true}]) {
    const rejected = fixture(options);
    const promise = rejected.page.global.renewStudioSession();
    rejected.reply();
    await assert.rejects(promise, /studio_auth_rejected/);
    assert.equal(rejected.timers.size, 0);
  }
  const timeout = fixture();
  const pending = timeout.page.global.renewStudioSession();
  [...timeout.timers.values()][0]();
  await assert.rejects(pending, /studio_auth_timeout/);
  timeout.reply();
  assert.equal(timeout.exchanges.length, 0, 'ignore late token');

  const startup = fixture({hash: '#authToken=initial&early-access-agent'});
  await flush();
  assert.equal(startup.initFailure(), undefined);
  assert.equal(startup.window.location.hash, '#early-access-agent');
  assert.equal(startup.exchanges.length, 1);

  const ui = fixture();
  const local = {Conversation: 'old', Messages: ['old'], RunID: 'old-run', Buffer: {progress: 'old'}, ShowConversationPanel: true};
  Object.assign(ui.page, {local, tick() {}, t(_key, fallback) { return fallback; }, call: async () => ({error: denied()})});
  install.call(ui.page);
  const resuming = ui.page.call('lib_ConvertigoAssistant.AgentResumeConversation');
  await flush();
  assert.equal(local.AgentResumePending, true);
  ui.reply();
  await assert.rejects(resuming);
  assert.equal(local.Conversation, 'old');
  assert.deepEqual(local.Messages, ['old']);
  assert.equal(local.RunID, 'old-run');
  assert.deepEqual(local.Buffer, {progress: 'old'});
  assert.equal(local.ShowConversationPanel, true);
  assert.equal(local.AgentResumePending, false);
  assert.ok(local.AgentOperationError);

  const malformed = fixture();
  Object.assign(malformed.page, {local: {}, tick() {}, t(_k, fallback) { return fallback; }, call: async () => ({})});
  install.call(malformed.page);
  await assert.rejects(malformed.page.call('lib_ConvertigoAssistant.AgentResumeConversation'), /invalid_resume_response/);
  assert.equal(malformed.requests.length, 0);

  const server = fixture({iframe: true});
  let serverCalls = 0;
  Object.assign(server.page, {local: {}, isServerAgentSurface: () => true,
    tick() {}, t(_key, fallback) { return fallback; },
    call: async () => { serverCalls++; return {result: {error: {message: 'Internal error with secret details'}}}; }});
  install.call(server.page);
  await assert.rejects(server.page.call('lib_ConvertigoAssistant.AgentSendMessageRouter'));
  assert.match(server.page.local.AgentOperationError, /serveur/);
  assert.doesNotMatch(server.page.local.AgentOperationError, /Studio|secret details/);
  assert.equal(serverCalls, 1, 'never replay a failed server operation');
  assert.equal(server.requests.length, 0);

  const setupResponse = {result: {ok: false, status: 'setup_required', setupRequired: true,
    setup: {status: 'authentication_required'}, AIData: {explanation: 'Configure the Convertigo agent key'}}};
  const setupPage = {local: {}, global: server.page.global, tick() {}, t(_k, fallback) { return fallback; }, call: async () => setupResponse};
  install.call(setupPage);
  assert.equal(await setupPage.call('lib_ConvertigoAssistant.AgentSendMessageRouter'), setupResponse);
  assert.equal(setupPage.local.AgentOperationError, '', 'structured setup guidance must reach generated UI actions');

  const success = fixture();
  let successfulCalls = 0;
  const payload = {result: {id: 'resumed', state: {status: 'idle'}, AIData: {messages: []}}};
  Object.assign(success.page, {local: {Conversation: 'old'}, tick() {}, t(_k, fallback) { return fallback; },
    call: async () => ++successfulCalls === 1 ? {error: denied()} : payload});
  install.call(success.page);
  const successfulResume = success.page.call('lib_ConvertigoAssistant.AgentResumeConversation');
  await flush(); success.reply();
  assert.equal(await successfulResume, payload, 'preserve response for generated success actions');
  assert.equal(success.page.local.AgentOperationError, '');
  assert.equal(success.page.local.AgentResumePending, false);
  assert.equal(successfulCalls, 2);

  const unaffected = {local: {}, global: {}, call: () => 'original', tick() { throw new Error('unrelated UI changed'); }};
  install.call(unaffected);
  assert.equal(unaffected.call('lib_ConvertigoAssistant.OtherSequence'), 'original');
  assert.equal(unaffected.call('lib_ConvertigoAssistant.AgentReadResponseRouter'), 'original');

  assert.match(appSource, /completeStudioSessionRenewal\(msg\)/);
  assert.match(pageSource, /AgentOperationError.*role="alert"/);
  for (const priority of ['1781608120621', '1781608120623', '1781608120625']) {
    assert.ok(!pageSource.includes('UIDynamicAction-' + priority), 'no destructive pre-resume action');
  }
  console.log('Assistant session recovery tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
