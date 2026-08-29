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
source = source.replace(
  /\}\(\)\);\s*$/,
  "C8O.assistantAgentBridge._test = { assistantProfileDescriptor, buildSequencePrompt, bridgeSessionSlot, bridgeSessionCookie, responseSessionCookie, rememberBridgeSessionCookie };}());"
);
vm.runInThisContext(source, { filename: "agent_bridge_client.js" });

const testApi = C8O.assistantAgentBridge._test;
assert.equal(testApi.assistantProfileDescriptor({ userId: "studio", assistantSurface: "studio" }).id, "generalist");
assert.equal(testApi.assistantProfileDescriptor({ userId: "studio", assistantSurface: "studio", agentProfile: "flow" }).id, "flow");
assert.equal(testApi.assistantProfileDescriptor({ userId: "alice", assistantSurface: "studio", agentProfile: "flow" }).id, "nocode");

const prompt = testApi.buildSequencePrompt("Create a Flow Svelte project", {
  userId: "studio",
  assistantSurface: "studio",
  agentProfile: "generalist",
  mcpEndpoint: "http://localhost/convertigo/api/mcp"
});
assert.match(prompt, /Surface profile: studio/);
assert.match(prompt, /Authoring policy: route-by-target-model/);
assert.match(prompt, /managed `convertigo-studio` routing skill/);
assert.match(prompt, /Explicit Flow\/FlowScript\/Flow Svelte intent selects `convertigo-flow`/);
assert.doesNotMatch(prompt, /Authoring policy: legacy-only/);

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
