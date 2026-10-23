const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {ts, pageClass} = require('./helpers/assistant-source.cjs');
const code = ts.transpileModule(pageClass(), {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function page(quota, language='fr') {
  const box={};vm.runInNewContext(code+';this.Page=Page;',box);
  const p=new box.Page();
  p.global={language};p.translate={currentLang:language};
  p.local={Conversation:'c',AgentQuotaConversation:'c',AgentQuota:{provider:'convertigo',available:true,kind:'credit',...quota}};
  p.isAgentBridgeMode=()=>true;p.getAgentProvider=()=> 'convertigo';p.getAgentProviderLabel=()=> 'Tigo';
  return p;
}
const personal={budgetUsd:10,spentUsd:2,balanceUsd:8,keyState:'active'};
const team={id:'team-test',name:'Convertigo',budgetUsd:1000,spentUsd:100,balanceUsd:900,keyState:'active',member:{spentUsd:15,budgetUsd:50,balanceUsd:35,budgetResetAt:'2026-11-01T00:00:00Z'}};
test('team quota separates shared, own team usage and preserved personal credit',()=>{
  const p=page({activeScope:'team',...team,personal,team});const v=p.getAgentQuotaView();
  assert.match(v.summary,/Équipe.*Convertigo.*Accès actif/);
  assert.equal(v.rows.length,3);
  assert.match(v.rows[0].title,/Budget partagé/);assert.match(v.rows[0].usage,/100.00.*1000.00/);
  assert.match(v.rows[1].title,/Votre consommation/);assert.match(v.rows[1].usage,/15.00.*50.00/);assert.ok(v.rows[1].reset);
  assert.match(v.rows[2].title,/Personnel.*Conservé/);assert.match(v.rows[2].usage,/2.00.*10.00/);
  assert.equal(v.percent,30,'the tighter member limit drives the arc');
});
test('an exhausted team never displays personal credit as the active allowance',()=>{
  const exhausted={...team,spentUsd:1000,balanceUsd:0,keyState:'exhausted'};
  const p=page({activeScope:'team',...exhausted,personal,team:exhausted});const v=p.getAgentQuotaView();
  assert.match(v.summary,/Équipe.*0.00.*Crédit épuisé/);assert.equal(v.percent,100);assert.equal(v.color,'#ef4444');
  assert.match(v.rows[2].title,/Conservé/);
});
test('leaving a team shows the unchanged personal balance as active',()=>{
  const p=page({activeScope:'personal',...personal,personal,team:null});const v=p.getAgentQuotaView();
  assert.equal(v.rows.length,1);assert.match(v.summary,/Personnel.*8.00/);assert.equal(v.percent,20);
});
test('unknown member spend is not zero, and unlimited team budgets are not zero',()=>{
  const unlimited={...team,budgetUsd:null,balanceUsd:null,member:{spentUsd:null,budgetUsd:null}};
  const v=page({activeScope:'team',...unlimited,personal,team:unlimited},'en').getAgentQuotaView();
  assert.match(v.summary,/No individual limit/);assert.match(v.rows[1].usage,/Usage unavailable/);
  assert.equal(v.percent,null);assert.doesNotMatch(v.summary,/NaN|0.00/);
  assert.match(v.rows[2].title,/Personal.*Preserved/);
});

test('a change of active team refreshes model metadata, without reinstalling a runtime',()=>{
  const p=page({activeScope:'personal',...personal,personal,team:null});let refreshes=0;
  p.refreshAgentModelCatalog=()=>refreshes++;p.tick=()=>{};
  const q={provider:'convertigo',available:true,kind:'credit',activeScope:'team',...team,personal,team};
  p.applyAgentQuotaSnapshot(q,'convertigo');assert.equal(refreshes,1);
  assert.match(p.local.AgentQuotaMessage,/Équipe.*Convertigo/);
  p.applyAgentQuotaSnapshot(q,'convertigo');assert.equal(refreshes,1);
  p.applyAgentQuotaSnapshot({provider:'convertigo',available:true,kind:'credit',activeScope:'personal',...personal,personal,team:null},'convertigo');
  assert.equal(refreshes,2);assert.match(p.local.AgentQuotaMessage,/Personnel/);
});

test('known own spend does not imply an unlimited member allowance when the cap was not reported',()=>{
  const unknownCap={...team,member:{spentUsd:15,budgetUsd:null,budgetReported:false}};
  const v=page({activeScope:'team',...unknownCap,personal,team:unknownCap},'en').getAgentQuotaView();
  assert.match(v.rows[1].usage,/15.00/);assert.doesNotMatch(v.rows[1].usage,/No individual limit/);
});
