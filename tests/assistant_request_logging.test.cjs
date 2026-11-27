const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, blockWith, read } = require('./helpers/assistant-source.cjs');
const { of, tap } = require('../_private/ionic/node_modules/rxjs');

function loggingInterceptor() {
  const yaml = '_c8oProject/mobileNgxApp.yaml';
  assert.match(read(yaml), /provide: HTTP_INTERCEPTORS, useValue: AppComponent\.tigoLogging, multi: true/);
  const source = blockWith(yaml, '/*Begin_c8o_AppDeclaration*/').split('/*Begin_c8o_AppDeclaration*/')[1]
    .split('/*End_c8o_AppDeclaration*/')[0];
  const code = ts.transpile('class AppComponent {' + source + '}', { target: ts.ScriptTarget.ES2022 });
  return vm.runInNewContext(code + ';AppComponent.tigoLogging', { URLSearchParams, tap });
}

test('only panel requests carry the quiet query, including multipart, until GetVersion enables diagnostics', () => {
  const interceptor = loggingInterceptor();
  function send(project, sequence, response = {}, multipart = false) {
    const fields = new URLSearchParams({ __project: project, __sequence: sequence });
    const form = new FormData();
    for (const [key, value] of fields) form.set(key, value);
    const request = { method: 'POST', url: '/projects/lib_ConvertigoAssistant/.json',
      body: multipart ? form : fields.toString(), clone: options => ({ ...request, ...options }) };
    let received;
    interceptor.intercept(request, { handle: r => { received = r; return of({ body: response }); } }).subscribe();
    return received.setParams?.__nolog;
  }
  assert.equal(send('lib_ConvertigoAssistant', 'AgentReadResponseRouter'), 'true');
  assert.equal(send('lib_ConvertigoAgentBridge', 'agent_status', {}, true), 'true');
  assert.equal(send('MyProject', 'AgentQuota'), undefined);
  assert.equal(send('lib_ConvertigoAssistant', 'GetVersion', { document: { tigoNoLog: 'false' } }), 'true');
  assert.equal(send('lib_ConvertigoAssistant', 'AgentFeedback'), undefined);
  send('lib_ConvertigoAssistant', 'GetVersion', { tigoNoLog: 'true' });
  assert.equal(send('lib_ConvertigoAssistant', 'AgentQuota'), 'true');
});
