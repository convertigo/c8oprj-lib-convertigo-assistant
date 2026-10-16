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

test('native context requests wait for a reply receiver instead of racing application initialization', () => {
  const ast=ts.createSourceFile('page.ts',pageClass(),ts.ScriptTarget.Latest,true);
  const names=['ensureAgentNativeContextBridge','requestAgentHostContext','postAgentHostMessage'];
  const members=ast.statements[0].members.filter(m=>names.includes(m.name?.getText(ast)));
  const code=ts.transpileModule('class Page {'+members.map(m=>m.getText(ast)).join('\n')+'};this.Page=Page;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const sent=[],timers=[];
  const sandbox={window:{java:{receiveFromJS(value){sent.push(JSON.parse(value));assert.equal(typeof sandbox.window.receiveFromJava,'function');}}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.runInNewContext(code,sandbox);const page=new sandbox.Page();page.agentHostContextMessageHandler=()=>{};
  page.requestAgentHostContext();assert.equal(sent.length,0,'Java must not reply into an undefined receiver');
  assert.equal(timers.length,1,'the existing bounded retry is retained');
  let delivered=0;sandbox.window.receiveFromJava=()=>delivered++;
  timers.shift()();assert.equal(sent[0].type,'lib_ConvertigoAssistant.context.request');
  assert.equal(sent.length,2);sandbox.window.receiveFromJava({type:'init'});assert.equal(delivered,1);
});

test('application registers its native receiver even when Java is injected after the web listener', () => {
  const {blockWith}=require('./helpers/assistant-source.cjs');
  const body=blockWith('_c8oProject/mobileNgxApp.yaml','// Release switch for the Eclipse Studio agent');
  const initialize=new Function('page','props','window','document','resolve','Events','setTimeout',body.replace(/page as any/g,'page'));
  let webListener;const sent=[];
  const window={location:{hash:'',search:'',pathname:'/'},parent:{postMessage(){}},addEventListener(_name,callback){webListener=callback;}};
  const page={global:{},local:{},c8o:{log:{debug(){},warn(){}}},angularRouter:{url:'/path-to-xfirst/existing?agentBridge=1',navigate(){}},tick(){},getInstance(){return {publish(){}}}};
  initialize(page,{},window,{title:'Assistant'},()=>{}, {},fn=>fn());
  assert.equal(typeof window.receiveFromJava,'function');assert.equal(typeof webListener,'function');
  window.java={receiveFromJS(value){sent.push(JSON.parse(value));}};
  window.receiveFromJava({type:'init'});
  assert.equal(sent[0].type,'lib_ConvertigoAssistant.context.request');
  window.receiveFromJava({type:'select',projectName:'Example',threadQname:'Example.Sequence'});
  assert.equal(page.global.projectName,'Example');assert.equal(page.global.studio,true);
});
