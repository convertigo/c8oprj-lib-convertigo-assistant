// Backend-only checks; no HTTP requests, runtime files or agent processes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');
const names = ['normalizeSkillProfile', 'assistantProfileDescriptor', 'defaultBridgeUrl', 'bridgeCall',
  'shouldAttachMcpTokenHandle', 'attachMcpTokenHandle', 'isResidentProvider', 'providerHarness',
  'noCodeMcpTokenHandle', 'hasExplicitSkillProfile', 'conversationSkillProfile',
  'conversationMatchesSkillProfile', 'noCodeConversationContext', 'savedNoCodeContext', 'createState'];
const snippets = backendParts(names, ['DEFAULT_BRIDGE_PROJECT', 'ASSISTANT_PROFILE_BOOTSTRAP']);
const studioUrl = 'https://engine/convertigo/projects/lib_ConvertigoAgentBridge/.json';
const nocodeUrl = 'https://engine/convertigo/projects/lib_ConvertigoAgentBridge/.json';
function fixture(record = null) {
  const calls = [], trim = value => String(value ?? '').trim();
  const context = {
    trim,
    engineConvertigoBaseUrl: () => 'https://engine/convertigo/',
    flowCapabilityAvailable: () => false,
    managedMcpTokenHandle: () => 'opaque-studio-handle',
    noCodeMcpUserId: () => assert.fail('Studio must not request a Forms identity or token'),
    sharedSecretGet: () => 'test-secret',
    postForm: (...args) => { calls.push(args); return { result: { ok: true } }; },
    resolveWorkspaceRoot: () => '/test-workspace', normalizeUserKey: trim,
    normalizeConversationId: trim, makeConversationId: () => 'new',
    normalizeProvider: trim, readConversationRecord: () => record,
    conversationDirectory: () => '/test-workspace/conversation',
    addArrayValue: (list, value) => value ? [...new Set([...list, value])] : list,
    isConversationScopedCodexHome: () => false, sanitizeCodexHome: trim,
    childPath: (parent, leaf) => parent + '/' + leaf, homeLeafForProvider: () => 'home',
    normalizeModel: (_, value) => trim(value), normalizeReasoningEffort: trim,
    recoverCodexExternalSessionId: (_, value) => value, defaultMcpEndpoint: () => '/api/mcp',
    filePath: trim, conversationRecordFile: dir => dir + '/record.json',
    conversationTranscriptFile: dir => dir + '/transcript.json',
    conversationSummaryFile: dir => dir + '/summary.json', conversationTitleFromText: trim,
    normalizeAssistantLanguage: trim, detectLanguage: () => 'fr', extractUserMessage: trim,
    now: () => 100
  };
  vm.runInNewContext(snippets, context);
  return { context, calls };
}

test('Studio identity and explicit profile outrank every C8Oforms project-name alias', () => {
  const { context } = fixture();
  for (const projectKey of ['targetProject', 'projectName', 'projectId', 'primaryProject']) {
    for (const hint of [
      { userId: 'studio' }, { userId: ' STUDIO ', agentProfile: 'nocode' },
      { agentProfile: 'generalist' }, { skillProfile: 'generalist' },
      { assistantContext: 'studio' }, { assistantSurface: 'studio' }, { profile: 'generalist' }
    ]) {
      const options = { ...hint, [projectKey]: ' C8Oforms ' };
      assert.equal(context.normalizeSkillProfile(options), 'generalist', JSON.stringify(options));
      assert.equal(context.defaultBridgeUrl(options), studioUrl);
      assert.equal(context.noCodeMcpTokenHandle(options), '', 'Studio must never request a Forms token');
      assert.equal(context.savedNoCodeContext({ ...options, hostFormContext: { formId: 'unrelated' } }), null);
    }
  }
});

test('non-Studio identities use NoCode; project names alone never change the security profile', () => {
  const { context } = fixture();
  for (const key of ['agentProfile', 'skillProfile', 'assistantContext', 'assistantSurface', 'profile']) {
    for (const value of ['nocode', 'no-code', 'c8oforms', 'forms']) {
      const options = { userId: 'forms-user', targetProject: 'OtherProject', [key]: value, nocodeMcpTokenHandle: 'opaque-test-handle' };
      assert.equal(context.normalizeSkillProfile(options), 'nocode');
      assert.equal(context.defaultBridgeUrl(options), nocodeUrl);
      assert.equal(context.noCodeMcpTokenHandle(options), 'opaque-test-handle');
    }
  }
  assert.equal(context.normalizeSkillProfile({ targetProject: 'C8Oforms' }), 'generalist');
  assert.equal(context.normalizeSkillProfile({ userId: 'forms-user', agentProfile: 'generalist' }), 'nocode');
  assert.equal(context.normalizeSkillProfile({}), 'generalist');
});

test('Studio calls retain their endpoint, token behavior and explicit URL override', () => {
  const { context, calls } = fixture();
  const options = { userId: 'studio', assistantSurface: 'studio', targetProject: 'C8Oforms' };
  context.bridgeCall(options, 'agent_settings', {});
  assert.equal(calls[0][0], studioUrl);
  assert.equal(calls[0][1].nocodeMcpTokenHandle, undefined);
  context.bridgeCall({ ...options, bridgeBaseUrl: 'https://custom/bridge' }, 'agent_settings', {});
  assert.equal(calls[1][0], 'https://custom/bridge');
});

test('Studio conversations about C8Oforms remain in Studio history, including legacy records', () => {
  const { context } = fixture();
  for (const record of [
    { userId: 'studio', primaryProject: 'C8Oforms' },
    { assistantSurface: 'studio', primaryProject: 'C8Oforms' },
    { skillProfile: 'generalist', primaryProject: 'C8Oforms' }
  ]) {
    assert.equal(context.conversationSkillProfile(record), 'generalist');
    assert.equal(context.conversationMatchesSkillProfile(record, 'generalist'), true);
    assert.equal(context.conversationMatchesSkillProfile(record, 'nocode'), false);
  }
  const legacy = { primaryProject: 'C8Oforms' };
  assert.equal(context.conversationMatchesSkillProfile(legacy, 'nocode'), false);
  assert.equal(context.conversationMatchesSkillProfile({ ...legacy, userId: 'forms-user' }, 'nocode'), true);
  assert.equal(context.conversationMatchesSkillProfile(legacy, 'all'), true);
});

test('creating and restoring conversation state retains the Studio identity for routing', () => {
  for (const provider of ['codex', 'vibe', 'claude']) {
    for (const record of [null, { userId: 'studio', provider, primaryProject: 'C8Oforms' }]) {
      const { context } = fixture(record);
      const state = context.createState({ userId: 'studio', provider, targetProject: 'C8Oforms' });
      assert.equal(state.skillProfile, 'generalist');
      assert.equal(state.bridgeBaseUrl, studioUrl);
      assert.equal(context.normalizeSkillProfile(state), 'generalist');
    }
    const { context } = fixture();
    const state = context.createState({ userId: 'forms-user', provider, agentProfile: 'nocode', targetProject: 'C8Oforms' });
    assert.equal(state.skillProfile, 'nocode');
    assert.equal(state.bridgeBaseUrl, nocodeUrl);
  }
});

test('resident/setup calls keep managed Studio handles separate from NoCode handles for every provider', () => {
  const { context, calls } = fixture();
  for (const provider of ['codex', 'vibe', 'claude']) {
    for (const action of ['start', 'setup']) {
      context.bridgeCall({ userId: 'studio', agentProfile: 'nocode', targetProject: 'C8Oforms' }, 'agent_' + provider + '_' + action, {});
      const studioPayload = calls.at(-1)[1];
      assert.equal(studioPayload.mcpBearerTokenHandle, 'opaque-studio-handle');
      assert.equal(studioPayload.nocodeMcpTokenHandle, undefined);
      context.bridgeCall({ userId: 'forms-user', nocodeMcpTokenHandle: 'opaque-forms-handle' }, 'agent_' + provider + '_' + action, {});
      const formsPayload = calls.at(-1)[1];
      assert.equal(formsPayload.nocodeMcpTokenHandle, 'opaque-forms-handle');
      assert.equal(formsPayload.mcpBearerTokenHandle, undefined);
    }
  }
});
