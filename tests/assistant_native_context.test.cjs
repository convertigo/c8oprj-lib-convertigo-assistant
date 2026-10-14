const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {ts,pageClass} = require('./helpers/assistant-source.cjs');

test('late Java message receiver forwards native context once and restores its delegate', () => {
  const ast=ts.createSourceFile('page.ts',pageClass(),ts.ScriptTarget.Latest,true);
  const methods=ast.statements[0].members.filter(m => ['ensureAgentNativeContextBridge','requestAgentHostContext','unbindAgentHostContextListener'].includes(m.name?.getText(ast))).map(m => m.getText(ast));
  assert.equal(methods.length,3);
  const code=ts.transpileModule('class NativeContextPage {'+methods.join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const sandbox={window:{removeEventListener(){}},clearTimeout(){},setTimeout(){throw Error('No timer needed for final retry');}};
  vm.runInNewContext(code+';this.NativeContextPage=NativeContextPage;',sandbox);
  const page=new sandbox.NativeContextPage();let forwarded=0,delegated=0;
  page.postAgentHostMessage=()=>{};
  page.agentHostContextMessageHandler=event => {assert.equal(event.__agentNativeHost,true);assert.equal(event.data.payload.studioVersion,'8.4.7_beta');forwarded++;};
  page.requestAgentHostContext(5);
  assert.equal(sandbox.window.receiveFromJava,undefined);
  const native=()=>delegated++;
  sandbox.window.receiveFromJava=native;
  page.requestAgentHostContext(5);
  const receiver=sandbox.window.receiveFromJava;
  page.requestAgentHostContext(5);
  assert.equal(sandbox.window.receiveFromJava,receiver,'do not stack wrappers on retries');
  receiver({type:'lib_ConvertigoAssistant.context',payload:{studioVersion:'8.4.7_beta'}});
  assert.equal(forwarded,1);assert.equal(delegated,1);
  page.unbindAgentHostContextListener();
  assert.equal(sandbox.window.receiveFromJava,native);
});
