const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {ts,pageClass}=require('./helpers/assistant-source.cjs');
const ast=ts.createSourceFile('diagnostic.ts',pageClass(),ts.ScriptTarget.Latest,true);
const method=ast.statements[0].members.find(x=>x.name&&x.name.getText(ast)==='getAgentWindowsDiagnosticText');
const code=ts.transpileModule('class Page {'+method.getText(ast)+'}\nthis.Page=Page;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
for(const language of ['fr','en'])test('Windows storage diagnostic explains the configured root and conservative budget: '+language,()=>{
 const box={};vm.runInNewContext(code,box);const page=new box.Page();
 Object.assign(page,{agentUiLanguage:()=>language,t:(_key,fallback)=>fallback,getAgentSettingsRoot:()=>({diagnostics:{platform:'windows',longPaths:{registryEnabled:false,fileSystemProbe:'failed'},agentsDirectory:{directory:'C:\\Team\\Tigo',configured:true,rootLength:12,status:'low_margin',estimatedLongestPathLength:240,pathLimit:259,recommendedMaxRootLength:37,safetyMargin:32}}})});
 const text=page.getAgentWindowsDiagnosticText();
 assert.match(text,/assistant\.agents\.directory/);assert.match(text,/C:\\Team\\Tigo/);assert.match(text,/240 \/ 259/);assert.match(text,/37/);assert.match(text,/12/);assert.match(text,language==='fr'?/défini/:/configured/);assert.match(text,/32/);assert.match(text,/Administration > Symbols/);
 assert.match(text,language==='fr'?/données existantes ne sont pas déplacées/:/Existing data is not moved/);
});
test('Windows storage advice is not shown on another platform',()=>{
 const box={};vm.runInNewContext(code,box);const page=new box.Page();page.getAgentSettingsRoot=()=>({diagnostics:{platform:'linux'}});assert.equal(page.getAgentWindowsDiagnosticText(),'');
});
