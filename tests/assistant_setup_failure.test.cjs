const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ts, read, backendParts } = require('./helpers/assistant-source.cjs');

const ast = ts.createSourceFile('bridge.js', read('js/agent_bridge_client.js'), ts.ScriptTarget.Latest, true);
let send;
function visit(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'C8O.assistantAgentBridge.sendMessage') send = node.right.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(send);

function fixture(provider, setupStatus, install = false, userId = 'forms-user') {
  const state = { provider, userId, threadid: 'test-conversation', language: 'fr', model: 'test-model', title: 'Existing', projectNames: [] };
  const report = { ok: false, status: setupStatus,
    authentication: { configured: false, status: 'missing', action: provider === 'convertigo' ? 'convertigo_key' : 'vibe_login' },
    gatewayApiKey: 'NEVER-EXPOSE-THIS', setup: {}, messages: [] };
  const calls = [];
  const sandbox = {
    trim: v => String(v ?? '').trim(), normalizeProvider: v => v,
    normalizeSkillProfile: s => s.userId === 'studio' ? 'generalist' : 'nocode',
    optionsWithRequestFallbacks: v => v, enrichNoCodePrompt: v => v, extractUserMessage: v => v,
    normalizeThreadId: v => v, readState: () => state, ensureState: v => v,
    clearCancellationRequested() {}, firstOptionValue: () => '', noCodeConversationContext: () => null,
    normalizeAssistantLanguage: () => 'fr', detectLanguage: () => 'fr', enrichViewerDebugOptions() {},
    shouldInstallForRun: () => install, shouldShowAgentPreparingProgress: () => false,
    isResidentProvider: () => false, providerSequence: (p, action) => 'agent_vibe_' + action,
    callAgentSetup: () => { calls.push('setup'); return { result: report, sequence: 'agent_vibe_setup' }; },
    isConvertigoMode: p => p === 'convertigo', providerLabel: v => v,
    lang: () => ({ starting: 'Analyse', setupRequired: 'Configuration requise', setupCanInstall: 'Installer', startFailed: 'Échec' }),
    appendProgress() {}, appendTranscript() {}, saveState() {}, setStateBuffer() {},
    now: () => 100, makeRunId: v => 'run-' + v,
    responseForState: s => ({ AIData: { explanation: s.answer, setupRequired: s.setupRequired } }),
    publicState: v => v, publicInstallationDiagnostic: () => null, publicCommandDiagnostic: () => null,
    cancellationRequested: () => false, recoverableBridgeError: () => false,
    bridgeCall: () => { calls.push('unexpected-agent-start'); throw new Error('must not start'); }
  };
  vm.runInNewContext(backendParts(['setupRequiredAnswer', 'publicSetupReport']) + '\nvar sendMessage = ' + send + ';', sandbox);
  return { response: sandbox.sendMessage({ threadid: state.threadid, Question: 'Bonjour' }), calls };
}

for (const provider of ['convertigo', 'vibe']) {
  test(provider + ' missing credentials remain a structured setup response, even after an installation', () => {
    for (const install of [false, true]) {
      const { response, calls } = fixture(provider, 'authentication_required', install);
      assert.equal(response.status, 'setup_required');
      assert.equal(response.setupRequired, true);
      assert.equal(response.setup.status, 'authentication_required');
      assert.equal(response.canInstall, false, 'reinstalling cannot repair missing credentials');
      assert.equal(response.error, undefined, 'do not trigger the generic operation-error UI');
      assert.match(response.AIData.explanation, provider === 'convertigo' ? /clé.*Convertigo/ : /clé Mistral/);
      if (provider === 'convertigo') assert.doesNotMatch(response.AIData.explanation, /Mistral|Studio/);
      assert.doesNotMatch(JSON.stringify(response), /NEVER-EXPOSE-THIS/);
      assert.deepEqual(calls, ['setup']);
    }
  });
}

test('missing runtime still offers explicit installation; unknown setup failures stay failures', () => {
  const missing = fixture('vibe', 'missing').response;
  assert.equal(missing.status, 'setup_required');
  assert.equal(missing.canInstall, true);
  const failed = fixture('vibe', 'error').response;
  assert.equal(failed.status, 'failed');
  assert.ok(failed.error);
});

test('Studio Convertigo credential guidance retains the Studio workspace instructions', () => {
  const response = fixture('convertigo', 'authentication_required', false, 'studio').response;
  assert.equal(response.status, 'setup_required');
  assert.match(response.AIData.explanation, /workspace Studio/);
});
