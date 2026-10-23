const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {read}=require('./helpers/assistant-source.cjs');
// Execute the canonical step, rather than a copy of the credential-switch logic.
const lines=read('_c8oProject/sequences/TigoAccessBootstrap.yaml').split('\n');
const step=lines.findIndex(l=>/↓InstallLocalAccess \[/.test(l));assert.ok(step>=0);
const start=lines.findIndex((l,i)=>i>step&&/expression: \|/.test(l));assert.ok(start>step);
const indent=lines[start].search(/\S/),body=[];
for(let i=start+1;i<lines.length;i++){
 if(lines[i].trim()&&lines[i].search(/\S/)<=indent)break;
 body.push(lines[i].slice(indent+2));
}
let source=body.join('\n').trim();
if(source.startsWith("'")&&source.endsWith("'"))source=source.slice(1,-1).replace(/''/g,"'");
function fixture(previousKey,failMetadata){
 const selected='sk-'+ 'a'.repeat(43),files=new Map(),calls=[];
 if(previousKey)files.set('key',previousKey+'\n');files.set('meta','previous metadata');
 const writer={restrict(){},writePrivate(path,text){calls.push(path);if(path==='meta'&&failMetadata)throw new Error('metadata denied');files.set(path,text);}};
 const ctx={
  remoteResult:{HttpInfo:{status:{code:200}},object:{response:{status:'ok',apiKey:selected,baseUrl:'https://llm.convertigo.com/v1',account:{email:'test@example.invalid',subject:'s'},quota:{activeScope:'team'}}}},
  response:null,email:'test@example.invalid',directory:'directory',keyPath:'key',metadataPath:'meta',existingKey:previousKey||'',secret:'',localAccess:null,
  safePath(){},hashLocal:s=>'hash:'+s,include(){},log:{warn(){}},
  TigoAccessFiles:{create:()=>writer,failure:(_e,operation)=>({operation,cause:'access_denied'})},
  context:{httpSession:{setAttribute(){}}},
  java:{lang:{String},nio:{file:{Files:{createDirectories(){},isRegularFile:p=>files.has(p),readAllBytes:p=>files.get(p),deleteIfExists:p=>files.delete(p)}}}}
 };
 vm.runInNewContext(source,ctx);
 return {response:ctx.response,files,calls,selected};
}
test('switch failure restores the old managed key so retry does not classify it as manual',()=>{
 const old='sk-'+ 'b'.repeat(43),f=fixture(old,true);
 assert.equal(f.response.code,'local_installation_failed');assert.equal(f.response.diagnostic.previousKeyRestored,true);
 assert.equal(f.files.get('key'),old+'\n');assert.equal(f.files.get('meta'),'previous metadata');
});
test('first-install metadata failure leaves no unmanaged credential behind',()=>{
 const f=fixture('',true);assert.equal(f.response.status,'error');assert.equal(f.files.has('key'),false);
});
test('successful switching updates the selected key and its matching metadata',()=>{
 const f=fixture('sk-'+ 'b'.repeat(43),false);assert.equal(f.response.status,'ok');
 assert.equal(f.files.get('key'),f.selected+'\n');
 assert.equal(JSON.parse(f.files.get('meta')).keyHash,'hash:'+f.selected);
 assert.equal(JSON.parse(f.files.get('meta')).quota.activeScope,'team');
});
test('an unchanged key is not rewritten on every membership refresh',()=>{
 const f=fixture('sk-'+ 'a'.repeat(43),false);assert.equal(f.response.status,'ok');assert.deepEqual(f.calls,['meta']);
});
