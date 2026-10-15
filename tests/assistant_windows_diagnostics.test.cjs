const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {ts,pageClass,blockWith}=require('./helpers/assistant-source.cjs');

function diagnosticPage(diagnostics,language='fr') {
  const ast=ts.createSourceFile('page.ts',pageClass(),ts.ScriptTarget.Latest,true);
  const methods=ast.statements[0].members.filter(m=>['t','getAgentWindowsDiagnosticText'].includes(m.name?.getText(ast))).map(m=>m.getText(ast));
  assert.equal(methods.length,2);
  const code=ts.transpileModule('class DiagnosticPage{'+methods.join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const scope={};vm.runInNewContext(code+';this.DiagnosticPage=DiagnosticPage;',scope);
  const page=new scope.DiagnosticPage();
  page.global={language};page.translate={currentLang:language};page.getAgentSettingsRoot=()=>({diagnostics});
  return page;
}

test('Windows warning distinguishes disabled settings, failed probes and permissions with recovery instructions',()=>{
  const page=diagnosticPage({platform:'windows',longPaths:{registryEnabled:false,fileSystemProbe:'failed'}});
  let text=page.getAgentWindowsDiagnosticText();
  assert.match(text,/désactivés/);assert.match(text,/260 caractères/);assert.match(text,/redémarrez Windows/);assert.match(text,/runtime/);
  page.getAgentSettingsRoot=()=>({diagnostics:{platform:'windows',longPaths:{registryEnabled:true,fileSystemProbe:'unknown'}}});
  text=page.getAgentWindowsDiagnosticText();assert.match(text,/droits d’écriture/);assert.doesNotMatch(text,/désactivés/);
});
test('diagnostics stay hidden on other platforms and when Windows checks pass',()=>{
  for(const diagnostics of [null,{platform:'linux'},{platform:'windows',longPaths:{registryEnabled:true,fileSystemProbe:'supported'}},{platform:'windows',longPaths:{registryEnabled:null,fileSystemProbe:'not_checked'}}]) {
    assert.equal(diagnosticPage(diagnostics).getAgentWindowsDiagnosticText(),'');
  }
});
test('bad PATH metadata remains actionable without exposing path contents; English is translated',()=>{
  const page=diagnosticPage({platform:'windows',longPaths:{registryEnabled:true,fileSystemProbe:'supported'},pathIssues:[{source:'path',index:3,pathLength:84,code:'invalid_path',value:'PRIVATE-PATH'}]},'en');
  const text=page.getAgentWindowsDiagnosticText();
  assert.match(text,/PATH \[3\].*84 characters.*invalid path syntax/);assert.doesNotMatch(text,/PRIVATE-PATH/);
});
test('an empty startup response preserves the confirmed Claude model; real conversation resumes restore their model',()=>{
  const action=blockWith('_c8oProject/mobilePages/Page.yaml','An empty startup response must not replace');
  const code=ts.transpileModule('function applyHistory(page,props,vars,event,resolve,reject){'+action+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const scope={window:{clearInterval(){}}};vm.runInNewContext(code,scope);
  function apply(result) {
    const page={local:{AgentProvider:'claude',AgentModel:'opus',Messages:[]},c8o:{log:{debug(){}}},tick(){}};
    scope.applyHistory(page,{stack:{'1744302843894':{out:{result}}}},{},null,()=>{},error=>{throw error;});
    return page.local;
  }
  assert.equal(apply({status:'agent_selection_required',provider:'',model:'glm-5-3'}).AgentModel,'opus');
  const resumed=apply({state:{provider:'codex',model:'gpt-5.6-luna'}});
  assert.equal(resumed.AgentProvider,'codex');assert.equal(resumed.AgentModel,'gpt-5.6-luna');
});
