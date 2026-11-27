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
// The real failure diagnostic, log line and lock of js/tigo_access_files.js; the writer is a fake filesystem.
const filesSource=read('js/tigo_access_files.js');
const selected='sk-'+'a'.repeat(43),hash=s=>'hash:'+s;
const lockedError={javaException:{getClass:()=>({getSimpleName:()=>'AccessDeniedException'})},message:'SECRET path agents/convertigo'};
function metadataFor(key,extra){return JSON.stringify({version:1,source:'TigoAccess',subject:'s',email:'test@example.invalid',keyHash:hash(key),...extra});}
// previousKey: the key in place; metadata: the metadata in place (default: unreadable);
// fail: {key|meta: true} makes that write fail as a held file; onFail(files): what another tab wrote meanwhile.
function fixture({previousKey,metadata,fail={},onFail}={}){
 const files=new Map(),calls=[],warnings=[];let locked=0;
 if(previousKey)files.set('key',previousKey+'\n');files.set('meta',metadata===undefined?'previous metadata':metadata);
 const writer={restrict(){calls.push('restrict');},attempts:()=>6,writePrivate(path,text){
  assert.equal(locked,1,'every write runs under the installation lock');
  calls.push(path);if(fail[path]){if(onFail)onFail(files);throw lockedError;}files.set(path,text);return true;}};
 const directory={toAbsolutePath:()=>({normalize:()=>'/workspace/agents/convertigo'})};
 const ctx={
  remoteResult:{HttpInfo:{status:{code:200}},object:{response:{status:'ok',apiKey:selected,baseUrl:'https://llm.convertigo.com/v1',account:{email:'test@example.invalid',subject:'s'},quota:{activeScope:'team'}}}},
  response:null,email:'test@example.invalid',directory,keyPath:'key',metadataPath:'meta',existingKey:previousKey||'',secret:'',localAccess:null,
  safePath(){},hashLocal:hash,include(){},log:{warn(line){warnings.push(line);}},
  context:{httpSession:{setAttribute(name,value){calls.push('cache');}}},
  Packages:{org:{mozilla:{javascript:{Synchronizer:function(fn){return()=>{locked++;try{return fn();}finally{locked--;}};}}}}},
  java:{lang:{String:function(value){const text=String(value);this.toString=()=>text;this.trim=()=>text.trim();this.intern=()=>text;}},
   nio:{file:{Files:{createDirectories(){},isRegularFile:p=>files.has(p),size:p=>String(files.get(p)).length,readAllBytes:p=>files.get(p),deleteIfExists:p=>{calls.push('delete '+p);files.delete(p);}}}}}
 };
 vm.runInNewContext(filesSource,ctx);
 ctx.TigoAccessFiles.create=()=>writer;
 vm.runInNewContext(source,ctx);
 return {response:ctx.response,files,calls,warnings};
}
test('switch failure restores the old managed key so retry does not classify it as manual',()=>{
 const old='sk-'+'b'.repeat(43),f=fixture({previousKey:old,metadata:metadataFor(old),fail:{meta:true}});
 assert.equal(f.response.code,'local_installation_failed');assert.equal(f.response.diagnostic.previousKeyRestored,true);
 assert.equal(f.files.get('key'),old+'\n');assert.equal(f.files.get('meta'),metadataFor(old));
 assert.deepEqual({...f.response.diagnostic},{operation:'write_metadata',cause:'access_denied',exception:'AccessDeniedException',attempts:6,previousKeyRestored:true});
 assert.deepEqual(f.warnings,['TigoAccess local credential installation failed (write_metadata, access_denied): AccessDeniedException, 6 move attempts']);
 assert.equal(f.calls.includes('cache'),false);
});
test('first-install metadata failure leaves no unmanaged credential behind',()=>{
 const f=fixture({fail:{meta:true}});assert.equal(f.response.status,'error');assert.equal(f.files.has('key'),false);
 assert.match(f.warnings[0],/^TigoAccess local credential installation failed \(write_metadata, access_denied\)/);
});
test('successful switching updates the selected key and its matching metadata',()=>{
 const f=fixture({previousKey:'sk-'+'b'.repeat(43)});assert.equal(f.response.status,'ok');
 assert.equal(f.files.get('key'),selected+'\n');
 assert.equal(JSON.parse(f.files.get('meta')).keyHash,'hash:'+selected);
 assert.equal(JSON.parse(f.files.get('meta')).quota.activeScope,'team');
 assert.deepEqual(f.warnings,[]);
});
test('an unchanged key is not rewritten on every membership refresh',()=>{
 const f=fixture({previousKey:selected});assert.equal(f.response.status,'ok');assert.deepEqual(f.calls.filter(c=>c==='key'||c==='meta'),['meta']);
});
test('a refresh with the selected key and its metadata in place writes no file at all',()=>{
 // updatedAt, account and quota differ on every refresh: they alone never rewrite the metadata.
 const f=fixture({previousKey:selected,metadata:metadataFor(selected,{updatedAt:'2026-11-23T13:07:00.000Z',quota:{spend:1}})});
 assert.equal(f.response.status,'ok');assert.equal(f.response.state,'ready');
 assert.deepEqual(f.calls,['restrict','cache']);
 assert.deepEqual(f.warnings,[]);
});
test('the metadata is rewritten when what names the key changes',()=>{
 const f=fixture({previousKey:selected,metadata:metadataFor(selected,{email:'previous@example.invalid'})});
 assert.equal(f.response.status,'ok');assert.deepEqual(f.calls.filter(c=>c==='key'||c==='meta'),['meta']);
 assert.equal(JSON.parse(f.files.get('meta')).email,'test@example.invalid');
});
test('a held metadata file with the selected key in place answers ok and logs the exact cause',()=>{
 // The client case: refresh during a turn, the other tab or an antivirus holds tigo-access.json.
 const f=fixture({previousKey:selected,metadata:metadataFor(selected,{subject:'previous-subject'}),fail:{meta:true}});
 assert.equal(f.response.status,'ok');assert.equal(f.response.state,'ready');assert.equal(f.response.diagnostic,undefined);
 assert.equal(f.files.get('key'),selected+'\n');
 assert.deepEqual(f.warnings,['TigoAccess local credential installation failed (write_metadata, access_denied): AccessDeniedException, 6 move attempts; the key in place is already the selected one, Tigo stays ready']);
 assert.ok(f.calls.includes('cache'));
 assert.doesNotMatch(f.warnings.join(' ')+JSON.stringify(f.response),/SECRET|agents\/convertigo|sk-/);
});
test('a failed write while another tab installs the same key answers ok',()=>{
 const f=fixture({fail:{key:true},onFail:files=>{files.set('key',selected+'\n');files.set('meta',metadataFor(selected));}});
 assert.equal(f.response.status,'ok');
 assert.match(f.warnings[0],/^TigoAccess local credential installation failed \(write_key, access_denied\).*Tigo stays ready$/);
});
test('a failed key write with another key in place still fails',()=>{
 const old='sk-'+'b'.repeat(43),f=fixture({previousKey:old,metadata:metadataFor(old),fail:{key:true}});
 assert.equal(f.response.status,'error');assert.equal(f.response.code,'local_installation_failed');
 assert.equal(f.response.diagnostic.operation,'write_key');assert.equal(f.response.diagnostic.keyInPlace,undefined);
 assert.equal(f.files.get('key'),old+'\n');
});
