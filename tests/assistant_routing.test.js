const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const javaProxy = new Proxy(function () {}, {
  get(_target, property) {
    if (property === Symbol.toPrimitive) {
      return () => "";
    }
    return javaProxy;
  },
  apply() {
    return javaProxy;
  },
  construct() {
    return javaProxy;
  }
});

global.Packages = javaProxy;
global.context = javaProxy;
global.request = javaProxy;
global.log = javaProxy;
global.C8O = {};

let source = fs.readFileSync("js/agent_bridge_client.js", "utf8");
assert.match(source, /callLocalSequence\("lib_ConvertigoMCP", "McpManagedTokenCreate"/);
assert.doesNotMatch(source, /managedFlowMcpToken|managedMcpTokenBundle/);
assert.match(source, /conversationRecordForRunId\([\s\S]*?options\.runid[\s\S]*?options\.threadid = threadid;/);
source = source.replace(
  /\}\(\)\);\s*$/,
  "C8O.assistantAgentBridge._test = { assistantProfileDescriptor, buildSequencePrompt, bridgeSessionSlot, bridgeSessionCookie, responseSessionCookie, rememberBridgeSessionCookie, usesProtectedConvertigoMcp, isTerminalStatus, shouldInstallForRun, selectConversationRecordForRunId, stateForExplicitProviderSetup, runtimeSetupRequested, stateForRuntimeSetup, appendAnswerChunk, flushVibeInterimAnswerToProgress, projectNameFromToolValue, rememberProjectFromToolEvent };}());"
);
vm.runInThisContext(source, { filename: "agent_bridge_client.js" });

const pageSource = fs.readFileSync("_c8oProject/mobilePages/Page.yaml", "utf8");
const appSource = fs.readFileSync("_c8oProject/mobileNgxApp.yaml", "utf8");
const setupSequenceSource = fs.readFileSync("_c8oProject/sequences/AgentSetup.yaml", "utf8");
const footerSource = fs.readFileSync("_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml", "utf8");
const deleteConversationBlock = pageSource.match(/↓DeleteConversation \[ngx\.components\.UIDynamicAction-1781608122153\]:[\s\S]*?↓RenameButton /);
assert.ok(deleteConversationBlock, "delete conversation action must remain present");
assert.match(deleteConversationBlock[0], /script:scope\.conversation && scope\.conversation\.conversationId/);
assert.match(deleteConversationBlock[0], /\}\)\(this, scope && scope\.conversation, out\)/);
assert.match(deleteConversationBlock[0], /var result = JSON\.parse\(''\{\}''\);/);
assert.doesNotMatch(deleteConversationBlock[0], /var \w+:\s*(?:any|any\[\])/);
assert.doesNotMatch(deleteConversationBlock[0], /script:conversation\.conversationId/);
const runtimeUpdateBlock = pageSource.match(/↓InstallOrUpdateRuntime \[ngx\.components\.UICustomAction-1785253204061\]:[\s\S]*?↓ContinueActions /);
assert.ok(runtimeUpdateBlock, "runtime update action must remain present");
assert.match(runtimeUpdateBlock[0], /AgentRuntimeProvider \|\| \(page\.local\.AgentRuntime && page\.local\.AgentRuntime\.provider\)/);
assert.match(runtimeUpdateBlock[0], /page\.local\.AgentProvider = provider/);
assert.match(runtimeUpdateBlock[0], /model: requestedModel/);
assert.match(runtimeUpdateBlock[0], /reasoningEffort: requestedReasoning/);
assert.match(runtimeUpdateBlock[0], /threadid: ''''/);
assert.match(runtimeUpdateBlock[0], /targetProject: ''''/);
assert.match(runtimeUpdateBlock[0], /projectName: ''''/);
assert.doesNotMatch(runtimeUpdateBlock[0], /getEffectiveProjectName/);
assert.match(setupSequenceSource, /updateRuntime: typeof updateRuntime === "undefined" \? "" : updateRuntime/);
assert.match(footerSource, /\.agent-prompt-model-select \{\s+max-width: 220px;/);
assert.match(footerSource, /@media \(max-width: 640px\)[\s\S]*?\.agent-prompt-model-select \{\s+max-width: 160px;/);
assert.match(pageSource, /type === ''lib_ConvertigoAssistant\.context'' \|\| type === ''ConvertigoAssistant\.context''/);
assert.match(pageSource, /postAgentHostMessage\(\{ type: ''ConvertigoAssistant\.context\.request'' \}\)/);
assert.match(pageSource, /lib_ConvertigoMCP", version: "0\.2\.14", tag: "v0\.2\.14"/);
assert.match(pageSource, /lib_ConvertigoAgentBridge", version: "0\.4\.17", tag: "v0\.4\.17"/);
assert.match(pageSource, /lib_ConvertigoAssistant", version: "1\.4\.35", tag: "v1\.4\.35"/);
assert.equal((appSource.match(/setTimeout\(autoOpenAgentFromStudioView, 0\)/g) || []).length, 2);
assert.match(appSource, /lib_ConvertigoAssistant\.GetVersion[\s\S]*?"noLoading": "plain:true"/);
assert.match(pageSource, /return state\.primaryProject \|\| ''''/);
assert.match(pageSource, /return state\.reasoningEffort \|\| ''''/);
assert.match(pageSource, /return state\.serviceTier \|\| ''''/);
assert.match(pageSource, /page\.local\.AgentRuntimeProvider = ''vibe''/);
assert.match(pageSource, /page\.local\.AgentRuntimeProvider = ''codex''/);

const testApi = C8O.assistantAgentBridge._test;
assert.equal(testApi.assistantProfileDescriptor({ userId: "studio", assistantSurface: "studio" }).id, "generalist");
assert.equal(testApi.assistantProfileDescriptor({ userId: "studio", assistantSurface: "studio", agentProfile: "flow" }).id, "generalist");
assert.equal(testApi.usesProtectedConvertigoMcp({ userId: "studio", agentProfile: "flow" }), true);
assert.equal(testApi.isTerminalStatus("failed"), true);
assert.equal(testApi.isTerminalStatus("cancelled"), true);
assert.equal(testApi.isTerminalStatus("in_progress"), false);
assert.equal(testApi.shouldInstallForRun({}, "codex"), false);
assert.equal(testApi.shouldInstallForRun({ install: "" }, "codex"), false);
assert.equal(testApi.shouldInstallForRun({ install: "", installCodex: "" }, "codex"), false);
assert.equal(testApi.shouldInstallForRun({ install: "true" }, "codex"), true);
assert.equal(testApi.shouldInstallForRun({ installCodex: "true" }, "codex"), true);
assert.equal(testApi.shouldInstallForRun({ installVibe: "true" }, "codex"), false);
assert.equal(testApi.shouldInstallForRun({ installVibe: "true" }, "vibe"), true);
const codexConversation = {
  provider: "codex",
  threadid: "agent-codex",
  conversationId: "agent-codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  serviceTier: "fast",
  workspaceRoot: "/workspace"
};
const vibeSetup = testApi.stateForExplicitProviderSetup(codexConversation, {
  provider: "vibe",
  model: "zai-glm-5-2",
  reasoningEffort: "high"
});
assert.equal(vibeSetup.isolated, true);
assert.equal(vibeSetup.state.provider, "vibe");
assert.equal(vibeSetup.state.model, "zai-glm-5-2");
assert.equal(vibeSetup.state.threadid, "");
assert.equal(codexConversation.provider, "codex");
assert.equal(codexConversation.threadid, "agent-codex");
assert.equal(testApi.stateForExplicitProviderSetup(codexConversation, { provider: "codex" }).isolated, false);
assert.equal(testApi.runtimeSetupRequested({ updateRuntime: "true" }), true);
assert.equal(testApi.runtimeSetupRequested({ forceCodexInstall: true }), true);
assert.equal(testApi.runtimeSetupRequested({ install: true }), false);
const runtimeSetup = testApi.stateForRuntimeSetup({
  state: {
    provider: "codex",
    threadid: "agent-codex",
    conversationId: "agent-codex",
    primaryProject: "lib_ProductTour",
    projectId: "lib_ProductTour",
    projectNames: ["lib_ProductTour"],
    workspaceRoot: "/workspace",
    userKey: "studio"
  },
  isolated: false
}, { updateRuntime: true });
assert.equal(runtimeSetup.isolated, true);
assert.equal(runtimeSetup.state.threadid, "");
assert.equal(runtimeSetup.state.conversationId, "");
assert.equal(runtimeSetup.state.primaryProject, "");
assert.equal(runtimeSetup.state.projectId, "");
assert.deepEqual(runtimeSetup.state.projectNames, []);
assert.equal(runtimeSetup.state.workspaceRoot, "/workspace");
const vibeProjectState = { provider: "vibe", projectNames: [], primaryProject: "", projectId: "" };
assert.equal(testApi.rememberProjectFromToolEvent(vibeProjectState, {
  toolName: "Convertigo_marketplace-import",
  update: {
    rawInput: {
      project: "template_ngxBuilderIonic",
      importedProjectName: "Clock"
    }
  }
}), "Clock");
assert.equal(vibeProjectState.primaryProject, "Clock");
assert.deepEqual(vibeProjectState.projectNames, ["Clock"]);
assert.equal(testApi.selectConversationRecordForRunId([], "run-1"), null);
assert.equal(testApi.selectConversationRecordForRunId([{ lastRunId: "run-1", conversationId: "agent-1" }], ""), null);
assert.equal(
  testApi.selectConversationRecordForRunId([
    { lastRunId: "run-1", conversationId: "agent-1" },
    { lastRunId: "run-2", conversationId: "agent-2" }
  ], "run-2").conversationId,
  "agent-2"
);
assert.equal(testApi.assistantProfileDescriptor({ userId: "alice", assistantSurface: "studio", agentProfile: "flow" }).id, "nocode");

const prompt = testApi.buildSequencePrompt("Create an application", {
  userId: "studio",
  assistantSurface: "studio",
  agentProfile: "generalist",
  provider: "codex",
  mcpEndpoint: "http://localhost/convertigo/api/mcp"
});
assert.match(prompt, /Surface profile: studio/);
assert.match(prompt, /Authoring policy: legacy-only/);
assert.match(prompt, /managed `convertigo-studio` routing skill/);
assert.match(prompt, /marketplace_import\(\{project:\"template_ngxBuilderIonic\", importedProjectName:/);
assert.match(prompt, /Do not run shell, PowerShell, `rg`, or workspace searches to rediscover MCP tool names/);
assert.match(prompt, /Never recursively search a drive root, user profile, workspace root/);
assert.match(prompt, /stateOnly:true,wait:true,timeoutSec:180/);
assert.doesNotMatch(prompt, /\bFlow\b|convertigo-flow/i);

const vibePrompt = testApi.buildSequencePrompt("Create an application", {
  userId: "studio",
  assistantSurface: "studio",
  agentProfile: "generalist",
  provider: "vibe"
});
assert.match(vibePrompt, /MCP endpoint: managed by Agent Bridge/);
assert.match(vibePrompt, /skills\/convertigo-vibe-generalist\/SKILL\.md/);
assert.match(vibePrompt, /Do not read the repository-level `AGENT\.md` or `TOOLS\.md`/);
assert.match(vibePrompt, /path is already known: do not search the workspace/);
assert.doesNotMatch(vibePrompt, /managed `convertigo-studio` routing skill/);
assert.doesNotMatch(vibePrompt, /skills\/convertigo-mcp\/AGENT\.md/);

const vibeAnswerState = {
  provider: "vibe",
  language: "fr",
  answer: "",
  answerIsFinal: false,
  progressLog: "",
  progressEvents: []
};
testApi.appendAnswerChunk(vibeAnswerState, "Je vais inspecter le projet.");
assert.equal(vibeAnswerState.answer, "Je vais inspecter le projet.");
assert.equal(testApi.flushVibeInterimAnswerToProgress(vibeAnswerState), true);
assert.equal(vibeAnswerState.answer, "");
assert.equal(vibeAnswerState.answerIsFinal, false);
assert.match(vibeAnswerState.progressLog, /Je vais inspecter le projet\./);
testApi.appendAnswerChunk(vibeAnswerState, "La modification est terminée.");
assert.equal(vibeAnswerState.answer, "La modification est terminée.");

const resumedPrompt = testApi.buildSequencePrompt("Update the existing Flow page", {
  userId: "studio",
  assistantSurface: "studio",
  agentProfile: "flow",
  establishedAgentFollowup: true,
  mcpEndpoint: "http://localhost/convertigo/api/mcp"
});
assert.match(resumedPrompt, /Agent Bridge preflight reports a changed skill bundle/);
assert.match(resumedPrompt, /exact re-read list takes precedence/);

const sessionAttributes = new Map();
global.context = {
  httpSession: {
    getAttribute(name) {
      return sessionAttributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      sessionAttributes.set(name, value);
    }
  }
};
assert.equal(testApi.bridgeSessionSlot({ __sequence: "agent_events" }), "events");
assert.equal(testApi.bridgeSessionSlot({ __sequence: "agent_settings" }), "commands");
assert.equal(testApi.bridgeSessionCookie({}, "commands"), "");
assert.equal(testApi.responseSessionCookie("JSESSIONID=bridge-1; Path=/convertigo; HttpOnly"), "JSESSIONID=bridge-1");
assert.equal(testApi.rememberBridgeSessionCookie({}, "commands", "JSESSIONID=bridge-1; Path=/convertigo; HttpOnly"), "JSESSIONID=bridge-1");
assert.equal(testApi.bridgeSessionCookie({}, "commands"), "JSESSIONID=bridge-1");
assert.equal(testApi.bridgeSessionCookie({}, "events"), "");
assert.equal(testApi.rememberBridgeSessionCookie({}, "events", "ignored=value; Path=/"), "");
global.context = {};
assert.equal(testApi.bridgeSessionCookie({}, "commands"), "");

console.log("Assistant routing contract OK");

// Claude provider routing.
const claudeTest = C8O.assistantAgentBridge._test;
assert.match(source, /function providerSequence\(provider, action\)/);
assert.match(source, /function isResidentProvider\(provider\)/);
assert.doesNotMatch(source, /"agent_codex_close" : "agent_vibe_close"/);
assert.match(source, /claudeHome: provider === "claude" \? String\(record\.claudeHome \|\| ""\) : ""/);
assert.equal(claudeTest.shouldInstallForRun({ installClaude: "true" }, "claude"), true);
assert.equal(claudeTest.shouldInstallForRun({ installCodex: "true" }, "claude"), false);
assert.equal(claudeTest.runtimeSetupRequested({ forceClaudeInstall: true }), true);
const claudeSetupState = claudeTest.stateForExplicitProviderSetup({ provider: "vibe", threadid: "t1", handle: "h1" }, { provider: "claude-code" });
assert.equal(claudeSetupState.state.provider, "claude");
assert.equal(claudeSetupState.isolated, true);
const setupSequenceClaude = fs.readFileSync("_c8oProject/sequences/AgentSetup.yaml", "utf8");
assert.match(setupSequenceClaude, /installClaude: typeof installClaude === "undefined" \? "" : installClaude/);
assert.match(setupSequenceClaude, /claudeHomeScope: typeof claudeHomeScope === "undefined" \? "" : claudeHomeScope/);
const pageSourceClaude = fs.readFileSync("_c8oProject/mobilePages/Page.yaml", "utf8");
assert.match(pageSourceClaude, /↓ClaudeButton \[ngx\.components\.UIDynamicElement-/);
assert.match(pageSourceClaude, /Agent_Auth_Claude_Required/);
console.log("Assistant Claude routing OK");

// Prompt attachments: local agents read files from the conversation folder instead of OpenAI Files.
const routerSequenceSource = fs.readFileSync("_c8oProject/sequences/UploadFilesRouter.yaml", "utf8");
assert.match(routerSequenceSource, /storeAttachments\(/, "the upload router must store attachments locally in agent mode");
assert.match(routerSequenceSource, /"UploadFiles"/, "the upload router must keep the legacy OpenAI upload for the hosted assistant");
assert.match(pageSource, /requestable":"plain:lib_ConvertigoAssistant\.UploadFilesRouter"/, "the prompt footer must call the upload router");
assert.match(pageSource, /"path\\":\\"\?\.result\.file\\"/, "the upload loop must iterate the router result");
assert.equal(typeof C8O.assistantAgentBridge.storeAttachments, "function");
const emptyStore = C8O.assistantAgentBridge.storeAttachments({ threadid: "", userId: "studio", files: [], attachments: [] });
assert.equal(emptyStore.status, "ok");
assert.deepEqual(emptyStore.file, []);
console.log("Assistant attachment routing OK");

// Browser sign-in is provider generic: Codex, Claude and Vibe share the login button flow.
{
  const clientSource = fs.readFileSync("js/agent_bridge_client.js", "utf8");
  assert.match(clientSource, /function providerLoginAction\(provider\)/);
  assert.doesNotMatch(clientSource, /action: "codex_login"/, "login actions must be derived from the provider");
  assert.match(clientSource, /var loginRequested = isResidentProvider\(loginProvider\) && boolValue\([\s\S]*?options\.claudeLogin[\s\S]*?options\.vibeLogin/);
  const claudeBranch = clientSource.match(/if \(harness === "claude"\) \{\s*var claudeSetupScope[\s\S]*?\n    \}\n/)[0];
  assert.match(claudeBranch, /login: typeof options\.login === "undefined"/);
  assert.match(claudeBranch, /loginStatus: typeof options\.loginStatus === "undefined"/);
  assert.match(claudeBranch, /forceLogin: typeof options\.forceLogin === "undefined"/);
  const vibeBranch = clientSource.match(/var vibeScope = providerHomeScopeForRun\(options, "vibeHomeScope"\);[\s\S]*?agentRevealMode: revealModeOption\(options\)\s*\};/)[0];
  assert.match(vibeBranch, /login: typeof options\.login === "undefined"/);
  assert.match(vibeBranch, /loginStatus: typeof options\.loginStatus === "undefined"/);
  assert.match(clientSource, /codexLogin: typeof options\.codexLogin === "undefined" \? \(typeof options\.login === "undefined" \? "" : options\.login\)/);
  assert.match(setupSequenceSource, /login: typeof login === "undefined" \? "" : login/);
  assert.match(setupSequenceSource, /loginStatus: typeof loginStatus === "undefined" \? "" : loginStatus/);
  assert.match(setupSequenceSource, /↓login \[variables\.RequestableVariable-/);
  assert.match(setupSequenceSource, /↓loginStatus \[variables\.RequestableVariable-/);
  assert.match(runtimeUpdateBlock[0], /var loginRequested = \(provider === ''codex'' \|\| provider === ''claude'' \|\| provider === ''vibe''\) && page\.local\.AgentAuthenticationRequired === true;/);
  assert.match(runtimeUpdateBlock[0], /payload\.login = true;/);
  assert.match(runtimeUpdateBlock[0], /payload\.loginStatus = true;/);
  assert.match(runtimeUpdateBlock[0], /installedRuntime\.installed === true && installedAuthentication\.configured === false[\s\S]*?page\.local\.AgentAuthenticationRequired = true;[\s\S]*?Agent_Auth_Vibe_Connect/, "a freshly installed runtime without credentials must switch to the sign-in button instead of failing on missing models");
  assert.match(runtimeUpdateBlock[0], /page\.openAgentExternalUrl\(verificationUrl\)/);
  assert.doesNotMatch(runtimeUpdateBlock[0], /Lancez claude auth login sur ce poste/);
  for (const key of ["Agent_Auth_Claude_Connect", "Agent_Auth_Claude_Waiting", "Agent_Auth_Claude_Connected", "Agent_Auth_Claude_Login_Failed", "Agent_Auth_Vibe_Connect", "Agent_Auth_Vibe_Waiting", "Agent_Auth_Vibe_Connected", "Agent_Auth_Vibe_Login_Failed"]) {
    assert.equal((pageSource.match(new RegExp(key + ': "', "g")) || []).length, 4, key + " must be translated in the four languages");
  }
  assert.match(pageSource, /tr\(''Agent_Auth_Claude_Connect'', ''Se connecter à Claude''\)/);
  assert.match(pageSource, /tr\(''Agent_Auth_Vibe_Connect'', ''Se connecter à Mistral''\)/);
}

// Convertigo mode: logical provider routed through the harness announced by the bridge.
{
  const clientSource = fs.readFileSync("js/agent_bridge_client.js", "utf8");
  assert.match(clientSource, /function providerHarness\(provider, settingsProvider\)/);
  assert.match(clientSource, /return "agent_" \+ providerHarness\(provider\) \+ "_" \+ action;/);
  assert.match(clientSource, /vibeProfile: vibeProfileForProvider\(provider\),/);
  assert.match(clientSource, /return \["convertigo", "codex", "vibe", "claude"\];/);
  assert.match(clientSource, /return "convertigo_key";/);
  assert.doesNotMatch(clientSource, /normalizeProvider\(state && state\.provider\) === "vibe"/, "vibe-specific behaviour must go through the harness");
  assert.match(pageSource, /↓ConvertigoButton \[ngx\.components\.UIDynamicElement-/);
  assert.ok(pageSource.indexOf("↓ConvertigoButton [") < pageSource.indexOf("↓VibeButton ["), "the Convertigo tile comes first");
  for (const key of ["Agent_Provider_Convertigo_Copy", "Agent_Auth_Convertigo_Required", "Agent_Auth_Convertigo_Check", "Agent_Runtime_Updating_Convertigo"]) {
    assert.equal((pageSource.match(new RegExp(key + ': "', "g")) || []).length, 4, key + " must be translated in the four languages");
  }
  assert.match(pageSource, /if \(provider === ''vibe'' \|\| provider === ''convertigo''\) \{ payload\.forceVibeInstall = true; \}/);
}

// Early viewer start reminder for frontend work (bootstrap and continuation turns).
{
  const src = fs.readFileSync("js/agent_bridge_client.js", "utf8");
  assert.equal((src.match(/mobile-builder-open\(\{project, wait:false\}\)/g) || []).length, 2, "the early start reminder must appear in the operational rules and in the continuation rules");
}

// Convertigo mode: the harness installs itself and a missing key never surfaces as "no usable model".
{
  const page = fs.readFileSync("_c8oProject/mobilePages/Page.yaml", "utf8");
  assert.match(page, /AgentConvertigoAutoInstall !== ''started''/);
  assert.match(page, /querySelector\(''\.agent-runtime-settings:not\(\.agent-stack-settings\) ion-button\.agent-runtime-action''\)/);
  assert.doesNotMatch(page, /provider !== ''convertigo'' && installedRuntime\.installed === true/);
}

// Vibe/Convertigo: a new ACP message id flushes the previous narration out of the final answer.
{
  const src = fs.readFileSync("js/agent_bridge_client.js", "utf8");
  assert.match(src, /state\.vibeAnswerMessageId !== chunkMessageId\) \{\s*flushVibeInterimAnswerToProgress\(state\);/);
}
