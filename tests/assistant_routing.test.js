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
assert.match(pageSource, /lib_ConvertigoMCP", version: "0\.2\.2", tag: "v0\.2\.2"/);
assert.match(pageSource, /lib_ConvertigoAgentBridge", version: "0\.4\.2", tag: "v0\.4\.2"/);
assert.match(pageSource, /lib_ConvertigoAssistant", version: "1\.4\.3", tag: "v1\.4\.3"/);
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
