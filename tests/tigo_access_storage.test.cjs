const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path').posix;
const {read} = require('./helpers/assistant-source.cjs');
function stepSource(file) {
 const yaml = read(file).split('\n');
 const start = yaml.findIndex(l => /expression: \|/.test(l));
 const indent = yaml[start].search(/\S/), lines=[];
 for(let i=start+1;i<yaml.length;i++) { if(yaml[i].trim() && yaml[i].search(/\S/)<=indent)break; lines.push(yaml[i].slice(indent+2)); }
 let source=lines.join('\n').trim();
 if(source.startsWith("'")&&source.endsWith("'"))source=source.slice(1,-1).replace(/''/g,"'");
 return source;
}
class Path {
 constructor(p) {this.p=path.normalize(String(p));}
 resolve(child){return new Path(path.join(this.p,child));}
 normalize(){return this;} toRealPath(){return this;} toAbsolutePath(){return this;}
 startsWith(other){return this.p===other.p||this.p.startsWith(other.p+'/');}
 getParent(){return this.p==='/'?null:new Path(path.dirname(this.p));}
 toString(){return this.p;}
}
class File {
 constructor(parent,child){this.p=child===undefined?String(parent):path.join(String(parent),child);}
 isAbsolute(){return path.isAbsolute(this.p);} getParentFile(){return this.p==='/'?null:new File(path.dirname(this.p));}
 toPath(){return new Path(this.p);}
}
for(const sequence of ['TigoAccessBootstrap','TigoAccessStatus']) for(const configured of ['', '/short/tigo']) test(sequence+' uses the configured credential root: '+(configured||'default'),()=>{
 const source=stepSource('_c8oProject/sequences/'+sequence+'.yaml');
 const prefix=source.slice(0,source.indexOf('var response='));
 const psc=source.match(/var pscPath=[^;]+;safePath\(pscPath,root\);/);
 const pscRead=psc?psc[0]:'';
 const engine={USER_WORKSPACE_PATH:'/workspace',isStudioMode:()=>true,authenticatedSessionManager:{hasRole:()=>true},theApp:{databaseObjectsManager:{symbolsGetValue:()=>configured}}};
 const com={twinsoft:{convertigo:{engine:{Engine:engine,AuthenticatedSessionManager:{Role:{WEB_ADMIN:'admin'}},EngineException:Error}}}};
 const box={com,context:{httpSession:{}},Packages:{com},java:{io:{File},nio:{file:{Paths:{get:p=>new Path(p)},Files:{isSymbolicLink:()=>false}}}}};
 const ctx=vm.createContext(box); box.include=name=>vm.runInContext(read(name),ctx);
 vm.runInContext(prefix+'\n'+pscRead,ctx);
 const expected=(configured||'/workspace/agents')+'/convertigo/';
 assert.equal(String(box.keyPath),expected+'llm-api-key');
 assert.equal(String(box.metadataPath),expected+'tigo-access.json');
 if(sequence==='TigoAccessBootstrap') assert.equal(String(box.pscPath),'/workspace/studio/psc.txt');
 assert.throws(()=>box.safePath(new Path('/elsewhere/credential')),/Unsafe local credential path/);
});
