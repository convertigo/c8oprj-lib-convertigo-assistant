const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {ts,read}=require('./helpers/assistant-source.cjs');
const ast=ts.createSourceFile('client.js',read('js/agent_bridge_client.js'),ts.ScriptTarget.Latest,true);
let fn;
(function visit(n){if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='C8O.assistantAgentBridge.refreshTigoAccess')fn=n.right.getText(ast);ts.forEachChild(n,visit);})(ast);
assert.ok(fn);
function refresh(reply){
 const calls=[];const ctx={callLocalSequence(...args){calls.push(args);return reply;}};
 vm.runInNewContext('var refresh='+fn,ctx);return {result:ctx.refresh(),calls};
}
test('selected credentials are refreshed from the trusted Studio sequence using its PSC',()=>{
 const quota={activeScope:'team',personal:{balanceUsd:10},team:{name:'Convertigo'}};
 const {result,calls}=refresh({document:{response:{status:'ok',quota}}});
 assert.equal(result.quota.activeScope,'team');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['lib_ConvertigoAssistant','TigoAccessBootstrap',{refresh:'true'}]]);
});
test('membership or transport failure never returns a successful personal fallback',()=>{
 for(const reply of [null,{document:{error:{message:'internal'}}},{document:{response:{status:'error',code:'user_budget_migration_required',error:'Migration required'}}}]){
  const {result}=refresh(reply);assert.equal(result.status,'error');assert.ok(result.code);
 }
});
