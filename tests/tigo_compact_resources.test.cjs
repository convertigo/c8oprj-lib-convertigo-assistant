const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {ts,pageClass,blockWith}=require('./helpers/assistant-source.cjs');
function methods(source,names){
 const ast=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);
 const members=ast.statements.find(ts.isClassDeclaration).members.filter(m=>m.name&&names.includes(m.name.getText(ast)));
 assert.equal(members.length,names.length);
 const out=ts.transpileModule('class Subject {'+members.map(m=>m.getText(ast)).join('\n')+'}; this.Subject=Subject;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const sandbox={};vm.runInNewContext(out,sandbox);return new sandbox.Subject();
}
const footer=blockWith('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml','/*Begin_c8o_CompImport*/');
test('quick resource panels are exclusive, collapse on second click and preserve the prompt draft',()=>{
 const f=methods('class Footer {'+footer.slice(footer.indexOf('/*Begin_c8o_CompFunction*/'))+'}', ['toggleResourceTab','quickResources','resourceCaption']);
 Object.assign(f,{resourceTab:'prompts',Question:'Keep my draft',tick(){},translate:{currentLang:'fr'},ResourceSkills:[{key:'skill'}],ResourceMcp:[{key:'mcp'}]});
 f.toggleResourceTab('skills');assert.equal(f.resourceTab,'skills');assert.equal(f.quickResources()[0].key,'skill');
 f.toggleResourceTab('mcp');assert.equal(f.resourceTab,'mcp');assert.equal(f.quickResources()[0].key,'mcp');
 f.toggleResourceTab('mcp');assert.equal(f.resourceTab,'');assert.equal(f.Question,'Keep my draft');
 assert.equal(f.resourceCaption('manage'),'Configurer la bibliothèque');f.translate.currentLang='en';assert.equal(f.resourceCaption('manage'),'Manage library');
 f.owner={global:{currentLanguage:()=> 'fr'}};assert.equal(f.resourceCaption('manage'),'Configurer la bibliothèque','the shared component follows the owning page language');
});
test('favorites move in both directions and reject moves outside their bounds',()=>{
 const p=methods(pageClass(),['moveTigoFavorite','canMoveTigoFavorite']);
 const calls=[];p.local={ResourceCatalog:{favorites:['a','b','c']}};p.requestTigoResources=(_force,request)=>calls.push(request);
 assert.equal(p.canMoveTigoFavorite({key:'a'},-1),false);assert.equal(p.canMoveTigoFavorite({key:'c'},1),false);
 p.moveTigoFavorite({key:'b'},1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0].input.favorites)),['a','c','b']);
 p.moveTigoFavorite({key:'b'},-1);assert.deepEqual(JSON.parse(JSON.stringify(calls[1].input.favorites)),['b','a','c']);
 p.moveTigoFavorite({key:'missing'},1);assert.equal(calls.length,2);
});
test('changing configuration category hides an editor without losing its draft',()=>{
 const p=methods(pageClass(),['onTigoResourcesAccordionChange','cancelTigoResourceEditor']);
 p.local={ResourceAccordion:'skills',ResourceEditorKind:'skill',ResourceEditorOpen:true,ResourceEditorPending:true,ResourceEditTitle:'My skill',ResourceEditBody:'Keep these instructions'};p.tick=()=>{};
 p.onTigoResourcesAccordionChange({target:{tagName:'ION-SELECT'},detail:{value:'workspace'}});
 assert.equal(p.local.ResourceAccordion,'skills');assert.equal(p.local.ResourceEditorOpen,true);
 p.onTigoResourcesAccordionChange({target:{tagName:'ION-ACCORDION-GROUP'},detail:{value:'runtime'}});
 assert.equal(p.local.ResourceEditorOpen,false);assert.equal(p.local.ResourceEditBody,'Keep these instructions');
 p.onTigoResourcesAccordionChange({target:{tagName:'ION-ACCORDION-GROUP'},detail:{value:'skills'}});
 assert.equal(p.local.ResourceEditorOpen,true);assert.equal(p.local.ResourceEditTitle,'My skill');
 p.cancelTigoResourceEditor();
 p.onTigoResourcesAccordionChange({target:{tagName:'ION-ACCORDION-GROUP'},detail:{value:'skills'}});
 assert.equal(p.local.ResourceEditorOpen,false);
});
test('optional skill connections can be selected independently and built-ins stay read-only',()=>{
 const p=methods(pageClass(),['toggleTigoEditorMcp']);p.local={ResourceEditRequiresMcp:[]};p.tick=()=>{};
 p.toggleTigoEditorMcp('project::mcp:company');assert.deepEqual(Array.from(p.local.ResourceEditRequiresMcp),['project::mcp:company']);
 p.toggleTigoEditorMcp('workspace::mcp:docs');p.toggleTigoEditorMcp('project::mcp:company');
 assert.deepEqual(Array.from(p.local.ResourceEditRequiresMcp),['workspace::mcp:docs']);
 p.local.ResourceEditorReadonly=true;p.toggleTigoEditorMcp('workspace::mcp:docs');
 assert.deepEqual(Array.from(p.local.ResourceEditRequiresMcp),['workspace::mcp:docs']);
});
