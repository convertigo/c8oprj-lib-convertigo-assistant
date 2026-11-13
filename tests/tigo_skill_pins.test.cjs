const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const box = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/tigo_resources.js'),'utf8'),box);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'skill-pins-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const resolve = (base,rel) => path.join(root,base,rel);
  const host = {identity:()=>({admin:true,studio:true,user:'studio',owner:'studio',key:'studio'}),
    personal:()=> 'users/studio',builtins:()=> 'builtin',projects:()=>({Demo:'projects/Demo'}),hash,now:()=>1,
    read:(base,rel)=>fs.existsSync(resolve(base,rel))?fs.readFileSync(resolve(base,rel),'utf8'):null,
    write:(base,rel,value)=>{fs.mkdirSync(path.dirname(resolve(base,rel)),{recursive:true});fs.writeFileSync(resolve(base,rel),value);},
    fileHash:(base,rel)=>hash(fs.readFileSync(resolve(base,rel))),
    list:(base,rel)=>fs.existsSync(resolve(base,rel))?fs.readdirSync(resolve(base,rel),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name):[],
    files:(base,rel)=>{
      const out=[];
      function walk(dir,prefix){if(!fs.existsSync(dir))return;for(const f of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+f.name;f.isDirectory()?walk(path.join(dir,f.name),name+'/'):out.push(name);}}
      for(const folder of ['scripts','references','assets'])walk(resolve(base,rel+'/'+folder),folder+'/');
      return out.sort();
    },lock:(_base,fn)=>fn(),protectProject:()=>{},secretNames:()=>[],readSecrets:()=>({})};
  const api=box.C8O.tigoResources.create(host), agent=box.C8O.tigoResources.create({...host,agentInitiated:true});
  const make=(id='example')=>api.execute({action:'save',kind:'skill',scope:'workspace',input:{schemaVersion:1,id,defaultLanguage:'en',translations:{en:{title:id,body:'---\nname: '+id+'\ndescription: Example\n---\nUse the reference.'}}}}).item;
  const state={threadid:'thread-a',userId:'studio',provider:'vibe',externalSessionId:'session-a',language:'en'};
  function approve(item){const review=api.execute({action:'reviewSkill',key:item.key,threadid:state.threadid}).review;api.execute({action:'select',threadid:state.threadid,input:{skills:[item.key],mcp:[],reviewKey:item.key,reviewRevision:review.revision}});return review;}
  return {root,host,api,agent,make,state,approve,resolve};
}

test('an agent changing a selected support file suspends loading and requires human review', t=>{
  const f=fixture(t), item=f.make();f.host.write('users/studio','skills/example/scripts/check.js','old();');
  f.approve(item);assert.match(f.api.prepare(f.state).text,/Custom skill/);
  f.agent.execute({action:'writeFile',key:item.key,input:{path:'scripts/check.js',content:'updated();'},revision:hash('old();')});
  const prepared=f.api.prepare(f.state);assert.equal(prepared.text,'');assert.equal(prepared.requiresReview[0],item.key);
  const current=f.api.execute({action:'list',threadid:f.state.threadid}).items.find(x=>x.key===item.key);
  assert.equal(current.requiresReview,true);assert.equal(current.active,false);
  const review=f.approve(item);assert.equal(review.scripts[0].status,'modified');assert.match(review.scripts[0].diff,/-old\(\);/);assert.match(review.scripts[0].diff,/\+updated\(\);/);
  assert.match(f.api.prepare(f.state).text,/Custom skill/);
});

test('direct disk edits of instructions, references, assets and added or removed scripts invalidate the pin', t=>{
  for(const rel of ['SKILL.md','references/info.md','assets/icon.bin','scripts/run.py']){
    const f=fixture(t), item=f.make();
    if(rel!=='SKILL.md')f.host.write('users/studio','skills/example/'+rel,'before');
    f.approve(item);fs.appendFileSync(f.resolve('users/studio','skills/example/'+rel),'\nchanged');
    assert.equal(f.api.prepare(f.state).requiresReview[0],item.key,rel);
  }
  const f=fixture(t),item=f.make();f.approve(item);f.host.write('users/studio','skills/example/scripts/new.py','pass');
  assert.equal(f.api.prepare(f.state).text,'');assert.equal(f.approve(item).scripts[0].status,'added');
  fs.unlinkSync(f.resolve('users/studio','skills/example/scripts/new.py'));
  assert.equal(f.api.prepare(f.state).requiresReview[0],item.key);assert.equal(f.approve(item).scripts[0].status,'removed');
});

test('new agent-written skills remain inactive and the agent cannot select one', t=>{
  const f=fixture(t);const item=f.agent.execute({action:'save',kind:'skill',scope:'workspace',input:{schemaVersion:1,id:'agent-skill',defaultLanguage:'en',translations:{en:{title:'New',body:'---\nname: agent-skill\ndescription: Example\n---\nInstructions'}}}}).item;
  assert.equal(f.api.execute({action:'list',threadid:f.state.threadid}).items[0].enabled,false);
  assert.equal(f.api.prepare(f.state).text,'');
  assert.throws(()=>f.agent.execute({action:'select',input:{skills:[item.key],mcp:[],reviewKey:item.key,reviewRevision:item.revision}}),/human_review_required/);
});

test('stale approval is refused and unrelated selections never approve changed content', t=>{
  const f=fixture(t),item=f.make();const review=f.api.execute({action:'reviewSkill',key:item.key,threadid:f.state.threadid}).review;
  f.host.write('users/studio','skills/example/references/new.md','new');
  assert.throws(()=>f.api.execute({action:'select',threadid:f.state.threadid,input:{skills:[item.key],mcp:[],reviewKey:item.key,reviewRevision:review.revision}}),/skill_review_required/);
  f.approve(item);f.host.write('users/studio','skills/example/references/new.md','changed');
  f.api.execute({action:'select',threadid:f.state.threadid,input:{skills:[item.key],mcp:[]}});
  assert.equal(f.api.prepare(f.state).requiresReview[0],item.key);
});

test('unversioned legacy selections require review, and disabling preserves the approved script comparison', t=>{
  const f=fixture(t),item=f.make();f.host.write('users/studio','skills/example/scripts/run.py','old');
  f.host.write('users/studio','conversations/thread-a.json',JSON.stringify({skills:[item.key],mcp:[]}));
  assert.equal(f.api.prepare(f.state).requiresReview[0],item.key);f.approve(item);
  f.api.execute({action:'select',threadid:f.state.threadid,input:{skills:[],mcp:[]}});
  f.host.write('users/studio','skills/example/scripts/run.py','new');
  const review=f.api.execute({action:'reviewSkill',key:item.key,threadid:f.state.threadid}).review;
  assert.equal(review.scripts[0].status,'modified');assert.match(review.scripts[0].diff,/-old/);
  assert.throws(()=>f.api.execute({action:'select',threadid:f.state.threadid,input:{skills:[item.key],mcp:[]}}),/skill_review_required/);
});
