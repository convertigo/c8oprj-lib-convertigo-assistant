// Stop keeps the agent context; runtime setup has its own configuration category.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
const page = fs.readFileSync(path.join(root, '_c8oProject/mobilePages/Page.yaml'), 'utf8');

test('stop interrupts the turn first and only closes the agent as a fallback', () => {
  const close = client.slice(client.indexOf('C8O.assistantAgentBridge.closeConversation = function'));
  const interruptAt = close.indexOf('bridgeCall(state, "agent_interrupt"');
  const closeAt = close.indexOf('providerSequence(state.provider, "close")');
  assert.ok(interruptAt > 0 && closeAt > interruptAt, 'interrupt is attempted before close');
  const kept = close.slice(interruptAt, closeAt);
  assert.match(kept, /interrupted\.ok === true/);
  assert.match(kept, /contextKept: true/);
  assert.doesNotMatch(kept, /removeState\(threadid\)/, 'the conversation state, hence the agent handle, is kept');
  assert.match(close.slice(0, interruptAt), /options\.forceClose !== true/);
});

test('an older Bridge without agent_interrupt falls back to close', () => {
  const close = client.slice(client.indexOf('C8O.assistantAgentBridge.closeConversation = function'));
  assert.match(close, /catch \(_ignoreInterruptFailure\) \{\s*interrupted = null;/);
});

test('the Vibe harness gets its previous session id back so it can reload the conversation', () => {
  assert.match(client, /sessionId: state\.externalSessionId \|\| "",\s*env: JSON\.stringify\(env\)/);
  assert.match(client, /isVibeHarness\(provider\) && start\.state && trim\(start\.state\.sessionId\)\.length/);
});

test('agent selection and runtime setup live in separate configuration categories', () => {
  const agentCategory = page.indexOf('↓AgentCategory [ngx.components.UIDynamicElement-');
  const runtimeCategory = page.indexOf('↓RuntimeCategory [ngx.components.UIDynamicElement-');
  const stack = page.indexOf('↓StackSettings [ngx.components.UIDynamicElement-');
  const provider = page.indexOf('↓ProviderSettings [ngx.components.UIDynamicElement-');
  const runtime = page.indexOf('↓RuntimeSettings [ngx.components.UIDynamicElement-');
  assert.ok(agentCategory > 0 && agentCategory < provider && provider < runtimeCategory);
  assert.ok(runtimeCategory < stack && stack < runtime);
  // The Convertigo mode auto-install must keep clicking the runtime button, not the stack one.
  assert.match(page, /\.agent-runtime-settings:not\(\.agent-stack-settings\) ion-button\.agent-runtime-action/);
});

test('opening history restores its messages and session without starting a provider', () => {
  const {backendParts,ts}=require('./helpers/assistant-source.cjs'),vm=require('node:vm');
  const ast=ts.createSourceFile('client.js',client,ts.ScriptTarget.Latest,true);let resume;
  function visit(node){if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='C8O.assistantAgentBridge.resumeConversation')resume=node.right.getText(ast);ts.forEachChild(node,visit);}visit(ast);
  const state={threadid:'existing',provider:'codex',status:'completed',externalSessionId:'session-1',resourceConversationHome:true,conversationFile:'record.json',messages:[{role:'assistant',text:'Earlier answer'}]};
  let saves=0;
  const sandbox={bridgeCallerRefusal:()=>null,withCallerUserId:o=>o||{},normalizeConversationId:value=>value,readState:()=>state,ensureState:value=>value,now:()=>123,saveState(){saves++;},publicState:value=>({provider:value.provider}),publicConversation:value=>value,readJsonFile:()=>({conversationId:'existing'}),File:function(value){this.path=value;},publicConversations:()=>[],normalizeSkillProfile:()=> 'generalist',conversationAIData:value=>({messages:value.messages}),bridgeCall(){throw new Error('History must not start a provider');},Thread(){throw new Error('History must not create a background process');}};
  vm.runInNewContext(backendParts(['prewarmCodexAppServer'])+';this.resume='+resume+';',sandbox);
  const result=sandbox.resume({threadid:'existing'});assert.equal(result.ok,true);assert.equal(result.prewarming,false);assert.equal(result.status,'completed');assert.equal(result.AIData.messages,state.messages);assert.equal(state.externalSessionId,'session-1');assert.equal(saves,1);
});
