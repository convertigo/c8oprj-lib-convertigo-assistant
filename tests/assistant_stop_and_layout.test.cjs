// Stop keeps the agent context; the stack card sits above the provider choice.
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

test('the stack card is rendered above the provider choice', () => {
  const stack = page.indexOf('↓StackSettings [ngx.components.UIDynamicElement-');
  const provider = page.indexOf('↓ProviderSettings [ngx.components.UIDynamicElement-');
  const runtime = page.indexOf('↓RuntimeSettings [ngx.components.UIDynamicElement-');
  assert.ok(stack > 0 && stack < provider && provider < runtime);
  // The Convertigo mode auto-install must keep clicking the runtime button, not the stack one.
  assert.match(page, /\.agent-runtime-settings:not\(\.agent-stack-settings\) ion-button\.agent-runtime-action/);
});
