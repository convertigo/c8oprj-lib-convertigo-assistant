const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {ts,read,backendParts,blockWith} = require('./helpers/assistant-source.cjs');
const ast=ts.createSourceFile('bridge.js',read('js/agent_bridge_client.js'),ts.ScriptTarget.Latest,true);
let setupAgent;
function visit(n) {
  if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='C8O.assistantAgentBridge.setupAgent') setupAgent=n.right.getText(ast);
  ts.forEachChild(n,visit);
}
visit(ast);assert.ok(setupAgent);
function fixture(provider,options,authenticated=false) {
  const login={ok:true,status:authenticated?'authenticated':'waiting_for_login',authenticated,
    verificationUrl:'https://claude.com/cai/oauth/authorize?state=test'};
  const state={provider,threadid:''};let calls=0;
  const sandbox={
    trim:v=>String(v??'').trim(),optionsWithRequestFallbacks:v=>v,normalizeThreadId:v=>v||'',
    createState:()=>state,ensureState:v=>v,runtimeSetupRequested:()=>false,
    stateForExplicitProviderSetup:s=>({state:s,isolated:true}),stateForRuntimeSetup:v=>v,
    normalizeProvider:v=>v,isResidentProvider:p=>['codex','claude','vibe'].includes(p),
    callAgentSetup:()=>{calls++;return {result:login};},providerLoginAction:p=>p+'_login',
    now:()=>1,publicState:()=>({}),saveState(){throw Error('Unexpected persistence');},
    setStateBuffer(){throw Error('Unexpected persistence');},bridgeCallerRefusal:()=>null,withCallerUserId:o=>o||{}
  };
  vm.runInNewContext(backendParts(['boolValue','hasProviderLoginRequest'])+'\nvar setupAgent='+setupAgent+';',sandbox);
  return {result:sandbox.setupAgent({provider,...options}),calls};
}
for(const provider of ['codex','claude','vibe']) {
  test(provider+' string-valued login polling preserves the browser URL and login envelope',()=>{
    for(const flag of ['loginStatus',provider+'LoginStatus']) {
      const {result,calls}=fixture(provider,{login:'false',loginStatus:'false',[flag]:'true'});
      assert.equal(result.object,'agent.login');assert.equal(result.status,'waiting_for_login');
      assert.equal(result.login.verificationUrl,'https://claude.com/cai/oauth/authorize?state=test');
      assert.equal(result.setupRequired,true);assert.equal(calls,1);
    }
    const {result}=fixture(provider,{login:'false',loginStatus:'true'},true);
    assert.equal(result.status,'authenticated');assert.equal(result.setupRequired,false);
  });
}
test('false and absent login flags do not request authentication',()=>{
  const sandbox={trim:v=>String(v??'').trim()};
  vm.runInNewContext(backendParts(['boolValue','hasProviderLoginRequest']),sandbox);
  assert.equal(sandbox.hasProviderLoginRequest({}),false);
  assert.equal(sandbox.hasProviderLoginRequest({login:'false',loginStatus:'false',claudeLogin:'0'}),false);
  assert.equal(sandbox.hasProviderLoginRequest({login:false,loginStatus:true}),true);
});

test('sign-in opens a delayed CLI fallback URL once, polls without installing and restores the settings',async()=>{
  const action=blockWith('_c8oProject/mobilePages/Page.yaml','var loginStartedAt = Date.now();');
  const code=ts.transpileModule('function loginAction(page,props,vars,event,resolve,reject){'+action+'}',
    {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const timers=[],calls=[],opened=[],refreshes=[];
  const url='https://claude.com/cai/oauth/authorize?state=test';
  const responses=[
    {status:'waiting_for_login',login:{}},
    {status:'waiting_for_login',login:{manualUrl:url}},
    {status:'waiting_for_login',login:{manualUrl:url}},
    {status:'authenticated',login:{authenticated:true}}
  ];
  const page={local:{AgentProvider:'claude',AgentAuthenticationRequired:true,AgentModel:'opus',
      AgentSettings:{providers:[{id:'claude',models:[{id:'opus'}]}]}},
    t:(_key,fallback)=>fallback,tick(){},
    openAgentExternalUrl:u=>opened.push(u),refreshAgentSettingsAfterHostContext:force=>refreshes.push(force),
    c8o:{callJsonObject(name,payload){
      calls.push({name,payload:{...payload}});
      return {async:()=>Promise.resolve({result:{ok:true,...responses.shift()}})};
    }}
  };
  const sandbox={Date,window:{setTimeout:fn=>timers.push(fn)}};
  vm.runInNewContext(code,sandbox);
  let resolved=false;
  sandbox.loginAction(page,{},{},null,()=>{resolved=true;},error=>{throw error;});
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  await flush();assert.equal(page.local.AgentRuntimeLoading,true);assert.equal(opened.length,0);
  for(let i=0;i<3;i++){assert.ok(timers.length);timers.shift()();await flush();}
  assert.deepEqual(opened,[url]);assert.equal(calls.length,4);
  assert.equal(calls[0].payload.login,true);assert.equal(calls[1].payload.login,false);
  assert.equal(calls[1].payload.loginStatus,true);
  assert.ok(calls.every(c=>c.payload.install===false&&c.payload.updateRuntime===false));
  assert.equal(page.local.AgentRuntimeLoading,false);assert.equal(page.local.AgentAuthenticationRequired,false);
  assert.deepEqual(refreshes,[true]);assert.equal(resolved,true);
});
