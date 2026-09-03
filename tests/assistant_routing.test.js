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
  "C8O.assistantAgentBridge._test = { assistantProfileDescriptor, buildSequencePrompt, bridgeSessionSlot, bridgeSessionCookie, responseSessionCookie, rememberBridgeSessionCookie, usesProtectedConvertigoMcp, isTerminalStatus, shouldInstallForRun, selectConversationRecordForRunId };}());"
);
vm.runInThisContext(source, { filename: "agent_bridge_client.js" });

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
