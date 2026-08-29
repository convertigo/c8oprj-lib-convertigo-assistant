if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantAgentBridge = C8O.assistantAgentBridge || {};

(function () {
  var DEFAULT_BRIDGE_PROJECT = "lib_ConvertigoAgentBridge";
  var FALLBACK_MCP_PATH = "/api/mcp";
  var FALLBACK_FLOW_MCP_PATH = "/api/flow-mcp";
  // Bootstrap-only compatibility map. AgentBridge owns the authoritative profile contract.
  var ASSISTANT_PROFILE_BOOTSTRAP = {
    generalist: {
      id: "generalist",
      label: "Convertigo Generalist",
      authoringPolicy: "legacy-only",
      aliases: ["generalist", "legacy"],
      mcpPath: FALLBACK_MCP_PATH,
      skillSlug: "convertigo-generalist"
    },
    nocode: {
      id: "nocode",
      label: "Convertigo NoCode",
      authoringPolicy: "nocode",
      aliases: ["nocode", "no-code", "c8oforms", "forms"],
      mcpPath: FALLBACK_MCP_PATH,
      skillSlug: "convertigo-nocode"
    },
    flow: {
      id: "flow",
      label: "Convertigo Flow",
      authoringPolicy: "flow-only",
      aliases: ["flow", "flowscript", "flow-svelte", "frontbuilder-svelte"],
      mcpPath: FALLBACK_FLOW_MCP_PATH,
      skillSlug: "convertigo-flow-mcp"
    }
  };
  var STATE_PREFIX = "lib_ConvertigoAssistant.agentConversation.";
  var BUFFER_KEY = "C8OAiAssistantBuffer";
  var DEFAULT_EVENT_WAIT_MS = 10000;
  var MAX_TRANSIENT_READ_ERRORS = 6;

  var File = Packages.java.io.File;
  var BufferedReader = Packages.java.io.BufferedReader;
  var InputStreamReader = Packages.java.io.InputStreamReader;
  var URL = Packages.java.net.URL;
  var URLEncoder = Packages.java.net.URLEncoder;
  var HashMap = Packages.java.util.HashMap;
  var UUID = Packages.java.util.UUID;
  var System = Packages.java.lang.System;
  var Runnable = Packages.java.lang.Runnable;
  var Thread = Packages.java.lang.Thread;
  var MessageDigest = Packages.java.security.MessageDigest;
  var InternalRequester = Packages.com.twinsoft.convertigo.engine.requesters.InternalRequester;
  var XMLUtils = Packages.com.twinsoft.convertigo.engine.util.XMLUtils;
  var JsonOutput = Packages.com.twinsoft.convertigo.engine.enums.JsonOutput;
  var Engine = Packages.com.twinsoft.convertigo.engine.Engine;
  var Files = Packages.java.nio.file.Files;
  var StandardOpenOption = Packages.java.nio.file.StandardOpenOption;
  var StandardCharsets = Packages.java.nio.charset.StandardCharsets;
  var NOCODE_MCP_TOKEN_HANDLE_PREFIX = "lib_ConvertigoAssistant.nocodeMcpToken.";
  var NOCODE_MCP_TOKEN_SESSION_PREFIX = "lib_ConvertigoAssistant.nocodeMcpTokenHandle.";

  function now() {
    return System.currentTimeMillis();
  }

  function makeRunId(requestId) {
    return String(now()) + "-" + String(requestId || 0);
  }

  function trim(value) {
    if (value === null || typeof value === "undefined") {
      return "";
    }
    return String(value).replace(/^\s+|\s+$/g, "");
  }

  function requestParameter(name) {
    try {
      var request = context && context.httpServletRequest ? context.httpServletRequest : null;
      if (request !== null) {
        return trim(request.getParameter(String(name)));
      }
    } catch (_ignoreRequestParameter) {}
    return "";
  }

  function optionOrRequest(options, name) {
    options = options || {};
    var value = trim(options[name]);
    return value.length ? value : requestParameter(name);
  }

  function optionsWithRequestFallbacks(options) {
    options = options || {};
    var copy = {};
    for (var key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        copy[key] = options[key];
      }
    }
    [
      "provider", "agentProvider", "targetProject", "projectName", "projectId",
      "userId", "agentProfile", "skillProfile", "assistantContext",
      "assistantSurface", "codexHomeScope", "vibeHomeScope", "homeScope",
      "agentRevealMode", "convertigoRevealMode", "uiRevealMode", "revealMode",
      "language", "locale", "assistantLanguage", "currentUrl", "currentRoute", "currentPath", "currentFormId", "currentFormUrl",
      "nocodeCurrentUrl", "nocodeCurrentRoute", "nocodeCurrentFormId", "nocodeCurrentFormUrl",
      "formId", "pageId", "applicationId", "currentPage", "currentApplicationId",
      "codexHome", "vibeHome", "agentHome", "mcpEndpoint", "workspaceRoot",
      "settingsTimeoutMs", "checkUpdates", "refreshUpdateCheck", "updateCheckTimeoutMs",
      "updateCheckCacheMs", "runtimePresenceOnly", "updateRuntime", "forceRuntimeUpdate",
      "model", "reasoningEffort", "reasoningLevel", "serviceTier", "savePreferences",
      "nocodeMcpTokenHandle", "noCodeMcpTokenHandle",
      "mcpBearerTokenHandle", "browserDebugUrl", "browserDevToolsJsonUrl",
      "browserDevToolsWebSocketUrl", "playwrightCdpEndpoint",
      "playwrightMcpEndpoint", "viewerCdpEndpoint", "browserControlReady"
    ].forEach(function (name) {
      if (!trim(copy[name]).length) {
        var value = requestParameter(name);
        if (value.length) {
          copy[name] = value;
        }
      }
    });
    return copy;
  }

  function firstOptionValue(options, names) {
    options = options || {};
    for (var i = 0; i < names.length; i++) {
      var value = trim(options[names[i]]);
      if (value.length) {
        return value;
      }
    }
    return "";
  }

  function revealModeOption(options) {
    return firstOptionValue(options, ["agentRevealMode", "convertigoRevealMode", "uiRevealMode", "revealMode", "reveal"]);
  }

  function normalizeAssistantLanguage(value) {
    var text = trim(value).toLowerCase();
    if (!text.length) {
      return "";
    }
    text = text.replace("_", "-");
    if (text.indexOf("fr") === 0 || text.indexOf("french") === 0 || text.indexOf("français") === 0 || text.indexOf("francais") === 0) {
      return "fr";
    }
    if (text.indexOf("en") === 0 || text.indexOf("english") === 0 || text.indexOf("anglais") === 0) {
      return "en";
    }
    if (text.indexOf("es") === 0 || text.indexOf("spanish") === 0 || text.indexOf("espagnol") === 0) {
      return "es";
    }
    if (text.indexOf("it") === 0 || text.indexOf("italian") === 0 || text.indexOf("italien") === 0) {
      return "it";
    }
    return text.length <= 8 ? text : "";
  }

  function assistantLanguageName(value) {
    var langCode = normalizeAssistantLanguage(value);
    if (langCode === "fr") {
      return "French";
    }
    if (langCode === "en") {
      return "English";
    }
    if (langCode === "es") {
      return "Spanish";
    }
    if (langCode === "it") {
      return "Italian";
    }
    return langCode;
  }

  function noCodePromptContextBlock(options) {
    if (normalizeSkillProfile(options) !== "nocode") {
      return "";
    }
    var currentUrl = firstOptionValue(options, ["currentUrl", "nocodeCurrentUrl", "currentFormUrl", "nocodeCurrentFormUrl"]);
    var currentRoute = firstOptionValue(options, ["currentRoute", "nocodeCurrentRoute", "currentPath"]);
    var currentFormId = firstOptionValue(options, ["currentFormId", "nocodeCurrentFormId", "formId", "applicationId", "currentApplicationId"]);
    var currentPage = firstOptionValue(options, ["pageId", "currentPage"]);
    var language = assistantLanguageName(firstOptionValue(options, ["language", "locale", "assistantLanguage"]));
    var lines = [];
    lines.push("Runtime NoCode context supplied by the host application:");
    lines.push("- Surface: C8Oforms / No-Code Studio.");
    lines.push("- User interface language: " + (language.length ? language : "unknown") + ".");
    lines.push("- Current URL: " + (currentUrl.length ? currentUrl : "none"));
    lines.push("- Current route: " + (currentRoute.length ? currentRoute : "none"));
    lines.push("- Current form/application id: " + (currentFormId.length ? currentFormId : "none"));
    lines.push("- Current page id/name: " + (currentPage.length ? currentPage : "none"));
    if (language.length) {
      lines.push("- Reply to the user and write progress/details in " + language + ".");
    }
    lines.push("- If a current form/application id or URL is provided, use it as the default target for edits unless the user explicitly names another target.");
    lines.push("- If a first tool discovery attempt does not show NoCode tools, retry with exact searches for `Convertigo NoCode form contract get edit update validate compile C8Oforms`, `nocode-form-contract-get nocode-form-edit nocode-form-update`, and `mcp__convertigo nocode_form_contract_get nocode_form_edit nocode_form_update` before reporting a blocker.");
    return lines.join("\n");
  }

  function enrichNoCodePrompt(question, options) {
    var block = noCodePromptContextBlock(options);
    if (!block.length || String(question).indexOf("Runtime NoCode context supplied by the host application:") !== -1) {
      return question;
    }
    var marker = "\nUser message:\n";
    var text = String(question);
    var markerIndex = text.indexOf(marker);
    if (markerIndex >= 0) {
      return text.substring(0, markerIndex) + "\n\n" + block + text.substring(markerIndex);
    }
    return block + "\n\nUser message:\n" + text;
  }

  function boolValue(value, defaultValue) {
    if (value === null || typeof value === "undefined" || trim(value) === "") {
      return defaultValue === true;
    }
    if (value === true || value === false) {
      return value === true;
    }
    var text = trim(value).toLowerCase();
    return text === "true" || text === "1" || text === "yes" || text === "on";
  }

  function intValue(value, defaultValue, minValue, maxValue) {
    var parsed = parseInt(trim(value), 10);
    if (isNaN(parsed)) {
      parsed = defaultValue;
    }
    if (typeof minValue === "number" && parsed < minValue) {
      parsed = minValue;
    }
    if (typeof maxValue === "number" && parsed > maxValue) {
      parsed = maxValue;
    }
    return parsed;
  }

  function filePath(file) {
    return String(file.getCanonicalPath());
  }

  function childPath(parent, name) {
    return filePath(new File(parent, name));
  }

  function normalizeConvertigoBaseUrl(value) {
    var text = trim(value);
    if (!text.length) {
      return "";
    }
    text = text.replace(/\/+$/g, "");
    var convertigoIndex = text.toLowerCase().indexOf("/convertigo");
    if (convertigoIndex >= 0) {
      return text.substring(0, convertigoIndex + "/convertigo".length);
    }
    var marker = "/projects/";
    var projectIndex = text.indexOf(marker);
    if (projectIndex >= 0) {
      text = text.substring(0, projectIndex);
    }
    var jsonIndex = text.indexOf("/.json");
    if (jsonIndex >= 0) {
      text = text.substring(0, jsonIndex);
    }
    if (!/\/convertigo$/i.test(text)) {
      text += "/convertigo";
    }
    return text;
  }

  function engineConvertigoBaseUrl() {
    try {
      var EnginePropertiesManager = Packages.com.twinsoft.convertigo.engine.EnginePropertiesManager;
      var PropertyName = Packages.com.twinsoft.convertigo.engine.EnginePropertiesManager.PropertyName;
      var url = normalizeConvertigoBaseUrl(EnginePropertiesManager.getProperty(PropertyName.APPLICATION_SERVER_CONVERTIGO_URL));
      if (url.length) {
        return url;
      }
      url = normalizeConvertigoBaseUrl(EnginePropertiesManager.getProperty(PropertyName.APPLICATION_SERVER_CONVERTIGO_ENDPOINT));
      if (url.length) {
        return url;
      }
    } catch (_ignoreConvertigoUrlProperty) {}
    try {
      var request = context && context.httpServletRequest ? context.httpServletRequest : null;
      if (request !== null) {
        var port = request.getServerPort();
        var portPart = (port === 80 || port === 443) ? "" : ":" + port;
        var requestUrl = normalizeConvertigoBaseUrl(request.getScheme() + "://" + request.getServerName() + portPart + request.getContextPath());
        if (requestUrl.length) {
          return requestUrl;
        }
      }
    } catch (_ignoreRequestConvertigoUrl) {}
    try {
      return "http://localhost:" + (Packages.com.twinsoft.convertigo.engine.Engine.isStudioMode() ? "18080" : "28080") + "/convertigo";
    } catch (_ignoreStudioMode) {
      return "http://localhost:18080/convertigo";
    }
  }

  function defaultBridgeUrl() {
    return engineConvertigoBaseUrl().replace(/\/+$/g, "") + "/projects/" + DEFAULT_BRIDGE_PROJECT + "/.json";
  }

  function defaultMcpEndpoint(profileOptions) {
    return engineConvertigoBaseUrl().replace(/\/+$/g, "") + assistantProfileDescriptor(profileOptions || {}).mcpPath;
  }

  function callLocalSequence(project, sequence, variables) {
    var params = new HashMap();
    var projectArray = java.lang.reflect.Array.newInstance(java.lang.String, 1);
    projectArray[0] = project;
    params.put("__project", projectArray);
    params.put("__sequence", sequence);
    params.put("__context", "agentToken_" + String(now()));
    variables = variables || {};
    for (var key in variables) {
      if (Object.prototype.hasOwnProperty.call(variables, key) && variables[key] !== null && typeof variables[key] !== "undefined") {
        params.put(key, variables[key]);
      }
    }
    var requester = new InternalRequester(params, context.httpServletRequest);
    var response = requester.processRequest();
    var json = JSON.parse(XMLUtils.XmlToJson(response.getDocumentElement(), true, true, JsonOutput.JsonRoot.docNode).toString());
    try {
      var ctx2 = requester.getContext();
      Engine.theApp.contextManager.remove(ctx2);
    } catch (_ignoreContextCleanup) {}
    return json;
  }

  function unwrapSequenceResult(response) {
    if (response && response.document && response.document.result) {
      return response.document.result;
    }
    if (response && response.doc && response.doc.document && response.doc.document.result) {
      return response.doc.document.result;
    }
    if (response && response.result) {
      return response.result;
    }
    return response;
  }

  function normalizeCdpEndpoint(value) {
    var text = trim(value);
    if (text.match(/\/json\/?$/)) {
      text = text.replace(/\/json\/?$/, "");
    }
    return text;
  }

  function existingViewerCdpEndpoint(options) {
    options = options || {};
    return normalizeCdpEndpoint(
      options.playwrightCdpEndpoint ||
      options.viewerCdpEndpoint ||
      options.browserDebugUrl ||
      options.browserDevToolsWebSocketUrl ||
      options.browserDevToolsJsonUrl ||
      options.playwrightMcpEndpoint
    );
  }

  function firstResultValue(result, names) {
    if (!result) {
      return "";
    }
    for (var i = 0; i < names.length; i++) {
      var value = trim(result[names[i]]);
      if (value.length) {
        return value;
      }
    }
    return "";
  }

  function unwrapBuilderStateResponse(response) {
    var result = unwrapSequenceResult(response);
    if (result && result.document && result.document.result) {
      result = result.document.result;
    }
    if (result && result.result) {
      result = result.result;
    }
    return result || {};
  }

  function blankBrowserTargetUrl(value) {
    var text = trim(value).toLowerCase();
    return !text.length || text === "about:blank";
  }

  function builderControlTargetUrl(builder) {
    builder = builder || {};
    var target = builder.browserDevToolsTarget || {};
    var browser = builder.browser || {};
    return trim(target.url || builder.browserControlTargetUrl || browser.currentUrl || browser.locationHref);
  }

  function builderBrowserControlReady(builder) {
    builder = builder || {};
    if (!firstResultValue(builder, ["browserDebugUrl", "browserRemoteDebuggingUrl", "browserDevToolsJsonUrl", "browserDevToolsWebSocketUrl"]).length) {
      return false;
    }
    var targetUrl = builderControlTargetUrl(builder);
    if (blankBrowserTargetUrl(targetUrl)) {
      return false;
    }
    if (typeof builder.browserControlReady !== "undefined" && !boolValue(builder.browserControlReady, false)) {
      return false;
    }
    return true;
  }

  function clearViewerDebugOptions(options) {
    options.browserDebugUrl = "";
    options.browserDevToolsJsonUrl = "";
    options.browserDevToolsWebSocketUrl = "";
    options.playwrightCdpEndpoint = "";
    options.viewerCdpEndpoint = "";
    options.browserControlReady = "false";
  }

  function shouldOpenViewerBeforeAgentStart(options, state) {
    options = options || {};
    if (boolValue(options.skipViewerDebugOpen || options.skipMobileBuilderPreopen, false)) {
      return false;
    }
    if (boolValue(options.openViewerBeforeAgentStart || options.preopenMobileBuilder, false)) {
      return true;
    }
    var text = trim(options.userQuestion || options.prompt || (state && state.userQuestion) || "");
    if (!text.length) {
      return false;
    }
    var normalized = (" " + text.toLowerCase().replace(/[’']/g, " ") + " ");
    var directViewerActions = [
      " bouton ", " boutons ", " clique ", " cliquer ", " clic ", " appuie ", " appuis ",
      " appuyer ", " press ", " click ", " button "
    ];
    for (var i = 0; i < directViewerActions.length; i++) {
      if (normalized.indexOf(directViewerActions[i]) !== -1) {
        return true;
      }
    }
    var proofActions = [
      " teste ", " tester ", " test ", " vérifie ", " verifie ", " contrôle ", " controle ",
      " analyse ", " analyser ", " inspecte ", " inspecter ", " regarde ", " regarder "
    ];
    var viewerContexts = [
      " application ", " app ", " ui ", " ux ", " front ", " frontend ", " viewer ",
      " écran ", " ecran ", " page ", " affichage ", " visuel ", " visible ", " builder ",
      " ngx ", " mobile "
    ];
    var hasProofAction = false;
    for (var j = 0; j < proofActions.length; j++) {
      if (normalized.indexOf(proofActions[j]) !== -1) {
        hasProofAction = true;
        break;
      }
    }
    if (!hasProofAction) {
      return false;
    }
    for (var k = 0; k < viewerContexts.length; k++) {
      if (normalized.indexOf(viewerContexts[k]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function applyViewerDebugOptionsFromBuilder(options, builder, force) {
    options = options || {};
    builder = builder || {};
    if (!builderBrowserControlReady(builder)) {
      if (force === true) {
        clearViewerDebugOptions(options);
      }
      return existingViewerCdpEndpoint(options);
    }
    var debugUrl = firstResultValue(builder, ["browserDebugUrl", "browserRemoteDebuggingUrl"]);
    var jsonUrl = firstResultValue(builder, ["browserDevToolsJsonUrl"]);
    var wsUrl = firstResultValue(builder, ["browserDevToolsWebSocketUrl"]);
    var cdp = normalizeCdpEndpoint(firstResultValue(builder, [
      "playwrightCdpEndpoint",
      "viewerCdpEndpoint",
      "browserDebugUrl",
      "browserDevToolsWebSocketUrl",
      "browserDevToolsJsonUrl"
    ]));
    if (debugUrl.length && (force === true || !trim(options.browserDebugUrl).length)) {
      options.browserDebugUrl = debugUrl;
    }
    if (jsonUrl.length && (force === true || !trim(options.browserDevToolsJsonUrl).length)) {
      options.browserDevToolsJsonUrl = jsonUrl;
    }
    if (wsUrl.length && (force === true || !trim(options.browserDevToolsWebSocketUrl).length)) {
      options.browserDevToolsWebSocketUrl = wsUrl;
    }
    if (cdp.length) {
      if (force === true || !trim(options.playwrightCdpEndpoint).length) {
        options.playwrightCdpEndpoint = cdp;
      }
      if (force === true || !trim(options.viewerCdpEndpoint).length) {
        options.viewerCdpEndpoint = cdp;
      }
    }
    options.browserControlReady = "true";
    return existingViewerCdpEndpoint(options);
  }

  function enrichViewerDebugOptions(options, state) {
    options = options || {};
    if (boolValue(options.skipViewerDebugProbe, false)) {
      return options;
    }
    if (normalizeSkillProfile(options) === "flow") {
      return options;
    }
    var project = trim(options.targetProject || options.projectName || options.projectId);
    if (!project.length && state) {
      project = trim(state.primaryProject || state.projectId);
    }
    if (!project.length) {
      return options;
    }
    try {
      var builder = unwrapBuilderStateResponse(callLocalSequence("lib_ConvertigoMCP", "tools_mobile_builder_open", {
        project: project,
        stateOnly: "true",
        wait: "false",
        timeoutSec: "0",
        logsLimit: "0",
        __nolog: "true"
      }));
      if (!applyViewerDebugOptionsFromBuilder(options, builder, true).length && shouldOpenViewerBeforeAgentStart(options, state)) {
        builder = unwrapBuilderStateResponse(callLocalSequence("lib_ConvertigoMCP", "tools_mobile_builder_open", {
          project: project,
          stateOnly: "false",
          wait: "false",
          timeoutSec: "0",
          logsLimit: "0",
          reveal: revealModeOption(options),
          __nolog: "true"
        }));
        if (!applyViewerDebugOptionsFromBuilder(options, builder, true).length) {
          try { Thread.sleep(350); } catch (_ignoreViewerDebugSleep) {}
          builder = unwrapBuilderStateResponse(callLocalSequence("lib_ConvertigoMCP", "tools_mobile_builder_open", {
            project: project,
            stateOnly: "true",
            wait: "false",
            timeoutSec: "0",
            logsLimit: "0",
            __nolog: "true"
          }));
          applyViewerDebugOptionsFromBuilder(options, builder, true);
        }
      }
    } catch (_ignoreViewerDebugProbe) {}
    return options;
  }

  function noCodeMcpUserId(options) {
    options = options || {};
    var userId = trim(options.userId || optionOrRequest(options, "userId"));
    return userId.length ? userId : "session";
  }

  function noCodeMcpTokenLabel(options) {
    return "Convertigo Agent Bridge - " + noCodeMcpUserId(options);
  }

  function noCodeMcpTokenFile(options, userKey) {
    var root = new File(resolveWorkspaceRoot(options), "agents");
    var usersDir = new File(new File(new File(root, "nocode"), "users"), safePathPart(userKey));
    return new File(usersDir, "mcp-token.json");
  }

  function restrictSecretFile(file) {
    try {
      file.setReadable(false, false);
      file.setWritable(false, false);
      file.setExecutable(false, false);
      file.setReadable(true, true);
      file.setWritable(true, true);
    } catch (_ignoreSecretPermissions) {}
  }

  function decodeJwtPart(part) {
    var text = String(part || "");
    while (text.length % 4 !== 0) {
      text += "=";
    }
    var bytes = Packages.java.util.Base64.getUrlDecoder().decode(text);
    return String(new java.lang.String(bytes, StandardCharsets.UTF_8));
  }

  function validateNoCodeMcpToken(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length !== 3) {
        return false;
      }
      var response = callLocalSequence("C8Oforms", "APIV2_McpTokenValidate", {
        headerJson: decodeJwtPart(parts[0]),
        payloadJson: decodeJwtPart(parts[1]),
        signingInput: parts[0] + "." + parts[1],
        signature: parts[2]
      });
      var result = unwrapSequenceResult(response) || {};
      if (result.result) {
        result = result.result;
      }
      return trim(result.status).toLowerCase() === "ok" || result.authenticated === true;
    } catch (_ignoreNoCodeTokenValidate) {
      return false;
    }
  }

  function readNoCodeMcpToken(options, userKey) {
    var file = noCodeMcpTokenFile(options, userKey);
    var record = readJsonFile(file);
    var token = record && record.token ? trim(record.token) : "";
    if (!token.length) {
      return "";
    }
    if (!validateNoCodeMcpToken(token)) {
      return "";
    }
    return token;
  }

  function writeNoCodeMcpToken(options, userKey, userId, token, tokenInfo) {
    var file = noCodeMcpTokenFile(options, userKey);
    writeJsonFile(file, {
      userId: userId,
      userKey: userKey,
      name: noCodeMcpTokenLabel(options),
      token: token,
      tokenInfo: tokenInfo || null,
      createdAt: now(),
      updatedAt: now(),
      source: "C8Oforms.APIV2_McpTokenCreate"
    });
    restrictSecretFile(file);
  }

  function createNoCodeMcpToken(options, userKey, userId) {
    try {
      var label = noCodeMcpTokenLabel(options);
      var response = callLocalSequence("C8Oforms", "APIV2_McpTokenCreate", {
        name: label
      });
      var result = unwrapSequenceResult(response) || {};
      var token = trim(result.token);
      if (!token.length) {
        return "";
      }
      writeNoCodeMcpToken(options, userKey, userId, token, result.tokenInfo || null);
      return token;
    } catch (_ignoreNoCodeTokenCreate) {
      return "";
    }
  }

  function sharedSecretGet(handle) {
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.get) {
        var value = storage.get(handle);
        return value === null || typeof value === "undefined" ? "" : trim(value);
      }
    } catch (_ignoreSecretGet) {}
    return "";
  }

  function sharedSecretSet(handle, value) {
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.set) {
        storage.set(handle, String(value));
        return true;
      }
    } catch (_ignoreSecretSet) {}
    return false;
  }

  function noCodeMcpTokenHandle(options) {
    options = options || {};
    if (normalizeSkillProfile(options) !== "nocode") {
      return "";
    }
    var explicitHandle = trim(options.nocodeMcpTokenHandle || options.noCodeMcpTokenHandle || options.mcpBearerTokenHandle);
    if (explicitHandle.length && sharedSecretGet(explicitHandle).length) {
      return explicitHandle;
    }
    var userId = noCodeMcpUserId(options);
    var userKey = normalizeUserKey(userId);
    var handle = NOCODE_MCP_TOKEN_HANDLE_PREFIX + userKey;
    var sessionKey = NOCODE_MCP_TOKEN_SESSION_PREFIX + userKey;
    try {
      var existingHandle = context.httpSession.getAttribute(sessionKey);
      if (existingHandle !== null && typeof existingHandle !== "undefined") {
        existingHandle = String(existingHandle);
        if (trim(existingHandle).length && sharedSecretGet(existingHandle).length) {
          return existingHandle;
        }
      }
    } catch (_ignoreExistingTokenHandle) {}
    var token = readNoCodeMcpToken(options, userKey);
    if (!token.length) {
      token = createNoCodeMcpToken(options, userKey, userId);
    }
    if (!token.length) {
      return "";
    }
    if (!sharedSecretSet(handle, token)) {
      return "";
    }
    try {
      context.httpSession.setAttribute(sessionKey, handle);
    } catch (_ignoreTokenHandleSession) {}
    return handle;
  }

  function shouldAttachNoCodeMcpTokenHandle(sequence) {
    return sequence === "agent_codex_setup" || sequence === "agent_codex_start";
  }

  function normalizeWorkspaceRootPath(value) {
    var text = trim(value);
    if (!text.length) {
      return "";
    }
    var root = new File(text);
    var studioWorkspace = new File(root, ".metadata/.plugins/com.twinsoft.convertigo.studio");
    if (studioWorkspace.isDirectory()) {
      return filePath(studioWorkspace);
    }
    return filePath(root);
  }

  function engineWorkspaceRoot() {
    try {
      var workspace = normalizeWorkspaceRootPath(Packages.com.twinsoft.convertigo.engine.Engine.USER_WORKSPACE_PATH);
      if (workspace.length) {
        return workspace;
      }
    } catch (_ignoreEngineWorkspace) {}
    try {
      var propertyWorkspace = normalizeWorkspaceRootPath(System.getProperty("convertigo.cems.user_workspace_path"));
      if (propertyWorkspace.length) {
        return propertyWorkspace;
      }
    } catch (_ignoreEngineWorkspaceProperty) {}
    return "";
  }

  function workspaceRootFromProjectDir(projectDir) {
    if (projectDir === null || typeof projectDir === "undefined") {
      return "";
    }
    var dir = projectDir && projectDir.getParentFile ? projectDir : new File(String(projectDir));
    var parent = dir.getParentFile();
    if (parent === null) {
      return "";
    }
    var studioWorkspace = new File(parent, ".metadata/.plugins/com.twinsoft.convertigo.studio");
    if (studioWorkspace.isDirectory()) {
      return filePath(studioWorkspace);
    }
    if (String(parent.getName()) === "projects" && parent.getParentFile() !== null) {
      return filePath(parent.getParentFile());
    }
    return "";
  }

  function projectWorkspaceRoot(projectName) {
    var name = trim(projectName);
    if (!name.length) {
      return "";
    }
    try {
      var project = Packages.com.twinsoft.convertigo.engine.Engine.theApp.databaseObjectsManager.getProjectByName(name);
      if (project && project.getDirFile) {
        var workspace = workspaceRootFromProjectDir(project.getDirFile());
        if (workspace.length) {
          return workspace;
        }
      }
    } catch (_ignoreTargetProjectDir) {}
    try {
      var project2 = Packages.com.twinsoft.convertigo.engine.Engine.theApp.databaseObjectsManager.getProjectByName(name);
      if (project2 && project2.getDirPath) {
        var workspace2 = workspaceRootFromProjectDir(project2.getDirPath());
        if (workspace2.length) {
          return workspace2;
        }
      }
    } catch (_ignoreTargetProjectPath) {}
    return "";
  }

  function defaultWorkspaceRoot(projectName) {
    var engineWorkspace = engineWorkspaceRoot();
    if (engineWorkspace.length) {
      return engineWorkspace;
    }
    var targetWorkspace = projectWorkspaceRoot(projectName);
    if (targetWorkspace.length) {
      return targetWorkspace;
    }
    try {
      if (context && context.project && context.project.getDirFile) {
        var contextWorkspace = workspaceRootFromProjectDir(context.project.getDirFile());
        if (contextWorkspace.length) {
          return contextWorkspace;
        }
      }
    } catch (_ignoreProjectDir) {}
    return filePath(new File(System.getProperty("user.home"), "convertigo"));
  }

  function workspaceProjectName(options) {
    options = options || {};
    return trim(options.targetProject || options.projectName || options.projectId || options.primaryProject);
  }

  function resolveWorkspaceRoot(options) {
    options = options || {};
    var explicit = trim(options.workspaceRoot);
    if (explicit.length) {
      return normalizeWorkspaceRootPath(explicit);
    }
    return defaultWorkspaceRoot(workspaceProjectName(options));
  }

  function readTextFile(file) {
    if (!file.exists()) {
      return "";
    }
    return String(new java.lang.String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
  }

  function ensureDir(dir) {
    if (dir.exists()) {
      if (!dir.isDirectory()) {
        throw new Error("Path is not a directory: " + filePath(dir));
      }
      return;
    }
    if (!dir.mkdirs()) {
      throw new Error("Unable to create directory: " + filePath(dir));
    }
  }

  function ensureParentDir(file) {
    var parent = file.getParentFile();
    if (parent !== null) {
      ensureDir(parent);
    }
  }

  function writeTextFile(file, content) {
    ensureParentDir(file);
    var bytes = new java.lang.String(String(content || "")).getBytes(StandardCharsets.UTF_8);
    Files.write(file.toPath(), bytes);
  }

  function appendTextFile(file, content) {
    ensureParentDir(file);
    var bytes = new java.lang.String(String(content || "")).getBytes(StandardCharsets.UTF_8);
    Files.write(file.toPath(), bytes, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }

  function readJsonFile(file) {
    try {
      var text = trim(readTextFile(file));
      return text.length ? JSON.parse(text) : null;
    } catch (_ignoreReadJson) {
      return null;
    }
  }

  function writeJsonFile(file, value) {
    writeTextFile(file, JSON.stringify(value || {}, null, 2));
  }

  function deleteRecursively(file) {
    if (!file.exists()) {
      return true;
    }
    if (file.isDirectory()) {
      var children = file.listFiles();
      if (children !== null) {
        for (var i = 0; i < children.length; i++) {
          deleteRecursively(children[i]);
        }
      }
    }
    return file["delete"]();
  }

  function readEnvFile(file) {
    var values = {};
    if (!file.exists()) {
      return values;
    }
    var lines = readTextFile(file).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line.length || line.indexOf("#") === 0) {
        continue;
      }
      if (line.indexOf("export ") === 0) {
        line = trim(line.substring(7));
      }
      var eq = line.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      var key = trim(line.substring(0, eq));
      var value = trim(line.substring(eq + 1));
      if ((value.indexOf('"') === 0 && value.lastIndexOf('"') === value.length - 1) ||
          (value.indexOf("'") === 0 && value.lastIndexOf("'") === value.length - 1)) {
        value = value.substring(1, value.length - 1);
      }
      if (key.length) {
        values[key] = value;
      }
    }
    return values;
  }

  function encodeForm(params) {
    var parts = [];
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        var value = params[key];
        if (value === null || typeof value === "undefined") {
          continue;
        }
        parts.push(
          String(URLEncoder.encode(String(key), "UTF-8")) + "=" +
          String(URLEncoder.encode(String(value), "UTF-8"))
        );
      }
    }
    return parts.join("&");
  }

  function readStream(stream) {
    if (stream === null || typeof stream === "undefined") {
      return "";
    }
    var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
    var sb = new java.lang.StringBuilder();
    var line;
    while ((line = reader.readLine()) !== null) {
      if (sb.length() > 0) {
        sb.append("\n");
      }
      sb.append(line);
    }
    reader.close();
    return String(sb.toString());
  }

  var BRIDGE_SESSION_COOKIE_ATTR = "convertigo.assistant.bridge.session.";

  function bridgeSessionSlot(params) {
    return params && trim(params.__sequence) === "agent_events" ? "events" : "commands";
  }

  function bridgeSessionCookie(slot) {
    try {
      var session = context && context.httpSession;
      var value = session && session.getAttribute ? session.getAttribute(BRIDGE_SESSION_COOKIE_ATTR + slot) : null;
      return value === null || typeof value === "undefined" ? "" : trim(value);
    } catch (_ignoreBridgeSession) {
      return "";
    }
  }

  function responseSessionCookie(header) {
    var value = trim(header);
    var match = /(?:^|[,;]\s*)(JSESSIONID=[^;,\s]+)/i.exec(value);
    return match ? match[1] : "";
  }

  function rememberBridgeSessionCookie(slot, header) {
    var cookie = responseSessionCookie(header);
    if (!cookie.length) {
      return "";
    }
    try {
      var session = context && context.httpSession;
      if (session && session.setAttribute) {
        session.setAttribute(BRIDGE_SESSION_COOKIE_ATTR + slot, cookie);
      }
    } catch (_ignoreBridgeSession) {
      // A request without an outer session keeps the historical stateless behavior.
    }
    return cookie;
  }

  function postForm(urlText, params, timeoutMs) {
    var conn = new URL(urlText).openConnection();
    conn.setRequestMethod("POST");
    conn.setConnectTimeout(timeoutMs);
    conn.setReadTimeout(timeoutMs);
    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    conn.setRequestProperty("Accept", "application/json");
    var sessionSlot = bridgeSessionSlot(params);
    var sessionCookie = bridgeSessionCookie(sessionSlot);
    if (sessionCookie.length) {
      conn.setRequestProperty("Cookie", sessionCookie);
    }
    conn.setDoOutput(true);

    var body = encodeForm(params);
    var bytes = new java.lang.String(body).getBytes(StandardCharsets.UTF_8);
    var out = conn.getOutputStream();
    out.write(bytes);
    out.close();

    var code = conn.getResponseCode();
    rememberBridgeSessionCookie(sessionSlot, conn.getHeaderField("Set-Cookie"));
    var text = readStream(code >= 400 ? conn.getErrorStream() : conn.getInputStream());
    if (code >= 400) {
      throw new Error("HTTP " + code + " from agent bridge: " + text);
    }
    if (!trim(text).length) {
      return {};
    }
    return JSON.parse(text);
  }

  function bridgeCall(options, sequence, params, timeoutMs) {
    var payload = {
      __connector: "void",
      __sequence: sequence
    };
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        payload[key] = params[key];
      }
    }
    if (!payload.workspaceRoot && options.workspaceRoot) {
      payload.workspaceRoot = options.workspaceRoot;
    }
    if (!payload.projectId && (options.primaryProject || options.projectId)) {
      payload.projectId = options.primaryProject || options.projectId;
    }
    if (!payload.userId && options.userId) {
      payload.userId = options.userId;
    }
    if (!payload.conversationId && (options.conversationId || options.threadid)) {
      payload.conversationId = options.conversationId || options.threadid;
    }
    if (shouldAttachNoCodeMcpTokenHandle(sequence) && !trim(payload.nocodeMcpTokenHandle || payload.noCodeMcpTokenHandle || payload.mcpBearerTokenHandle).length) {
      var tokenHandle = noCodeMcpTokenHandle(options);
      if (tokenHandle.length) {
        payload.nocodeMcpTokenHandle = tokenHandle;
      }
    }
    var response = postForm(trim(options.bridgeBaseUrl) || defaultBridgeUrl(), payload, timeoutMs || 70000);
    return response && typeof response.result !== "undefined" ? response.result : response;
  }

  function bridgeStatus(value) {
    return trim(value && value.status).toLowerCase();
  }

  function codexPromptRequiresStart(result) {
    var status = bridgeStatus(result);
    if (status === "not_found" || status === "not_running" || status === "restart_required") {
      return true;
    }
    var error = trim(result && result.error).toLowerCase();
    return error.indexOf("unknown handle") >= 0 || error.indexOf("thread id is missing") >= 0;
  }

  function rememberCodexSessionFromResult(state, result) {
    if (!state || !result) {
      return;
    }
    if (result.state && (result.state.codexThreadId || result.state.sessionId)) {
      state.externalSessionId = String(result.state.codexThreadId || result.state.sessionId);
    } else if (result.codexThreadId) {
      state.externalSessionId = String(result.codexThreadId);
    } else if (result.state && result.state.sessionId) {
      state.externalSessionId = String(result.state.sessionId);
    } else if (result.sessionId) {
      state.externalSessionId = String(result.sessionId);
    }
  }

  function providerHomeScope(options, primaryName, secondaryName, defaultValue) {
    var value = trim(options[primaryName] || options.homeScope);
    if (!value.length && secondaryName) {
      value = trim(options[secondaryName]);
    }
    return value.length ? value : defaultValue;
  }

  function codexHomeScopeForRun(options) {
    if (existingViewerCdpEndpoint(options).length) {
      return "conversation";
    }
    var value = trim(options.codexHomeScope || options.homeScope || options.scope);
    if (value.length) {
      return value;
    }
    return "user";
  }

  function codexHomeForRun(options, scope) {
    options = options || {};
    var normalizedScope = trim(scope).toLowerCase();
    if (existingViewerCdpEndpoint(options).length && normalizedScope === "conversation") {
      return "";
    }
    return sanitizeCodexHome(options.codexHome);
  }

  function codexViewerSessionNeedsFreshThread(options, state) {
    if (!state || !trim(state.externalSessionId).length) {
      return false;
    }
    if (!existingViewerCdpEndpoint(options).length) {
      return false;
    }
    var home = trim(state.codexHome || state.agentHome);
    return home.length && !isConversationScopedCodexHome(home);
  }

  function clearCodexExternalSession(state) {
    if (!state) {
      return;
    }
    state.externalSessionId = "";
    state.codexThreadId = "";
    state.sessionId = "";
  }

  function agentStartPayload(state, options, provider, installRequested) {
    options = options || {};
    provider = normalizeProvider(provider || (state && state.provider));
    var env = {};
    if (provider === "codex") {
      var codexScope = codexHomeScopeForRun(options);
      return {
        handle: state.handle,
        cwd: state.cwd,
        codexHome: codexHomeForRun(options, codexScope),
        codexHomeScope: codexScope,
        conversationId: state.threadid || state.conversationId || "",
        projectId: state.primaryProject || state.projectId || "",
        userId: state.userId || state.userKey || "",
        agentProfile: state.agentProfile || state.skillProfile || options.agentProfile || options.skillProfile || "",
        skillProfile: state.skillProfile || options.skillProfile || options.agentProfile || "",
        assistantContext: state.assistantContext || options.assistantContext || "",
        assistantSurface: state.assistantSurface || options.assistantSurface || "",
        codexPath: trim(options.codexPath || options.commandPath),
        install: installRequested ? "true" : "false",
        nodeVersion: trim(options.nodeVersion),
        nodeDir: trim(options.nodeDir || options.nodeInstallDir),
        npmPath: trim(options.npmPath),
        allowNodeDownload: typeof options.allowNodeDownload === "undefined" ? "" : options.allowNodeDownload,
        codexPackage: trim(options.codexPackage || options.packageName),
        codexVersion: trim(options.codexVersion || options.packageVersion),
        codexInstallMethod: trim(options.codexInstallMethod || options.installMethod),
        codexInstallTimeoutMs: trim(options.codexInstallTimeoutMs),
        forceCodexInstall: typeof options.forceCodexInstall === "undefined" ? "" : options.forceCodexInstall,
        mcpSkillsSourceDir: trim(options.mcpSkillsSourceDir || options.skillsSourceDir || options.convertigoMcpDir),
        skipSkillsInstall: typeof options.skipSkillsInstall === "undefined" ? "" : options.skipSkillsInstall,
        mcpEndpoint: state.mcpEndpoint,
        browserDebugUrl: trim(options.browserDebugUrl),
        browserDevToolsJsonUrl: trim(options.browserDevToolsJsonUrl),
        browserDevToolsWebSocketUrl: trim(options.browserDevToolsWebSocketUrl),
        playwrightCdpEndpoint: trim(options.playwrightCdpEndpoint || options.viewerCdpEndpoint),
        playwrightMcpEndpoint: trim(options.playwrightMcpEndpoint),
        viewerCdpEndpoint: trim(options.viewerCdpEndpoint),
        agentRevealMode: revealModeOption(options),
        env: JSON.stringify(env),
        codexThreadId: state.externalSessionId || "",
        model: state.model || "",
        reasoningEffort: state.reasoningEffort || "",
        serviceTier: state.serviceTier || ""
      };
    }
    var vibeScope = providerHomeScope(options, "vibeHomeScope", "homeScope", "user");
    return {
      handle: state.handle,
      cwd: state.cwd,
      vibeHome: trim(options.vibeHome),
      vibeHomeScope: vibeScope,
      homeScope: vibeScope,
      conversationId: state.threadid || state.conversationId || "",
      projectId: state.primaryProject || state.projectId || "",
      userId: state.userId || state.userKey || "",
      agentProfile: state.agentProfile || state.skillProfile || options.agentProfile || options.skillProfile || "",
      skillProfile: state.skillProfile || options.skillProfile || options.agentProfile || "",
      assistantContext: state.assistantContext || options.assistantContext || "",
      assistantSurface: state.assistantSurface || options.assistantSurface || "",
      install: installRequested ? "true" : "false",
      mcpEndpoint: state.mcpEndpoint,
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      env: JSON.stringify(env),
      credentialsPolicy: trim(options.credentialsPolicy || options.envPolicy) || "vibe-home",
      agentRevealMode: revealModeOption(options),
      requestTimeoutMs: "60000"
    };
  }

  function prewarmCodexAppServer(state, options) {
    if (!state || normalizeProvider(state.provider) !== "codex") {
      return false;
    }
    if (state.status === "deleted" || state.status === "setup_required") {
      return false;
    }
    var bridgeOptions = {
      bridgeBaseUrl: state.bridgeBaseUrl || (options && options.bridgeBaseUrl) || defaultBridgeUrl(),
      workspaceRoot: state.workspaceRoot,
      primaryProject: state.primaryProject || state.projectId || "",
      projectId: state.projectId || state.primaryProject || "",
      userId: state.userId || state.userKey || "",
      conversationId: state.conversationId || state.threadid || "",
      threadid: state.threadid || ""
    };
    if (state.codexPrewarmStartedAt && now() - Number(state.codexPrewarmStartedAt) < 60000) {
      try {
        var status = bridgeCall(bridgeOptions, "agent_status", { handle: state.handle }, 10000);
        var alive = status && status.state && status.state.alive === true;
        if (alive) {
          state.codexPrewarmStatus = "ready";
          state.updatedAt = now();
          saveState(state);
          return true;
        }
      } catch (_ignorePrewarmStatus) {}
    }
    state.codexPrewarmStartedAt = now();
    state.codexPrewarmStatus = "starting";
    state.updatedAt = now();
    try {
      saveState(state);
    } catch (_ignorePrewarmSave) {}

    var payload = agentStartPayload(state, options || {}, "codex", false);
    if (!trim(payload.nocodeMcpTokenHandle || payload.noCodeMcpTokenHandle || payload.mcpBearerTokenHandle).length) {
      try {
        var tokenHandle = noCodeMcpTokenHandle(options || {});
        if (tokenHandle.length) {
          payload.nocodeMcpTokenHandle = tokenHandle;
        }
      } catch (_ignorePrewarmTokenHandle) {}
    }
    var thread = new Thread(new Runnable({
      run: function () {
        try {
          bridgeCall(bridgeOptions, "agent_codex_start", payload, 90000);
        } catch (_ignorePrewarmCodexStart) {}
      }
    }), "lib_ConvertigoAssistant-codex-prewarm-" + state.threadid);
    thread.setDaemon(true);
    thread.start();
    return true;
  }

  function normalizeThreadId(value) {
    var text = trim(value);
    if (!text.length || text === "null" || text === ":threadid") {
      return "";
    }
    return text;
  }

  function makeConversationId() {
    return "agent-" + String(UUID.randomUUID());
  }

  function safePathPart(value) {
    var text = String(value || "").replace(/[^A-Za-z0-9_.-]/g, "_");
    return text.length ? text : "_";
  }

  function hashShort(value) {
    var md = MessageDigest.getInstance("SHA-256");
    var bytes = md.digest(new java.lang.String(String(value || "")).getBytes(StandardCharsets.UTF_8));
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var n = Number(bytes[i]);
      if (n < 0) {
        n += 256;
      }
      if (n < 16) {
        out += "0";
      }
      out += n.toString(16);
    }
    return out.substring(0, 16);
  }

  function userPathSlug(value) {
    var text = trim(value);
    if (!text.length || text.toLowerCase() === "studio") {
      return "studio";
    }
    var readable = safePathPart(text.toLowerCase()).replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!readable.length) {
      readable = "user";
    }
    if (readable.length > 80) {
      readable = readable.substring(0, 80).replace(/[_.-]+$/g, "");
    }
    return readable + "--" + hashShort(text);
  }

  function normalizeConversationId(value) {
    var text = normalizeThreadId(value);
    return text.length ? safePathPart(text) : "";
  }

  function normalizeUserKey(value) {
    return userPathSlug(value);
  }

  function normalizeProvider(value) {
    var provider = trim(value).toLowerCase();
    if (provider === "codex-cli" || provider === "openai-codex") {
      return "codex";
    }
    if (provider === "mistral-vibe" || provider === "vibe-acp") {
      return "vibe";
    }
    return provider.length ? safePathPart(provider) : "vibe";
  }

  function normalizeProviderSelector(value) {
    var raw = trim(value).toLowerCase();
    if (!raw.length || raw === "all" || raw === "*" || raw === "any") {
      return "all";
    }
    return normalizeProvider(raw);
  }

  function normalizeSkillProfile(options) {
    return assistantProfileDescriptor(options).id;
  }

  function assistantProfileDescriptor(options) {
    options = options || {};
    var userId = trim(options.userId);
    var studioUser = !userId.length || userId.toLowerCase() === "studio";
    if (!studioUser) {
      return ASSISTANT_PROFILE_BOOTSTRAP.nocode;
    }
    var authoritative = options.agentCapabilityProfile;
    var authoritativeId = authoritative && typeof authoritative === "object" ? trim(authoritative.id).toLowerCase() : "";
    if (authoritativeId === "nocode") {
      authoritativeId = "";
    }
    if (authoritativeId.length && ASSISTANT_PROFILE_BOOTSTRAP[authoritativeId]) {
      var known = ASSISTANT_PROFILE_BOOTSTRAP[authoritativeId];
      return {
        id: authoritativeId,
        label: trim(authoritative.label) || known.label,
        authoringPolicy: trim(authoritative.authoringPolicy) || known.authoringPolicy,
        aliases: known.aliases,
        mcpPath: trim(authoritative.mcpPath) || known.mcpPath,
        skillSlug: trim(authoritative.skillSlug) || known.skillSlug
      };
    }
    var value = trim(options.agentProfile || options.skillProfile || options.assistantContext || options.profile).toLowerCase();
    for (var id in ASSISTANT_PROFILE_BOOTSTRAP) {
      if (!Object.prototype.hasOwnProperty.call(ASSISTANT_PROFILE_BOOTSTRAP, id)) {
        continue;
      }
      var descriptor = ASSISTANT_PROFILE_BOOTSTRAP[id];
      for (var i = 0; i < descriptor.aliases.length; i++) {
        if (value === descriptor.aliases[i] && id !== "nocode") {
          return descriptor;
        }
      }
    }
    return ASSISTANT_PROFILE_BOOTSTRAP.generalist;
  }

  function hasExplicitSkillProfile(record) {
    record = record || {};
    return trim(record.skillProfile || record.agentProfile || record.assistantContext).length > 0;
  }

  function conversationSkillProfile(record) {
    record = record || {};
    if (hasExplicitSkillProfile(record)) {
      return normalizeSkillProfile(record);
    }
    return normalizeSkillProfile({
      primaryProject: record.primaryProject || record.projectId,
      projectName: record.primaryProject || record.projectId
    });
  }

  function conversationMatchesSkillProfile(record, profile) {
    var requested = trim(profile).toLowerCase();
    if (!requested.length || requested === "all" || requested === "any") {
      return true;
    }
    if (requested === "nocode" && !hasExplicitSkillProfile(record)) {
      return normalizeSkillProfile({
        primaryProject: record && (record.primaryProject || record.projectId),
        projectName: record && (record.primaryProject || record.projectId)
      }) === "nocode";
    }
    return conversationSkillProfile(record) === requested;
  }

  function providerSearchList(value) {
    var provider = normalizeProviderSelector(value);
    if (provider === "all") {
      return ["codex", "vibe"];
    }
    return [provider];
  }

  function providerLabel(value) {
    var provider = normalizeProvider(value);
    if (provider === "codex") {
      return "Codex";
    }
    if (provider === "vibe") {
      return "Vibe";
    }
    return provider;
  }

  function defaultModelForProvider(provider) {
    return "";
  }

  function normalizeModel(provider, value) {
    var model = trim(value);
    var lower = model.toLowerCase();
    if (!model.length || lower === "default" || lower === "auto") {
      return defaultModelForProvider(provider);
    }
    return model;
  }

  function providerSettings(settings, provider) {
    settings = settings || {};
    var providers = settings.providers || [];
    var wanted = normalizeProvider(provider || (settings.defaults && settings.defaults.provider) || "");
    for (var i = 0; i < providers.length; i++) {
      if (normalizeProvider(providers[i] && providers[i].id) === wanted) {
        return providers[i];
      }
    }
    for (var j = 0; j < providers.length; j++) {
      if (providers[j] && providers[j].ready === true) {
        return providers[j];
      }
    }
    return providers.length ? providers[0] : null;
  }

  function modelSettings(providerDescriptor, model) {
    var models = providerDescriptor && providerDescriptor.models ? providerDescriptor.models : [];
    var wanted = trim(model);
    for (var i = 0; wanted.length && i < models.length; i++) {
      if (trim(models[i] && models[i].id) === wanted) {
        return models[i];
      }
    }
    return models.length ? models[0] : null;
  }

  function applyAgentSettingsDefaults(options, settings, provider) {
    options = options || {};
    settings = settings || {};
    var descriptor = providerSettings(settings, provider);
    var capabilityProfile = (settings && settings.agentProfile) || (descriptor && descriptor.agentProfile) || null;
    if (capabilityProfile && typeof capabilityProfile === "object" && trim(capabilityProfile.id).length) {
      options.agentCapabilityProfile = capabilityProfile;
      options.agentProfile = trim(options.agentProfile) || trim(capabilityProfile.id);
      options.skillProfile = trim(options.skillProfile) || trim(capabilityProfile.id);
    }
    var resolvedProvider = descriptor && descriptor.id ? normalizeProvider(descriptor.id) : normalizeProvider(provider || (settings.defaults && settings.defaults.provider));
    var model = trim(options.model || options.agentModel);
    if (!model.length || model.toLowerCase() === "default" || model.toLowerCase() === "auto") {
      model = trim((descriptor && descriptor.defaultModel) || (settings.defaults && settings.defaults.model) || "");
      if (!model.length) {
        var firstModel = modelSettings(descriptor, "");
        model = trim(firstModel && firstModel.id);
      }
      if (!model.length) {
        model = defaultModelForProvider(resolvedProvider || provider);
      }
      if (model.length) {
        options.model = model;
      }
    }
    var selectedModel = modelSettings(descriptor, trim(options.model || options.agentModel || model));
    var reasoning = trim(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort);
    if (!reasoning.length || reasoning.toLowerCase() === "default" || reasoning.toLowerCase() === "auto") {
      reasoning = trim((selectedModel && selectedModel.defaultReasoning) || (settings.defaults && settings.defaults.reasoning) || "");
      if (reasoning.length) {
        options.reasoningEffort = reasoning;
      }
    }
    if (resolvedProvider.length && (!trim(options.provider).length || normalizeProviderSelector(options.provider) === "all")) {
      options.provider = resolvedProvider;
    }
    return {
      provider: resolvedProvider,
      model: trim(options.model || options.agentModel),
      reasoningEffort: trim(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort)
    };
  }

  function normalizeReasoningEffort(value) {
    var effort = trim(value).toLowerCase();
    if (!effort.length || effort === "default" || effort === "auto") {
      return "";
    }
    if (effort === "very-high" || effort === "very_high" || effort === "extra-high" || effort === "extra_high") {
      return "xhigh";
    }
    return effort;
  }

  function agentsRoot(workspaceRoot, provider) {
    return new File(workspaceRoot, "agents/" + normalizeProvider(provider));
  }

  function userRoot(workspaceRoot, userKey, provider) {
    return new File(agentsRoot(workspaceRoot, provider), "users/" + safePathPart(userKey));
  }

  function conversationsRoot(workspaceRoot, userKey, provider) {
    return new File(userRoot(workspaceRoot, userKey, provider), "conversations");
  }

  function conversationDirectory(workspaceRoot, userKey, conversationId, provider) {
    return new File(conversationsRoot(workspaceRoot, userKey, provider), safePathPart(conversationId));
  }

  function homeLeafForProvider(provider) {
    return normalizeProvider(provider) === "codex" ? "codex-home" : "vibe-home";
  }

  function conversationRecordFile(dir) {
    return new File(dir, "conversation.json");
  }

  function conversationTranscriptFile(dir) {
    return new File(dir, "transcript.ndjson");
  }

  function conversationSummaryFile(dir) {
    return new File(dir, "summary.md");
  }

  function hasArrayValue(values, value) {
    var text = trim(value);
    if (!text.length || !values || typeof values.length === "undefined") {
      return false;
    }
    for (var i = 0; i < values.length; i++) {
      if (trim(values[i]) === text) {
        return true;
      }
    }
    return false;
  }

  function addArrayValue(values, value) {
    var out = values && typeof values.length !== "undefined" ? values : [];
    var text = trim(value);
    if (text.length && !hasArrayValue(out, text)) {
      out.push(text);
    }
    return out;
  }

  function readConversationRecord(workspaceRoot, userKey, conversationId, provider) {
    var file = conversationRecordFileFor(workspaceRoot, userKey, conversationId, provider);
    return file ? readJsonFile(file) : null;
  }

  function conversationRecordFileFor(workspaceRoot, userKey, conversationId, provider) {
    var providers = providerSearchList(provider);
    for (var i = 0; i < providers.length; i++) {
      var file = conversationRecordFile(conversationDirectory(workspaceRoot, userKey, conversationId, providers[i]));
      var record = readJsonFile(file);
      if (record && record.deleted !== true) {
        return file;
      }
    }
    return null;
  }

  function conversationTitleFromText(value) {
    var text = trim(value);
    if (!text.length) {
      return "";
    }
    text = text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#>*_\[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[-–—:\s]+|[-–—:\s]+$/g, "");
    if (isTechnicalConversationTitle(text)) {
      return "";
    }
    if (text.length > 76) {
      text = text.substring(0, 73).replace(/\s+\S*$/, "") + "...";
    }
    return text;
  }

  function isTechnicalConversationTitle(value) {
    var text = trim(value).toLowerCase();
    if (!text.length) {
      return true;
    }
    return text === "auto" ||
      text === "default" ||
      text === "untitled" ||
      text === "new conversation" ||
      text === "conversation" ||
      text === "session";
  }

  function conversationTitleFromTranscriptFile(file) {
    try {
      if (!file || !file.exists()) {
        return "";
      }
      var lines = readTextFile(file).split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = trim(lines[i]);
        if (!line.length) {
          continue;
        }
        try {
          var item = JSON.parse(line);
          if (trim(item.role).toLowerCase() === "user") {
            var title = conversationTitleFromText(extractUserMessage(item.content));
            if (title.length) {
              return title;
            }
          }
        } catch (_ignoreTranscriptTitleLine) {}
      }
    } catch (_ignoreTranscriptTitle) {}
    return "";
  }

  function conversationHasUserPrompt(record) {
    if (!record || record.deleted === true) {
      return false;
    }
    if (conversationTitleFromText(record.lastUserMessage).length) {
      return true;
    }
    try {
      var dir = record.conversationDir ? new File(String(record.conversationDir)) : null;
      if (dir !== null && conversationTitleFromTranscriptFile(conversationTranscriptFile(dir)).length) {
        return true;
      }
    } catch (_ignorePromptCheck) {}
    return false;
  }

  function markEmptyConversationDeleted(record) {
    try {
      if (!record || record.deleted === true || !record.conversationDir) {
        return;
      }
      var file = conversationRecordFile(new File(String(record.conversationDir)));
      var stored = readJsonFile(file) || record;
      stored.deleted = true;
      stored.status = "deleted";
      stored.deletedReason = "empty_prompt";
      stored.updatedAt = java.lang.System.currentTimeMillis();
      writeJsonFile(file, stored);
    } catch (_ignoreEmptyConversationCleanup) {}
  }

  function codexHomeForRecord(record) {
    var explicitHome = sanitizeCodexHome(record && record.codexHome);
    if (explicitHome.length) {
      return explicitHome;
    }
    var workspaceRoot = trim(record && record.workspaceRoot);
    if (!workspaceRoot.length) {
      return "";
    }
    return filePath(new File(new File(new File(new File(workspaceRoot, "agents/codex"), "homes/users"), safePathPart(record.userKey || "studio")), "codex-home"));
  }

  function codexSessionIdFromFileName(name) {
    var match = String(name || "").match(/rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    return match ? match[1] : "";
  }

  function codexSessionSummaryFromFile(file, conversationId) {
    var summary = {
      sessionId: "",
      title: "",
      conversationMatch: false
    };
    try {
      if (!file || !file.exists()) {
        return summary;
      }
      summary.sessionId = codexSessionIdFromFileName(file.getName());
      var text = readTextFile(file);
      var conversationMarker = trim(conversationId).length ? "Assistant conversation/thread id: " + trim(conversationId) : "";
      summary.conversationMatch = conversationMarker.length && text.indexOf(conversationMarker) !== -1;
      var lines = text.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = trim(lines[i]);
        if (!line.length) {
          continue;
        }
        try {
          var item = JSON.parse(line);
          var type = trim(item.type);
          var payload = item.payload || {};
          if (type === "session_meta") {
            summary.sessionId = trim(payload.id || payload.session_id || payload.sessionId || summary.sessionId);
          }
          if (!summary.title.length) {
            var title = conversationTitleFromText(payload.title || payload.name || payload.summary);
            if (title.length) {
              summary.title = title;
            }
          }
          if (!summary.title.length && type === "event_msg" && trim(payload.type) === "user_message") {
            var message = String(payload.message || "");
            var marker = "\nUser message:\n";
            var markerIndex = message.lastIndexOf(marker);
            if (markerIndex !== -1) {
              message = message.substring(markerIndex + marker.length);
            }
            var title = conversationTitleFromText(message);
            if (title.length) {
              summary.title = title;
            }
          }
        } catch (_ignoreCodexSessionLine) {}
      }
    } catch (_ignoreCodexSessionTitle) {}
    return summary;
  }

  function codexSessionTitleFromFile(file) {
    return codexSessionSummaryFromFile(file, "").title;
  }

  function conversationRecoveryTitleForRecord(record) {
    var title = conversationTitleFromText(record && record.title);
    if (title.length) {
      return title;
    }
    try {
      var dir = record && record.conversationDir ? new File(String(record.conversationDir)) : null;
      if (dir !== null) {
        title = conversationTitleFromTranscriptFile(conversationTranscriptFile(dir));
        if (title.length) {
          return title;
        }
      }
    } catch (_ignoreConversationRecoveryTitle) {}
    return conversationTitleFromText(record && record.lastUserMessage);
  }

  function recoverCodexExternalSessionId(record, currentSessionId) {
    currentSessionId = trim(currentSessionId);
    if (normalizeProvider(record && record.provider) !== "codex") {
      return currentSessionId;
    }
    var targetTitle = conversationRecoveryTitleForRecord(record);
    var codexHome = codexHomeForRecord(record);
    if (!codexHome.length) {
      return currentSessionId;
    }
    try {
      var root = new File(codexHome, "sessions");
      if (!root.exists()) {
        return currentSessionId;
      }
      var conversationId = trim(record.conversationId || record.threadid);
      var createdAt = Number(record.createdAt || 0);
      var bestSessionId = "";
      var bestScore = 0;
      var bestDistance = 9007199254740991;
      var stack = [root];
      while (stack.length) {
        var current = stack.pop();
        var children = current && current.exists() ? current.listFiles() : null;
        if (children === null) {
          continue;
        }
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.isDirectory()) {
            stack.push(child);
            continue;
          }
          var name = String(child.getName() || "");
          if (name.indexOf("rollout-") !== 0 || name.lastIndexOf(".jsonl") !== name.length - 6) {
            continue;
          }
          var summary = codexSessionSummaryFromFile(child, conversationId);
          if (!summary.sessionId.length) {
            continue;
          }
          var titleMatches = targetTitle.length && summary.title === targetTitle;
          if (summary.sessionId === currentSessionId && titleMatches) {
            return currentSessionId;
          }
          var score = titleMatches && summary.conversationMatch ? 3 : titleMatches ? 2 : (!currentSessionId.length && summary.conversationMatch ? 1 : 0);
          if (score <= 0) {
            continue;
          }
          var distance = createdAt > 0 ? Math.abs(Number(child.lastModified()) - createdAt) : 0;
          if (score > bestScore || (score === bestScore && distance < bestDistance)) {
            bestScore = score;
            bestDistance = distance;
            bestSessionId = summary.sessionId;
          }
        }
      }
      if (bestScore >= 2 || (!currentSessionId.length && bestScore > 0)) {
        return bestSessionId;
      }
    } catch (_ignoreCodexSessionRecovery) {}
    return currentSessionId;
  }

  function codexSessionTitleForRecord(record) {
    if (normalizeProvider(record && record.provider) !== "codex") {
      return "";
    }
    var sessionId = trim(record.externalSessionId);
    if (!sessionId.length) {
      return "";
    }
    var codexHome = codexHomeForRecord(record);
    if (!codexHome.length) {
      return "";
    }
    try {
      var root = new File(codexHome, "sessions");
      if (!root.exists()) {
        return "";
      }
      var stack = [root];
      while (stack.length) {
        var current = stack.pop();
        var children = current && current.exists() ? current.listFiles() : null;
        if (children === null) {
          continue;
        }
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.isDirectory()) {
            stack.push(child);
          } else {
            var name = String(child.getName() || "");
            if (name.indexOf(sessionId) !== -1 && name.indexOf("rollout-") === 0 && name.lastIndexOf(".jsonl") === name.length - 6) {
              var title = codexSessionTitleFromFile(child);
              if (title.length) {
                return title;
              }
            }
          }
        }
      }
    } catch (_ignoreCodexSessionLookup) {}
    return "";
  }

  function conversationTitleForRecord(record) {
    var title = conversationTitleFromText(record && record.title);
    if (title.length) {
      return title;
    }
    try {
      var dir = record && record.conversationDir ? new File(String(record.conversationDir)) : null;
      if (dir !== null) {
        title = conversationTitleFromTranscriptFile(conversationTranscriptFile(dir));
        if (title.length) {
          return title;
        }
      }
    } catch (_ignoreRecordTranscriptTitle) {}
    title = conversationTitleFromText(record && record.lastUserMessage);
    if (title.length) {
      return title;
    }
    title = conversationTitleFromText(record && record.lastAnswerPreview);
    if (title.length) {
      return title;
    }
    title = codexSessionTitleForRecord(record || {});
    return title.length ? title : "Conversation";
  }

  function publicConversation(record) {
    record = record || {};
    var provider = normalizeProvider(record.provider);
    return {
      conversationId: String(record.conversationId || record.threadid || ""),
      title: conversationTitleForRecord(record || {}),
      provider: String(record.provider || "vibe"),
      userKey: String(record.userKey || "studio"),
      agentProfile: String(record.agentProfile || record.skillProfile || ""),
      skillProfile: conversationSkillProfile(record),
      assistantContext: String(record.assistantContext || ""),
      assistantSurface: String(record.assistantSurface || ""),
      status: String(record.status || ""),
      primaryProject: String(record.primaryProject || record.projectId || ""),
      projectNames: record.projectNames || [],
      createdAt: Number(record.createdAt || 0),
      updatedAt: Number(record.updatedAt || 0),
      lastCursor: Number(record.lastCursor || 0),
      lastRunId: String(record.lastRunId || ""),
      lastAnswerPreview: String(record.lastAnswerPreview || ""),
      progress: String(record.progress || ""),
      progressEvents: record.progressEvents || [],
      phase: String(record.phase || ""),
      model: String(record.model || ""),
      reasoningEffort: String(record.reasoningEffort || ""),
      serviceTier: String(record.serviceTier || ""),
      warnings: record.warnings || [],
      vibeHome: provider === "codex" ? "" : String(record.vibeHome || ""),
      agentHome: provider === "codex" ? "" : String(record.agentHome || record.vibeHome || ""),
      codexHome: provider === "codex" ? sanitizeCodexHome(record.codexHome) : "",
      externalSessionId: String(record.externalSessionId || "")
    };
  }

  function conversationActivityScore(record) {
    if (!record || record.deleted === true) {
      return 0;
    }
    var status = trim(record.status).toLowerCase();
    if (status === "in_progress" || status === "running" || status === "starting" || status === "queued") {
      return 4;
    }
    if (trim(record.lastRunId).length || trim(record.lastAnswerPreview).length || trim(record.progress).length) {
      return 3;
    }
    if (status === "completed" || status === "failed" || status === "cancelled" || status === "closed") {
      return 2;
    }
    return 1;
  }

  function conversationRecords(workspaceRoot, userKey, projectFilter, includeDeleted, provider, skillProfile) {
    var records = [];
    var filter = trim(projectFilter);
    var effectiveSkillProfile = userKey === "studio" ? "all" : skillProfile;
    var providers = providerSearchList(provider);
    for (var p = 0; p < providers.length; p++) {
      var providerFilter = providers[p];
      var root = conversationsRoot(workspaceRoot, userKey, providerFilter);
      var children = root.exists() ? root.listFiles() : null;
      if (children === null) {
        continue;
      }
      for (var i = 0; i < children.length; i++) {
        var dir = children[i];
        if (!dir || !dir.isDirectory()) {
          continue;
        }
        var record = readJsonFile(conversationRecordFile(dir));
        if (!record || (record.deleted === true && includeDeleted !== true)) {
          continue;
        }
        if (normalizeProvider(record.provider || providerFilter) !== providerFilter) {
          continue;
        }
        if (filter.length) {
          var names = record.projectNames || [];
          if (trim(record.primaryProject || record.projectId) !== filter && !hasArrayValue(names, filter)) {
            continue;
          }
        }
        if (!conversationMatchesSkillProfile(record, effectiveSkillProfile)) {
          continue;
        }
        if (!conversationHasUserPrompt(record)) {
          if (includeDeleted !== true) {
            markEmptyConversationDeleted(record);
          }
          continue;
        }
        records.push(record);
      }
    }
    records.sort(function (a, b) {
      var score = conversationActivityScore(b) - conversationActivityScore(a);
      if (score !== 0) {
        return score;
      }
      var updated = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      if (updated !== 0) {
        return updated;
      }
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
    return records;
  }

  function publicConversations(workspaceRoot, userKey, projectFilter, includeDeleted, provider, skillProfile) {
    var records = conversationRecords(workspaceRoot, userKey, projectFilter, includeDeleted, provider, skillProfile);
    var conversations = [];
    for (var i = 0; i < records.length; i++) {
      conversations.push(publicConversation(records[i]));
    }
    return conversations;
  }

  function latestConversationRecord(workspaceRoot, userKey, projectFilter, provider, skillProfile) {
    var records = conversationRecords(workspaceRoot, userKey, projectFilter, false, provider, skillProfile);
    for (var i = 0; i < records.length; i++) {
      if (conversationActivityScore(records[i]) > 1) {
        return records[i];
      }
    }
    return records.length ? records[0] : null;
  }

  function latestActiveConversationRecord(workspaceRoot, userKey, projectFilter, provider, skillProfile) {
    var records = conversationRecords(workspaceRoot, userKey, projectFilter, false, provider, skillProfile);
    for (var i = 0; i < records.length; i++) {
      var status = trim(records[i] && records[i].status).toLowerCase();
      if (status === "starting" || status === "queued" || status === "running" || status === "in_progress") {
        return records[i];
      }
    }
    return null;
  }

  function writeConversationRecord(state) {
    if (!state || !state.conversationFile) {
      return;
    }
    var provider = normalizeProvider(state.provider);
    var previous = readJsonFile(new File(state.conversationFile)) || {};
    var lastUserMessage = trim(state.userQuestion || previous.lastUserMessage || "");
    var title = conversationTitleFromText(state.title) || conversationTitleFromText(lastUserMessage) || trim(previous.title);
    var answer = state.answerIsFinal === true || state.status === "completed" || state.status === "closed" ? String(state.answer || "") : "";
    var record = {
      version: 1,
      conversationId: state.conversationId || state.threadid,
      threadid: state.threadid,
      provider: state.provider || "vibe",
      userKey: state.userKey || "studio",
      userId: state.userId || "",
      agentProfile: state.agentProfile || state.skillProfile || "",
      skillProfile: normalizeSkillProfile(state),
      assistantContext: state.assistantContext || "",
      assistantSurface: state.assistantSurface || "",
      language: state.language || "",
      handle: state.handle || state.threadid,
      status: state.status || "created",
      title: title,
      lastUserMessage: lastUserMessage,
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      serviceTier: state.serviceTier || "",
      primaryProject: state.primaryProject || state.projectId || "",
      projectNames: state.projectNames || [],
      workspaceRoot: state.workspaceRoot || "",
      cwd: state.cwd || "",
      vibeHome: provider === "codex" ? "" : state.vibeHome || "",
      agentHome: provider === "codex" ? "" : state.agentHome || state.vibeHome || "",
      codexHome: provider === "codex" ? sanitizeCodexHome(state.codexHome) : "",
      conversationDir: state.conversationDir || "",
      externalSessionId: state.externalSessionId || "",
      createdAt: Number(state.createdAt || now()),
      updatedAt: Number(state.updatedAt || now()),
      lastCursor: Number(state.cursor || 0),
      lastRunId: String(state.runid || ""),
      lastAnswerPreview: answer.length > 500 ? answer.substring(0, 500) : answer,
      progress: String(state.progressLog || ""),
      progressEvents: state.progressEvents || [],
      phase: String(state.lastStatusText || ""),
      warnings: state.warnings || [],
      deleted: state.status === "deleted" || state.deleted === true
    };
    writeJsonFile(new File(state.conversationFile), record);
  }

  function appendTranscript(state, role, content) {
    var text = trim(content);
    if (!text.length || !state || !state.transcriptFile) {
      return;
    }
    appendTextFile(new File(state.transcriptFile), JSON.stringify({
      time: now(),
      role: role,
      runid: state.runid || "",
      content: text
    }) + "\n");
  }

  function latestTranscriptContent(state, role, runid) {
    if (!state || !state.transcriptFile) {
      return "";
    }
    var file = new File(state.transcriptFile);
    if (!file.exists()) {
      return "";
    }
    var wantedRole = trim(role).toLowerCase();
    var wantedRunid = String(runid || "");
    var lines = readTextFile(file).split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = trim(lines[i]);
      if (!line.length) {
        continue;
      }
      try {
        var item = JSON.parse(line);
        if (trim(item.role).toLowerCase() !== wantedRole) {
          continue;
        }
        if (wantedRunid.length && String(item.runid || "") !== wantedRunid) {
          continue;
        }
        return trim(item.content);
      } catch (_ignoreTranscriptContent) {}
    }
    return "";
  }

  function isTerminalStatus(status) {
    status = String(status || "");
    return status === "completed" || status === "failed" || status === "cancelled" || status === "closed" || status === "deleted" || status === "setup_required";
  }

  function refreshTerminalStateFromRecord(state) {
    if (!state || !state.conversationFile || !isTerminalStatus(state.status)) {
      return state;
    }
    var record = readJsonFile(new File(state.conversationFile));
    if (!record || record.deleted === true) {
      return state;
    }
    var recordUpdatedAt = Number(record.updatedAt || 0);
    var stateUpdatedAt = Number(state.updatedAt || 0);
    var recordIsNewer = recordUpdatedAt && (!stateUpdatedAt || recordUpdatedAt >= stateUpdatedAt);
    if (recordIsNewer) {
      state.status = String(record.status || state.status || "");
      state.model = String(record.model || state.model || "");
      state.reasoningEffort = String(record.reasoningEffort || state.reasoningEffort || "");
      state.serviceTier = String(record.serviceTier || state.serviceTier || "");
      state.cursor = Number(record.lastCursor || state.cursor || 0);
      state.runid = String(record.lastRunId || state.runid || "");
      if (Object.prototype.hasOwnProperty.call(record, "externalSessionId")) {
        state.externalSessionId = String(record.externalSessionId || "");
      } else {
        state.externalSessionId = String(state.externalSessionId || "");
      }
      state.progressLog = String(record.progress || "");
      state.progressEvents = record.progressEvents || [];
      state.lastStatusText = String(record.phase || "");
      state.warnings = record.warnings || [];
      state.updatedAt = recordUpdatedAt;
    }
    var answer = latestTranscriptContent(state, "assistant", record.lastRunId || state.runid);
    if (answer.length) {
      state.answer = answer;
      state.answerIsFinal = true;
    } else if (recordIsNewer || !trim(state.answer).length) {
      state.answer = String(record.lastAnswerPreview || "");
      state.answerIsFinal = trim(state.answer).length > 0;
    }
    return state;
  }

  function transcriptTime(value) {
    var time = Number(value || 0);
    if (!time || isNaN(time)) {
      return "";
    }
    var date = new Date(time);
    var hh = ("0" + date.getHours()).slice(-2);
    var mm = ("0" + date.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }

  function transcriptMessages(state, limit) {
    if (!state || !state.transcriptFile) {
      return [];
    }
    var file = new File(state.transcriptFile);
    if (!file.exists()) {
      return [];
    }
    var lines = readTextFile(file).split(/\r?\n/);
    var messages = [];
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line.length) {
        continue;
      }
      try {
        var item = JSON.parse(line);
        var role = trim(item.role).toLowerCase();
        var content = trim(item.content);
        if (!content.length || (role !== "user" && role !== "assistant")) {
          continue;
        }
        if (role === "assistant" && String(item.runid || "") === String(state.runid || "") && state.status === "completed" && answerLooksIncomplete(state, content)) {
          content = incompleteFinalAnswer(state);
        }
        var message = {
          type: role,
          msg: content,
          author: role === "user" ? "You" : "Assistant",
          time: transcriptTime(item.time),
          id: item.runid || i
        };
        if (role === "assistant") {
          message.tag1 = "History";
          message.tag2 = providerLabel(state.provider);
          message.tag3 = "Resume";
          message.writing = false;
          message.status = "";
        }
        messages.push(message);
      } catch (_ignoreTranscriptLine) {}
    }
    var max = intValue(limit, 200, 1, 1000);
    if (messages.length > max) {
      return messages.slice(messages.length - max);
    }
    return messages;
  }

  function stateKey(threadid) {
    return STATE_PREFIX + threadid;
  }

  function cancelKey(threadid) {
    return stateKey(threadid) + ":cancel";
  }

  function markCancellationRequested(threadid) {
    var id = normalizeThreadId(threadid);
    if (!id.length) {
      return;
    }
    var value = String(now());
    try {
      context.httpSession.setAttribute(cancelKey(id), value);
    } catch (_ignoreSessionCancel) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.set) {
        storage.set(cancelKey(id), value);
      }
    } catch (_ignoreServerCancel) {}
  }

  function clearCancellationRequested(threadid) {
    var id = normalizeThreadId(threadid);
    if (!id.length) {
      return;
    }
    try {
      context.httpSession.removeAttribute(cancelKey(id));
    } catch (_ignoreSessionCancelClear) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.remove) {
        storage.remove(cancelKey(id));
      } else if (storage !== null && storage.set) {
        storage.set(cancelKey(id), "");
      }
    } catch (_ignoreServerCancelClear) {}
  }

  function cancellationRequested(threadid) {
    var id = normalizeThreadId(threadid);
    if (!id.length) {
      return false;
    }
    try {
      var raw = context.httpSession.getAttribute(cancelKey(id));
      if (raw !== null && typeof raw !== "undefined" && trim(raw).length) {
        return true;
      }
    } catch (_ignoreReadSessionCancel) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.get) {
        var value = storage.get(cancelKey(id));
        return value !== null && typeof value !== "undefined" && trim(value).length > 0;
      }
    } catch (_ignoreReadServerCancel) {}
    return false;
  }

  function cancelledRunResponse(state) {
    state.status = "cancelled";
    state.error = "";
    state.answer = lang(state).closedEarly;
    state.answerIsFinal = true;
    appendProgress(state, lang(state).closedEarly);
    state.updatedAt = now();
    saveState(state);
    setStateBuffer(state);
    return {
      ok: false,
      id: state.runid || makeRunId("cancelled"),
      object: "agent.run",
      status: "cancelled",
      threadid: state.threadid,
      state: publicState(state),
      AIData: responseForState(state).AIData
    };
  }

  function readState(threadid) {
    var raw;
    try {
      raw = context.httpSession.getAttribute(stateKey(threadid));
      if (raw !== null && typeof raw !== "undefined") {
        if (typeof raw === "string") {
          return sanitizeProgressLog(JSON.parse(String(raw)));
        }
        return sanitizeProgressLog(JSON.parse(String(raw)));
      }
    } catch (_ignoreReadState) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.get) {
        raw = storage.get(stateKey(threadid));
        if (raw !== null && typeof raw !== "undefined" && trim(raw).length) {
          return sanitizeProgressLog(JSON.parse(String(raw)));
        }
      }
    } catch (_ignoreReadServerState) {}
    return null;
  }

  function saveState(state) {
    var raw = JSON.stringify(state);
    context.httpSession.setAttribute(stateKey(state.threadid), raw);
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.set) {
        storage.set(stateKey(state.threadid), raw);
      }
    } catch (_ignoreSaveServerState) {}
    try {
      writeConversationRecord(state);
    } catch (_ignoreWriteConversationRecord) {}
  }

  function removeState(threadid) {
    try {
      context.httpSession.removeAttribute(stateKey(threadid));
    } catch (_ignoreRemoveState) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.remove) {
        storage.remove(stateKey(threadid));
      } else if (storage !== null && storage.set) {
        storage.set(stateKey(threadid), "");
      }
    } catch (_ignoreRemoveServerState) {}
  }

  function sharedStorage() {
    if (typeof server !== "undefined" && server !== null) {
      return server;
    }
    try {
      if (context && context.server) {
        return context.server;
      }
    } catch (_ignoreContextServer) {}
    return null;
  }

  function setBuffer(content, status, details) {
    var text = String(content || "");
    var buffer = {
      size: text.length,
      content: text,
      status: status || ""
    };
    details = details || {};
    for (var key in details) {
      if (Object.prototype.hasOwnProperty.call(details, key)) {
        buffer[key] = details[key];
      }
    }
    context.httpSession.setAttribute(BUFFER_KEY, buffer);
  }

  function extractUserMessage(prompt) {
    var text = String(prompt || "");
    var marker = "\nUser message:";
    var index = text.lastIndexOf(marker);
    if (index !== -1) {
      return trim(text.substring(index + marker.length).replace(/^\r?\n/, ""));
    }
    return trim(text);
  }

  function detectLanguage(text) {
    var sample = (" " + String(text || "").toLowerCase() + " ");
    if (/[\u00e0\u00e2\u00e4\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00ff\u0153]/.test(sample)) {
      return "fr";
    }
    sample = sample.replace(/[’']/g, " ");
    var frenchHits = 0;
    var words = [" je ", " j ", " tu ", " il ", " elle ", " nous ", " vous ", " les ", " des ", " une ", " pour ", " avec ", " dans ", " sur ", " le ", " la ", " l ", " de ", " d ", " du ", " au ", " aux ", " mes ", " ton ", " ta ", " tes ", " peux ", " peut ", " faut ", " test ", " teste ", " projet ", " projets ", " liste ", " lister ", " affiche ", " afficher ", " montre ", " montrer ", " application ", " corrige ", " corriger ", " fonctionne ", " ajoute ", " ajouter ", " rajoute ", " rajouter ", " permet ", " ville ", " villes ", " colonne ", " colonnes ", " tri ", " fuseau ", " encore ", " fois ", " bouton ", " boutons ", " appuie ", " appuis ", " appuyer ", " clique ", " cliquer "];
    for (var i = 0; i < words.length; i++) {
      if (sample.indexOf(words[i]) !== -1) {
        frenchHits++;
      }
    }
    return frenchHits >= 2 ? "fr" : "en";
  }

  var TRANSLATIONS = {
    fr: {
      starting: "J'analyse la demande.",
      thinking: "J'analyse la demande.",
      projectList: "J'utilise le MCP Convertigo pour lister les projets.",
      inspect: "J'utilise le MCP Convertigo pour inspecter le projet.",
      apply: "J'utilise le MCP Convertigo pour appliquer une modification.",
      rename: "J'utilise le MCP Convertigo pour renommer un objet.",
      save: "J'utilise le MCP Convertigo pour sauvegarder le projet.",
      execute: "J'utilise le MCP Convertigo pour tester une séquence ou une transaction.",
      logs: "J'utilise le MCP Convertigo pour consulter les logs.",
      builder: "J'utilise le MCP Convertigo pour vérifier l'application.",
      palette: "J'utilise le MCP Convertigo pour lire la palette.",
      shell: "J'exécute une commande locale.",
      tool: "J'utilise le MCP Convertigo.",
      mcpResult: "Résultat MCP : ",
      toolRetry: "Une tentative d'outil a \u00e9chou\u00e9, je cherche une autre piste.",
      closedAfterAnswer: "La r\u00e9ponse est termin\u00e9e.",
      closedEarly: "Le traitement s'est arr\u00eat\u00e9 avant d'avoir termin\u00e9.",
      completedNoAnswer: "Le traitement est termin\u00e9, mais aucun r\u00e9sum\u00e9 final d\u00e9taill\u00e9 n'a \u00e9t\u00e9 transmis.",
      completedIncomplete: "Le traitement est termin\u00e9, mais la r\u00e9ponse finale est incompl\u00e8te.",
      lastObservedAction: "Derni\u00e8re action observ\u00e9e : ",
      observedSteps: "\u00c9tapes observ\u00e9es :",
      toolWarning: "Une tentative d'outil a \u00e9chou\u00e9 pendant le traitement.",
      bridgeReadError: "Je n'arrive pas \u00e0 lire le retour du traitement.",
      bridgeStateRecover: "Je v\u00e9rifie que le traitement est toujours en cours.",
      bridgeProcessLost: "La t\u00e2che a \u00e9t\u00e9 interrompue. Vous pouvez relancer une demande dans cette conversation.",
      codexAuthExpired: "L'authentification Codex du profil local a expiré. Le bridge a resynchronisé les identifiants disponibles, mais ils ne permettent pas d'ouvrir une session. Ouvrez Codex Desktop ou lancez `codex login`, puis renvoyez la demande.",
      startFailed: "Je n'ai pas pu d\u00e9marrer le traitement.",
      setupRequired: "L'environnement local n'est pas encore pr\u00eat.",
      setupCanInstall: "Vous pouvez lancer l'installation locale depuis le diagnostic de l'agent, puis renvoyer votre demande.",
      setupReady: "L'environnement local est pr\u00eat.",
      agentPreparing: "Je pr\u00e9pare l'agent local. Si le runtime n'est pas encore install\u00e9, l'installation peut prendre plusieurs minutes."
    },
    en: {
      starting: "I am analyzing the request.",
      thinking: "I am analyzing the request.",
      projectList: "I am using the Convertigo MCP to list projects.",
      inspect: "I am using the Convertigo MCP to inspect the project.",
      apply: "I am using the Convertigo MCP to apply a change.",
      rename: "I am using the Convertigo MCP to rename an object.",
      save: "I am using the Convertigo MCP to save the project.",
      execute: "I am using the Convertigo MCP to test a sequence or transaction.",
      logs: "I am using the Convertigo MCP to read logs.",
      builder: "I am using the Convertigo MCP to verify the app.",
      palette: "I am using the Convertigo MCP to read the palette.",
      shell: "I am running a local command.",
      tool: "I am using the Convertigo MCP.",
      mcpResult: "MCP result: ",
      toolRetry: "A tool attempt failed, I am trying another path.",
      closedAfterAnswer: "The response is complete.",
      closedEarly: "The task stopped before completion.",
      completedNoAnswer: "The task is complete, but no detailed final summary was sent.",
      completedIncomplete: "The task is complete, but the final answer is incomplete.",
      lastObservedAction: "Last observed action: ",
      observedSteps: "Observed steps:",
      toolWarning: "A tool attempt failed during processing.",
      bridgeReadError: "I cannot read the current response.",
      bridgeStateRecover: "I am checking that the task is still running.",
      bridgeProcessLost: "The task was interrupted. You can send a new request in this conversation.",
      codexAuthExpired: "The local Codex profile authentication has expired. The bridge synchronized the available credentials, but they cannot open a session. Open Codex Desktop or run `codex login`, then send the request again.",
      startFailed: "I could not start the task.",
      setupRequired: "The local environment is not ready yet.",
      setupCanInstall: "You can start the local installation from the agent diagnostic, then send your request again.",
      setupReady: "The local environment is ready.",
      agentPreparing: "I am preparing the local agent. If the runtime is not installed yet, installation can take several minutes."
    }
  };

  function lang(state) {
    var code = state && state.language === "fr" ? "fr" : "en";
    return TRANSLATIONS[code];
  }

  function extractAgentErrorText(value, depth) {
    if (depth > 8 || value === null || typeof value === "undefined") {
      return "";
    }
    if (typeof value === "string") {
      var text = trim(value);
      if (!text.length) {
        return "";
      }
      if ((text.indexOf("{") === 0 && text.lastIndexOf("}") === text.length - 1) || (text.indexOf("[") === 0 && text.lastIndexOf("]") === text.length - 1)) {
        try {
          return extractAgentErrorText(JSON.parse(text), depth + 1) || text;
        } catch (_ignoreErrorJson) {}
      }
      return text;
    }
    if (typeof value === "object") {
      var message = extractAgentErrorText(value.message, depth + 1);
      if (message.length) {
        return message;
      }
      var nestedError = extractAgentErrorText(value.error, depth + 1);
      if (nestedError.length) {
        return nestedError;
      }
      var nestedDetails = extractAgentErrorText(value.details || value.detail || value.cause, depth + 1);
      if (nestedDetails.length) {
        return nestedDetails;
      }
      try {
        return trim(JSON.stringify(value));
      } catch (_ignoreErrorStringify) {}
    }
    return trim(value);
  }

  function userFacingAgentError(state, data) {
    var raw = extractAgentErrorText(data, 0);
    var lower = raw.toLowerCase();
    if (lower.indexOf("refresh token") !== -1 || lower.indexOf("access token could not be refreshed") !== -1 || lower.indexOf("please log out and sign in again") !== -1) {
      return lang(state).codexAuthExpired;
    }
    if (raw.length) {
      return raw;
    }
    return lang(state).bridgeReadError;
  }

  function isCodexAuthenticationError(data) {
    var lower = extractAgentErrorText(data, 0).toLowerCase();
    return lower.indexOf("refresh token") !== -1 ||
      lower.indexOf("access token could not be refreshed") !== -1 ||
      lower.indexOf("please log out and sign in again") !== -1 ||
      lower.indexOf("authentication is required before start") !== -1;
  }

  function progressLineLooksLikeAgentLifecycle(value) {
    var text = compactLine(String(value || "")).toLowerCase();
    return text === "je prepare l'agent local." ||
      text === "je pr\u00e9pare l'agent local." ||
      text === "i am preparing the local agent." ||
      text === "agent local pr\u00eat." ||
      text === "l'agent local est pr\u00eat." ||
      text === "the local agent is ready.";
  }

  function normalizeProgressLine(state, value) {
    if (progressLineLooksLikeAgentLifecycle(value)) {
      return lang(state).thinking;
    }
    var text = String(value || "");
    var compact = compactLine(text).toLowerCase();
    if (compact === "i am analyzing the request." || compact === "i am analyzing the request") {
      return lang(state).thinking;
    }
    if (compact === "i am using the convertigo mcp to verify the app." || compact === "i am using the convertigo mcp to verify the app") {
      return lang(state).builder;
    }
    if (compact === "i am using the convertigo mcp." || compact === "i am using the convertigo mcp") {
      return lang(state).tool;
    }
    return text;
  }

  function progressTextForTool(state, title) {
    var text = String(title || "").toLowerCase();
    var t = lang(state);
    if (text.indexOf("exec_command") !== -1 ||
        text.indexOf("commande shell") !== -1 ||
        text.indexOf("shell command") !== -1 ||
        text.indexOf("lecture de fichier") !== -1 ||
        text.indexOf("read file") !== -1 ||
        text.indexOf("recherche dans les fichiers") !== -1 ||
        text.indexOf("search files") !== -1 ||
        text.indexOf("liste de fichiers") !== -1 ||
        text.indexOf("list files") !== -1 ||
        text.indexOf("vérification devtools") !== -1 ||
        text.indexOf("devtools check") !== -1 ||
        text.indexOf("vérification environnement") !== -1 ||
        text.indexOf("environment check") !== -1 ||
        text.indexOf("commande powershell") !== -1 ||
        text.indexOf("powershell command") !== -1 ||
        text.indexOf("contrôle ui local") !== -1 ||
        text.indexOf("controle ui local") !== -1 ||
        text.indexOf("local ui control") !== -1) {
      return t.shell;
    }
    if (text.indexOf("project-list") !== -1) {
      return t.projectList;
    }
    if (text.indexOf("databaseobject-tree-get") !== -1 || text.indexOf("databaseobject-search") !== -1) {
      return t.inspect;
    }
    if (text.indexOf("databaseobject-tree-apply") !== -1) {
      return t.apply;
    }
    if (text.indexOf("databaseobject-rename") !== -1) {
      return t.rename;
    }
    if (text.indexOf("project-save") !== -1) {
      return t.save;
    }
    if (text.indexOf("requestable-execute") !== -1 || text.indexOf("crud-proof") !== -1) {
      return t.execute;
    }
    if (text.indexOf("log-view") !== -1) {
      return t.logs;
    }
    if (text.indexOf("mobile-builder-open") !== -1) {
      return t.builder;
    }
    if (text.indexOf("palette-list") !== -1 || text.indexOf("palette-describe") !== -1) {
      return t.palette;
    }
    return t.tool;
  }

  function looksLikeShellCommand(value) {
    var text = trim(String(value || ""));
    if (!text.length) {
      return false;
    }
    if (text.charAt(text.length - 1) === ".") {
      text = trim(text.substring(0, text.length - 1));
    }
    var lower = text.toLowerCase();
    return lower.indexOf("/bin/") === 0 ||
      lower.indexOf("zsh -lc ") === 0 ||
      lower.indexOf("bash -lc ") === 0 ||
      lower.indexOf("sh -c ") === 0 ||
      lower.indexOf("powershell ") === 0 ||
      lower.indexOf("powershell.exe ") === 0 ||
      lower.indexOf("pwsh ") === 0 ||
      lower.indexOf("pwsh.exe ") === 0 ||
      lower.indexOf("\"c:\\program files\\powershell\\") === 0 ||
      lower.indexOf("sed ") === 0 ||
      lower.indexOf("rg ") === 0 ||
      lower.indexOf("grep ") === 0 ||
      lower.indexOf("curl ") === 0 ||
      lower.indexOf("node ") === 0 ||
      lower.indexOf("python ") === 0 ||
      lower.indexOf("python3 ") === 0 ||
      lower.indexOf("npm ") === 0 ||
      lower.indexOf("npx ") === 0 ||
      lower.indexOf("commande exécutée") === 0 ||
      lower.indexOf("command executed") === 0;
  }

  function shellCommandTitle(state, value) {
    var text = trim(String(value || "")).toLowerCase();
    var french = state && state.language === "fr";
    if (text.indexOf("uiautomation") !== -1 || text.indexOf("automationelement") !== -1) {
      return french ? "Contrôle UI local" : "Local UI control";
    }
    if (text.indexOf("powershell") !== -1 || text.indexOf("pwsh") !== -1) {
      return french ? "Commande PowerShell" : "PowerShell command";
    }
    if (text.indexOf("chrome-remote-interface") !== -1 || text.indexOf("devtools") !== -1 || text.indexOf("/json") !== -1) {
      return french ? "Vérification DevTools" : "DevTools check";
    }
    if (text.indexOf("python3 ") !== -1 || text.indexOf("require('") !== -1 || text.indexOf("require(\\\"") !== -1) {
      return french ? "Vérification environnement" : "Environment check";
    }
    if (text.indexOf("sed ") !== -1 || text.indexOf("sed -n ") !== -1) {
      return french ? "Lecture de fichier" : "Read file";
    }
    if (text.indexOf("rg ") !== -1 || text.indexOf("grep ") !== -1) {
      return french ? "Recherche dans les fichiers" : "Search files";
    }
    if (text.indexOf("ls ") !== -1 || text.indexOf("find ") !== -1) {
      return french ? "Liste de fichiers" : "List files";
    }
    return french ? "Commande shell" : "Shell command";
  }

  function managedSkillReadText(value) {
    var text = trim(String(value || "")).replace(/\s+/g, " ").toLowerCase();
    if (!text.length) {
      return false;
    }
    var readsManagedSkill = text.indexOf("skills/convertigo-generalist/skill.md") !== -1 ||
      text.indexOf("skills/convertigo-nocode/skill.md") !== -1 ||
      text.indexOf("skills/convertigo-studio/skill.md") !== -1 ||
      text.indexOf("skills/convertigo-flow-mcp/skill.md") !== -1 ||
      text.indexOf("skills/convertigo-flow-backend/skill.md") !== -1 ||
      text.indexOf("skills/convertigo-flow-frontend-svelte/skill.md") !== -1;
    return readsManagedSkill &&
      (text.indexOf("sed -n") !== -1 ||
        text.indexOf("cat ") !== -1 ||
        text.indexOf("/bin/zsh -lc") !== -1 ||
        text.indexOf("/bin/bash -lc") !== -1 ||
        text.indexOf("zsh -lc") !== -1 ||
        text.indexOf("bash -lc") !== -1 ||
        text.indexOf("get-content ") !== -1 ||
        text.indexOf("powershell") !== -1 ||
        text.indexOf("pwsh") !== -1);
  }

  function shellCommandFromValue(value) {
    if (value == null) {
      return "";
    }
    if (typeof value === "string") {
      var text = trim(value);
      if (!text.length) {
        return "";
      }
      if (looksLikeShellCommand(text)) {
        return text;
      }
      if ((text.charAt(0) === "{" && text.charAt(text.length - 1) === "}") ||
          (text.charAt(0) === "[" && text.charAt(text.length - 1) === "]")) {
        try {
          return shellCommandFromValue(JSON.parse(text));
        } catch (_ignoreShellJson) {}
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }
    var candidates = [
      value.cmd,
      value.command,
      value.shellCommand,
      value.script,
      value.input,
      value.title,
      value.name,
      value.arguments,
      value.detail,
      value.text
    ];
    if (Array.isArray && Array.isArray(value)) {
      candidates = value;
    }
    for (var i = 0; i < candidates.length; i++) {
      var command = shellCommandFromValue(candidates[i]);
      if (command.length) {
        return command;
      }
    }
    return "";
  }

  function toolShellCommandText(event, data, rawTitle) {
    data = data || {};
    var item = data.item || {};
    var candidates = [
      rawTitle,
      data.command,
      data.cmd,
      data.arguments,
      data.detail,
      data.title,
      data.name,
      event && event.title,
      item.command,
      item.cmd,
      item.arguments,
      item.title,
      item.name,
      item.content,
      item.result,
      item.output
    ];
    for (var i = 0; i < candidates.length; i++) {
      var command = shellCommandFromValue(candidates[i]);
      if (command.length) {
        return command;
      }
    }
    return "";
  }

  function cleanEventText(value) {
    return compactLine(value);
  }

  function eventKeyForText(kind, text) {
    return String(kind || "event") + ":" + trim(text).substring(0, 180);
  }

  function isOpaqueCallId(value) {
    return /^call_[A-Za-z0-9_-]+$/.test(trim(value));
  }

  function toolCallId(data) {
    return trim(data && (data.callId || data.toolCallId || data.tool_call_id || data.id));
  }

  function toolNameFromData(data) {
    data = data || {};
    var invocation = data.invocation || {};
    var item = data.item || {};
    var name = trim(data.toolName || data.tool || invocation.tool || invocation.name || item.tool || item.name || data.name);
    var server = trim(data.server || invocation.server || item.server);
    if (server.length && name.length && name.indexOf(server + ".") !== 0) {
      return server + "." + name;
    }
    if (name.length) {
      return name;
    }
    return trim(data.title);
  }

  function normalizedToolTitle(state, data, title) {
    title = trim(title);
    var shellCommand = toolShellCommandText(null, data, title);
    if (shellCommand.length) {
      return shellCommandTitle(state, shellCommand);
    }
    var callId = toolCallId(data);
    if (callId.length && state && state.toolCalls && state.toolCalls[callId] && state.toolCalls[callId].title) {
      if (!title.length || isOpaqueCallId(title)) {
        title = state.toolCalls[callId].title;
      }
    }
    var namedTool = toolNameFromData(data);
    if ((!title.length || isOpaqueCallId(title)) && namedTool.length && !isOpaqueCallId(namedTool)) {
      title = namedTool;
    }
    if (!title.length || isOpaqueCallId(title)) {
      title = normalizeProvider(state && state.provider) === "codex" ? "Outil Codex" : "Outil";
    }
    return title;
  }

  function rememberToolCall(state, data, title) {
    var callId = toolCallId(data);
    if (!state || !callId.length) {
      return;
    }
    if (!state.toolCalls) {
      state.toolCalls = {};
    }
    if (!state.toolCalls[callId]) {
      state.toolCalls[callId] = {};
    }
    if (title && !isOpaqueCallId(title)) {
      state.toolCalls[callId].title = title;
    }
    var toolName = toolNameFromData(data);
    if (toolName.length && !isOpaqueCallId(toolName)) {
      state.toolCalls[callId].toolName = toolName;
    }
  }

  function pushProgressEvent(state, item) {
    if (!state) {
      return null;
    }
    if (!state.progressEvents || typeof state.progressEvents.length === "undefined") {
      state.progressEvents = [];
    }
    item = item || {};
    var text = cleanEventText(normalizeProgressLine(state, item.text || item.title || ""));
    var title = trim(normalizeProgressLine(state, item.title || text));
    if (!text.length && !title.length) {
      return null;
    }
    var kind = trim(item.type || "narrative") || "narrative";
    var key = trim(item.key || eventKeyForText(kind, title || text));
    for (var i = 0; i < state.progressEvents.length; i++) {
      var existing = state.progressEvents[i];
      if (existing && existing.key === key) {
        if (isOpaqueCallId(title) && existing.title && !isOpaqueCallId(existing.title)) {
          title = existing.title;
        }
        existing.text = text || existing.text || "";
        existing.title = title || existing.title || "";
        existing.status = trim(item.status || existing.status || "");
        existing.detail = trim(item.detail || existing.detail || "");
        existing.toolName = trim(item.toolName || existing.toolName || "");
        existing.groupKey = trim(item.groupKey || existing.groupKey || "");
        existing.current = item.current === true;
        existing.updatedAt = now();
        if (existing.status === "completed" || existing.status === "failed" || existing.status === "error") {
          existing.completedAt = existing.completedAt || now();
          existing.current = false;
        }
        return existing;
      }
    }
    state.progressEvents.push({
      key: key,
      type: kind,
      text: text,
      title: title,
      status: trim(item.status || ""),
      detail: trim(item.detail || ""),
      provider: trim(item.provider || state.provider || ""),
      callId: trim(item.callId || ""),
      toolName: trim(item.toolName || ""),
      groupKey: trim(item.groupKey || ""),
      current: item.current === true,
      at: now(),
      updatedAt: now()
    });
    while (state.progressEvents.length > 80) {
      state.progressEvents.shift();
    }
    return state.progressEvents[state.progressEvents.length - 1];
  }

  function markProgressEventsIdle(state) {
    if (!state || !state.progressEvents) {
      return;
    }
    for (var i = 0; i < state.progressEvents.length; i++) {
      if (state.progressEvents[i]) {
        state.progressEvents[i].current = false;
      }
    }
  }

  function appendNarrativeEvent(state, text, source) {
    text = cleanEventText(text);
    if (!state || !text.length) {
      return;
    }
    if (!state.progressEvents || typeof state.progressEvents.length === "undefined") {
      state.progressEvents = [];
    }
    var compactText = trim(text.replace(/\s+/g, " "));
    for (var i = state.progressEvents.length - 1; i >= 0; i--) {
      var existing = state.progressEvents[i];
      if (!existing || trim(existing.type || "narrative") !== "narrative") {
        continue;
      }
      var existingText = trim(String(existing.text || existing.title || "").replace(/\s+/g, " "));
      if (!existingText.length || existingText === compactText) {
        return;
      }
      if (compactText.indexOf(existingText + " ") === 0) {
        existing.key = eventKeyForText("narrative", text);
        existing.text = text;
        existing.title = text;
        existing.status = "completed";
        existing.provider = source || existing.provider || state.provider || "";
        existing.current = false;
        existing.updatedAt = now();
        existing.completedAt = existing.completedAt || now();
        return;
      }
      if (existingText.indexOf(compactText + " ") === 0) {
        return;
      }
    }
    pushProgressEvent(state, {
      key: eventKeyForText("narrative", text),
      type: "narrative",
      text: text,
      title: text,
      status: "completed",
      provider: source || state.provider || ""
    });
  }

  function appendActivityEvent(state, text, current) {
    text = cleanEventText(text);
    if (!text.length) {
      return;
    }
    if (current === true) {
      markProgressEventsIdle(state);
    }
    pushProgressEvent(state, {
      key: eventKeyForText("activity", text),
      type: "activity",
      text: text,
      title: text,
      status: current === true ? "running" : "completed",
      current: current === true
    });
  }

  function toolEventKey(data, title) {
    var callId = toolCallId(data);
    if (callId.length) {
      return "tool:" + callId;
    }
    return eventKeyForText("tool", title || "tool");
  }

  function appendToolEvent(state, event, data, type) {
    var rawTitle = eventToolTitle(event, data);
    var shellCommand = toolShellCommandText(event, data, rawTitle);
    var preview = eventToolResultPreview(data);
    if (managedSkillReadText(shellCommand) || managedSkillReadText(rawTitle) || managedSkillReadText(preview)) {
      return;
    }
    var title = normalizedToolTitle(state, data, rawTitle);
    if (shellCommand.length) {
      title = shellCommandTitle(state, shellCommand);
    }
    rememberToolCall(state, data, title);
    var status = eventToolStatus(data);
    if (type === "tool/start" && !status.length) {
      status = "running";
    }
    if (shellCommand.length) {
      preview = preview.length && preview !== shellCommand ? shellCommand + "\n\n" + preview : shellCommand;
    }
    var label = progressTextForTool(state, title);
    if (status === "failed" || status === "error") {
      label = lang(state).toolRetry;
    }
    markProgressEventsIdle(state);
    pushProgressEvent(state, {
      key: shellCommand.length && !toolCallId(data).length ? eventKeyForText("tool", "exec_command:" + shellCommand) : toolEventKey(data, title),
      type: "tool",
      text: label,
      title: title,
      status: status || "running",
      detail: preview,
      provider: state.provider || "",
      callId: toolCallId(data),
      toolName: shellCommand.length ? "exec_command" : toolNameFromData(data),
      groupKey: shellCommand.length ? "exec_command" : title.toLowerCase(),
      current: !(status === "completed" || status === "complete" || status === "success" || status === "succeeded" || status === "failed" || status === "error")
    });
    state.lastStatusText = label;
  }

  function compactLine(value) {
    var text = trim(String(value || "").replace(/\s+/g, " "));
    if (!text.length) {
      return "";
    }
    if (!/[.!?]$/.test(text)) {
      text += ".";
    }
    return text;
  }

  function appendProgressLine(state, text) {
    var rawText = normalizeProgressLine(state, text);
    if (progressLineLooksLikeFinalAnswer(rawText)) {
      appendAnswerChunk(state, trim(rawText));
      state.answerIsFinal = true;
      return "";
    }
    text = compactLine(rawText);
    if (!text.length) {
      return "";
    }
    if (!state.progressLog) {
      state.progressLog = "";
    }
    state.progressChunkActive = false;
    if (state.lastProgressLine === text) {
      return text;
    }
    var existing = "\n" + state.progressLog + "\n";
    if (existing.indexOf("\n" + text + "\n") !== -1) {
      return text;
    }
    state.progressLog += (state.progressLog.length ? "\n" : "") + text;
    state.lastProgressLine = text;
    state.lastStatusText = text;
    return text;
  }

  function appendProgress(state, text) {
    var rawText = normalizeProgressLine(state, text);
    if (managedSkillReadText(rawText)) {
      return;
    }
    var shellCommand = shellCommandFromValue(rawText);
    if (shellCommand.length || looksLikeShellCommand(rawText)) {
      var commandText = shellCommand.length ? shellCommand : trim(String(rawText || ""));
      var title = shellCommandTitle(state, commandText);
      markProgressEventsIdle(state);
      pushProgressEvent(state, {
        key: eventKeyForText("tool", "exec_command:" + commandText),
        type: "tool",
        text: progressTextForTool(state, title),
        title: title,
        status: "completed",
        detail: commandText,
        provider: state.provider || "",
        toolName: "exec_command",
        groupKey: "exec_command",
        current: false
      });
      return;
    }
    text = appendProgressLine(state, rawText);
    if (!text.length) {
      return;
    }
    appendNarrativeEvent(state, text, "progress");
  }

  function appendProgressChunk(state, text) {
    text = String(text || "").replace(/\r\n?/g, "\n");
    if (!trim(text).length) {
      return;
    }
    text = text.replace(/\n[ \t]*\n+/g, "\n");
    var previousLog = String(state.progressLog || "");
    if (!state.progressLog) {
      state.progressLog = "";
    }
    if (state.progressLog.length && /[\n\r]$/.test(state.progressLog) && /^\n+/.test(text)) {
      text = text.replace(/^\n+/, "");
    }
    if (state.progressLog.length && state.progressChunkActive !== true && !/[\n\r]$/.test(state.progressLog)) {
      state.progressLog += "\n";
    }
    state.progressLog += text;
    state.progressLog = state.progressLog.replace(/\n[ \t]*\n+/g, "\n");
    state.progressChunkActive = true;
    var lines = state.progressLog.split(/\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = trim(lines[i]);
      if (line.length) {
        state.lastStatusText = line;
        break;
      }
    }
    var touchedText = state.progressLog.substring(Math.max(0, previousLog.length));
    if (previousLog.length && !/[\n\r]$/.test(previousLog)) {
      var lastBreak = previousLog.lastIndexOf("\n");
      touchedText = state.progressLog.substring(lastBreak + 1);
    }
    var eventLines = (touchedText.length ? touchedText : text).split(/\n/);
    for (var j = 0; j < eventLines.length; j++) {
      var candidate = compactLine(normalizeProgressLine(state, eventLines[j]));
      if (!candidate.length || progressLineLooksLikeFinalAnswer(candidate)) {
        continue;
      }
      var isLast = j === eventLines.length - 1;
      var complete = /[.!?]$/.test(candidate) || !isLast || /[\n\r]$/.test(text);
      if (complete) {
        appendNarrativeEvent(state, candidate, "progress");
      }
    }
  }

  function comparableAnswerText(value) {
    return trim(String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*/g, " - "));
  }

  function appendAnswerChunk(state, text) {
    text = String(text || "");
    if (!trim(text).length) {
      return;
    }
    var current = String(state.answer || "");
    if (!trim(current).length) {
      state.answer = text;
      return;
    }
    if (normalizeProvider(state && state.provider) === "vibe") {
      // ACP agent_message_chunk content is a delta. Treating short, repeated
      // fragments as cumulative snapshots drops valid text such as list rows.
      state.answer += text;
      return;
    }
    var currentComparable = comparableAnswerText(current);
    var nextComparable = comparableAnswerText(text);
    if (nextComparable === currentComparable) {
      if (text.length > current.length) {
        state.answer = text;
      }
      return;
    }
    if (nextComparable.indexOf(currentComparable) !== -1) {
      state.answer = text;
      return;
    }
    if (currentComparable.indexOf(nextComparable) !== -1) {
      return;
    }
    state.answer += text;
  }

  function displayContent(state) {
    var progress = String(state.progressLog || "");
    var answer = String(state.answer || "");
    if (answer.length) {
      if (state && (state.status === "completed" || state.status === "failed" || state.status === "cancelled" || state.status === "closed")) {
        return answer;
      }
      return progress.length ? progress + "\n\n" + answer : answer;
    }
    return progress.length ? progress : String(state.lastStatusText || "");
  }

  function answerLooksIncomplete(state, value) {
    var text = trim(String(value || "").replace(/\s+/g, " "));
    if (!text.length) {
      return true;
    }
    if (genericCompletedFallback(text)) {
      return true;
    }
    if (text.indexOf("<tool_error>") !== -1 || text.indexOf("\"JsonResponse\"") !== -1) {
      return true;
    }
    return false;
  }

  function incompleteFinalAnswer(state) {
    var t = lang(state);
    var text = t.completedIncomplete;
    var phase = compactLine(state && state.lastStatusText);
    if (phase.length) {
      text += "\n\n" + t.lastObservedAction + phase;
    }
    if (state && state.warnings && state.warnings.length) {
      text += "\n\n" + t.toolWarning;
    }
    return text;
  }

  function progressLines(state) {
    var raw = String(state && state.progressLog || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = compactLine(raw[i]);
      if (line.length && lines.indexOf(line) === -1) {
        lines.push(line);
      }
    }
    return lines;
  }

  function genericCompletedFallback(value) {
    var text = trim(String(value || "").toLowerCase().replace(/\s+/g, " "));
    return text === "i have finished the task." ||
      text === "i have finished the task" ||
      text === "j'ai termin\u00e9 le traitement." ||
      text === "j'ai termin\u00e9 le traitement" ||
      text === "j\u2019ai termin\u00e9 le traitement." ||
      text === "j\u2019ai termin\u00e9 le traitement";
  }

  function progressLineLooksLikeFinalAnswer(value) {
    var text = trim(String(value || "").replace(/\s+/g, " "));
    if (!text.length || genericCompletedFallback(text)) {
      return false;
    }
    var lower = text.toLowerCase();
    if (lower.indexOf("je vais ") === 0 || lower.indexOf("i will ") === 0 || lower.indexOf("i am ") === 0 || lower.indexOf("j'analyse ") === 0 || lower.indexOf("j'utilise ") === 0) {
      return false;
    }
    if (lower.indexOf("validation") !== -1 || lower.indexOf("c'est fait") === 0 || lower.indexOf("c\u2019est fait") === 0) {
      return true;
    }
    if (lower.indexOf("j'ai ajout") === 0 || lower.indexOf("j\u2019ai ajout") === 0 || lower.indexOf("j'ai corrig") === 0 || lower.indexOf("j\u2019ai corrig") === 0 || lower.indexOf("i added ") === 0 || lower.indexOf("i fixed ") === 0 || lower.indexOf("i updated ") === 0) {
      return true;
    }
    if (lower.indexOf("projets ouverts") === 0 || lower.indexOf("open projects") === 0 || lower.indexOf("aucune modification effectu") !== -1 || lower.indexOf("no change") !== -1) {
      return true;
    }
    var bulletCount = (String(value || "").match(/\n\s*[-*]\s+/g) || []).length;
    if (bulletCount >= 2 && text.length >= 80) {
      return true;
    }
    return text.length >= 180 && (text.indexOf("- ") !== -1 || text.indexOf(";") !== -1);
  }

  function finalAnswerFromProgress(state) {
    var lines = progressLines(state);
    for (var i = lines.length - 1; i >= 0; i--) {
      if (progressLineLooksLikeFinalAnswer(lines[i])) {
        return lines[i];
      }
    }
    return "";
  }

  function sanitizeProgressLog(state) {
    if (!state) {
      return state;
    }
    sanitizeProgressEvents(state);
    var rawLines = String(state.progressLog || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var lines = [];
    var finalCandidate = "";
    for (var i = 0; i < rawLines.length; i++) {
      var line = compactLine(normalizeProgressLine(state, rawLines[i]));
      if (!line.length) {
        continue;
      }
      if (progressLineLooksLikeFinalAnswer(line)) {
        if (!finalCandidate.length) {
          finalCandidate = trim(rawLines[i]) || line;
        }
        continue;
      }
      if (lines.indexOf(line) === -1) {
        lines.push(line);
      }
    }
    if (finalCandidate.length && !trim(state.answer).length) {
      state.answer = finalCandidate;
      state.answerIsFinal = true;
    }
    state.progressLog = lines.join("\n");
    if (state.lastStatusText && progressLineLooksLikeFinalAnswer(state.lastStatusText)) {
      state.lastStatusText = lines.length ? lines[lines.length - 1] : "";
    }
    state.lastProgressLine = lines.length ? lines[lines.length - 1] : "";
    return state;
  }

  function sanitizeProgressEvents(state) {
    if (!state || !state.progressEvents || typeof state.progressEvents.length === "undefined") {
      return;
    }
    var cleanedReversed = [];
    var seen = {};
    var seenActivityText = {};
    for (var i = state.progressEvents.length - 1; i >= 0; i--) {
      var item = state.progressEvents[i];
      if (!item) {
        continue;
      }
      var rawText = item.text || item.title || "";
      var rawTitle = item.title || rawText;
      var normalizedText = cleanEventText(normalizeProgressLine(state, rawText));
      var normalizedTitle = trim(normalizeProgressLine(state, rawTitle || normalizedText));
      if (!normalizedText.length && !normalizedTitle.length) {
        continue;
      }
      item.text = normalizedText || normalizedTitle;
      item.title = normalizedTitle || item.text;
      var itemType = trim(item.type || "narrative") || "narrative";
      var activityTextKey = trim(String(item.text || item.title || "").replace(/\s+/g, " ")).toLowerCase();
      if (itemType !== "tool" && activityTextKey.length) {
        if (seenActivityText[activityTextKey]) {
          continue;
        }
        seenActivityText[activityTextKey] = true;
      }
      if (progressLineLooksLikeAgentLifecycle(rawText) || progressLineLooksLikeAgentLifecycle(rawTitle)) {
        item.key = eventKeyForText(itemType, item.title || item.text);
      }
      var key = trim(item.key || eventKeyForText(itemType, item.title || item.text));
      if (seen[key]) {
        continue;
      }
      item.key = key;
      seen[key] = true;
      cleanedReversed.push(item);
    }
    state.progressEvents = cleanedReversed.reverse();
  }

  function appendObservedSteps(state, text) {
    var lines = progressLines(state);
    if (!lines.length) {
      return text;
    }
    if (lines.length > 6) {
      lines = lines.slice(lines.length - 6);
    }
    var t = lang(state);
    return text + "\n\n" + t.observedSteps + "\n" + lines.map(function (line) {
      return "- " + line;
    }).join("\n");
  }

  function completedFallbackAnswer(state) {
    var finalFromProgress = finalAnswerFromProgress(state);
    if (finalFromProgress.length) {
      return finalFromProgress;
    }
    var t = lang(state);
    var text = appendObservedSteps(state, t.completedNoAnswer);
    if (state && state.warnings && state.warnings.length) {
      text += "\n\n" + t.toolWarning;
    }
    return text;
  }

  function setStateBuffer(state) {
    setBuffer(displayContent(state), state.status, {
      runid: state.runid || "",
      threadid: state.threadid || "",
      phase: state.lastStatusText || "",
      progress: state.progressLog || "",
      progressEvents: state.progressEvents || [],
      warnings: state.warnings || []
    });
  }

  function eventToolTitle(event, data) {
    var namedTool = toolNameFromData(data);
    if (namedTool.length && !isOpaqueCallId(namedTool)) {
      return namedTool;
    }
    if (data && data.title != null) {
      return String(data.title);
    }
    if (data && data.name != null) {
      return String(data.name);
    }
    if (event && event.title != null) {
      return String(event.title);
    }
    return "";
  }

  function eventToolStatus(data) {
    if (!data) {
      return "";
    }
    if (data.status != null) {
      return String(data.status).toLowerCase();
    }
    if (data.update && data.update.status != null) {
      return String(data.update.status).toLowerCase();
    }
    if (data.result && data.result.status != null) {
      return String(data.result.status).toLowerCase();
    }
    return "";
  }

  function eventToolResultPreview(data) {
    if (!data) {
      return "";
    }
    var candidates = [
      data.detail,
      data.preview,
      data.summary,
      data.text,
      data.output,
      data.arguments,
      data.result && data.result.preview,
      data.result && data.result.summary,
      data.result && data.result.text,
      data.result && data.result.output,
      data.result,
      data.item && data.item.output,
      data.item && data.item.result,
      data.item && data.item.content,
      data.item && data.item.arguments
    ];
    for (var i = 0; i < candidates.length; i++) {
      var value = candidates[i];
      if (value == null) {
        continue;
      }
      var text = "";
      if (typeof value === "string") {
        text = value;
      } else {
        try {
          text = JSON.stringify(value);
        } catch (_ignoreStringify) {
          text = String(value);
        }
      }
      text = trim(text.replace(/\s+/g, " "));
      if (!text.length || text === "{}" || text === "[]") {
        continue;
      }
      if (text.length > 1800) {
        text = text.substring(0, 1797) + "...";
      }
      return text;
    }
    return "";
  }

  function validProjectName(value) {
    var name = trim(value);
    if (!name.length || name.length > 160 || name.indexOf("://") !== -1 || /[\/\\\s]/.test(name)) {
      return "";
    }
    return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) ? name : "";
  }

  function projectNameFromToolValue(value, depth) {
    if (value == null || depth > 6) {
      return "";
    }
    if (typeof value === "string") {
      var text = trim(value);
      var searchableText = text;
      for (var unescapeIndex = 0; unescapeIndex < 3; unescapeIndex++) {
        searchableText = searchableText.replace(/\\(["'])/g, "$1");
      }
      var embeddedProject = searchableText.match(/["'](?:importedProjectName|targetProject|projectName|project)["']\s*:\s*["']([^"']+)["']/);
      if (embeddedProject) {
        var embeddedProjectName = validProjectName(embeddedProject[1]);
        if (embeddedProjectName.length && embeddedProjectName !== "lib_ConvertigoMCP") {
          return embeddedProjectName;
        }
      }
      if ((text.charAt(0) === "{" && text.charAt(text.length - 1) === "}") ||
          (text.charAt(0) === "[" && text.charAt(text.length - 1) === "]")) {
        try {
          return projectNameFromToolValue(JSON.parse(text), depth + 1);
        } catch (_ignoreProjectJson) {}
      }
      return "";
    }
    if (typeof value.length !== "undefined" && typeof value !== "function" && !value.nodeType) {
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
        var arrayProject = projectNameFromToolValue(value[arrayIndex], depth + 1);
        if (arrayProject.length) {
          return arrayProject;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }

    var directNames = [
      value.importedProjectName,
      value.targetProject,
      value.projectName,
      value.project
    ];
    for (var nameIndex = 0; nameIndex < directNames.length; nameIndex++) {
      var directProject = validProjectName(directNames[nameIndex]);
      if (directProject.length && directProject !== "lib_ConvertigoMCP") {
        return directProject;
      }
    }
    var qname = trim(value.targetQName || value.rootQName || value.qname || value.target);
    if (qname.length) {
      var qnameProject = validProjectName(qname.split(".")[0]);
      if (qnameProject.length && qnameProject !== "lib_ConvertigoMCP") {
        return qnameProject;
      }
    }

    var nestedValues = [
      value.structuredContent,
      value.result,
      value.output,
      value.content,
      value.item,
      value.arguments,
      value.detail,
      value.text
    ];
    for (var nestedIndex = 0; nestedIndex < nestedValues.length; nestedIndex++) {
      var nestedProject = projectNameFromToolValue(nestedValues[nestedIndex], depth + 1);
      if (nestedProject.length) {
        return nestedProject;
      }
    }
    return "";
  }

  function rememberProjectFromToolEvent(state, data) {
    if (!state || !data) {
      return "";
    }
    var toolName = toolNameFromData(data).toLowerCase();
    if (!/(marketplace-import|mobile-builder-open|databaseobject-tree-apply|project-save|upsert-|crud-)/.test(toolName)) {
      return "";
    }
    var project = projectNameFromToolValue(data, 0);
    if (!project.length) {
      return "";
    }
    state.projectNames = addArrayValue(state.projectNames || [], project);
    if (!trim(state.primaryProject || state.projectId).length) {
      state.primaryProject = project;
      state.projectId = project;
    }
    return project;
  }

  function eventText(data) {
    if (!data) {
      return "";
    }
    if (data.text != null) {
      return String(data.text);
    }
    if (data.delta != null) {
      return String(data.delta);
    }
    if (data.content != null) {
      return String(data.content);
    }
    return "";
  }

  function codexAnswerChunkIsProgress(state, data) {
    if (normalizeProvider(state && state.provider) !== "codex" || !data) {
      return false;
    }
    var text = eventText(data);
    var phase = String(data.phase || "").toLowerCase();
    if (phase === "final_answer") {
      return false;
    }
    if (progressLineLooksLikeFinalAnswer(text)) {
      return false;
    }
    if (phase === "commentary") {
      return true;
    }
    if (data.item && String(data.item.type || "").toLowerCase() === "agent_message") {
      var itemPhase = String(data.item.phase || (data.item.metadata && data.item.metadata.phase) || "").toLowerCase();
      return itemPhase !== "final_answer";
    }
    return false;
  }

  function sameCanonicalPath(left, right) {
    try {
      return filePath(new File(left)) === filePath(new File(right));
    } catch (_ignoreSamePath) {
      return trim(left) === trim(right);
    }
  }

  function replacePathPrefix(value, oldPrefix, newPrefix) {
    var text = trim(value);
    var oldText = trim(oldPrefix);
    if (!text.length || !oldText.length) {
      return text;
    }
    if (text === oldText) {
      return newPrefix;
    }
    if (text.indexOf(oldText + File.separator) === 0) {
      return newPrefix + text.substring(oldText.length);
    }
    if (text.indexOf(oldText + "/") === 0) {
      return newPrefix + text.substring(oldText.length);
    }
    return text;
  }

  function isConversationScopedCodexHome(value) {
    var text = trim(value).replace(/\\/g, "/");
    return text.indexOf("/conversations/") >= 0 && /\/codex-home\/?$/.test(text);
  }

  function sanitizeCodexHome(value) {
    var text = trim(value);
    return isConversationScopedCodexHome(text) ? "" : text;
  }

  function rebaseStateWorkspace(state, workspaceRoot) {
    var previousWorkspace = trim(state.workspaceRoot);
    var previousConversationDir = trim(state.conversationDir);
    state.workspaceRoot = workspaceRoot;
    if (!trim(state.cwd).length || (previousWorkspace.length && sameCanonicalPath(state.cwd, previousWorkspace))) {
      state.cwd = workspaceRoot;
    } else if (previousWorkspace.length) {
      state.cwd = replacePathPrefix(state.cwd, previousWorkspace, workspaceRoot);
    }
    var dir = conversationDirectory(state.workspaceRoot, state.userKey, state.conversationId || state.threadid, state.provider);
    state.conversationDir = filePath(dir);
    state.conversationFile = filePath(conversationRecordFile(dir));
    state.transcriptFile = filePath(conversationTranscriptFile(dir));
    state.summaryFile = filePath(conversationSummaryFile(dir));
    if (normalizeProvider(state.provider) === "codex") {
      var legacyConversationHome = isConversationScopedCodexHome(state.codexHome) ||
        isConversationScopedCodexHome(state.agentHome) ||
        isConversationScopedCodexHome(state.vibeHome);
      state.vibeHome = "";
      state.agentHome = "";
      state.codexHome = sanitizeCodexHome(state.codexHome);
      if (legacyConversationHome) {
        state.externalSessionId = "";
      }
      return;
    }
    if (!trim(state.vibeHome).length || (previousConversationDir.length && state.vibeHome.indexOf(previousConversationDir) === 0)) {
      state.vibeHome = childPath(dir, homeLeafForProvider(state.provider));
    } else if (previousWorkspace.length) {
      state.vibeHome = replacePathPrefix(state.vibeHome, previousWorkspace, workspaceRoot);
    }
    state.agentHome = state.vibeHome;
  }

  function ensureState(state) {
    if (!state) {
      return state;
    }
    state.provider = normalizeProvider(state.provider);
    if (!state.primaryProject) {
      state.primaryProject = state.projectId || "";
    }
    if (!state.conversationId) {
      state.conversationId = state.threadid;
    }
    if (!state.userKey) {
      state.userKey = normalizeUserKey(state.userId);
    }
    var projectWorkspace = defaultWorkspaceRoot(state.primaryProject || state.projectId);
    if (!state.workspaceRoot) {
      state.workspaceRoot = projectWorkspace;
    } else if (projectWorkspace.length && !sameCanonicalPath(state.workspaceRoot, projectWorkspace) && projectWorkspaceRoot(state.primaryProject || state.projectId).length) {
      rebaseStateWorkspace(state, projectWorkspace);
    }
    if (!state.conversationDir) {
      var dir = conversationDirectory(state.workspaceRoot, state.userKey, state.conversationId || state.threadid, state.provider);
      state.conversationDir = filePath(dir);
      state.conversationFile = filePath(conversationRecordFile(dir));
      state.transcriptFile = filePath(conversationTranscriptFile(dir));
      state.summaryFile = filePath(conversationSummaryFile(dir));
    }
    if (normalizeProvider(state.provider) === "codex") {
      var legacyCodexConversationHome = isConversationScopedCodexHome(state.codexHome) ||
        isConversationScopedCodexHome(state.agentHome) ||
        isConversationScopedCodexHome(state.vibeHome);
      state.codexHome = sanitizeCodexHome(state.codexHome);
      state.agentHome = "";
      state.vibeHome = "";
      if (legacyCodexConversationHome) {
        state.externalSessionId = "";
      } else if (!trim(state.externalSessionId).length) {
        state.externalSessionId = recoverCodexExternalSessionId(state, state.externalSessionId);
      }
    } else {
      if (!state.vibeHome) {
        state.vibeHome = childPath(new File(state.conversationDir), homeLeafForProvider(state.provider));
      }
      state.agentHome = state.agentHome || state.vibeHome;
    }
    if (!state.projectNames || typeof state.projectNames.length === "undefined") {
      state.projectNames = [];
    }
    if (!trim(state.primaryProject || state.projectId).length && state.progressEvents && state.progressEvents.length) {
      for (var projectEventIndex = 0; projectEventIndex < state.progressEvents.length; projectEventIndex++) {
        var projectEvent = state.progressEvents[projectEventIndex] || {};
        rememberProjectFromToolEvent(state, {
          toolName: projectEvent.toolName || projectEvent.title || "",
          detail: projectEvent.detail || ""
        });
        if (trim(state.primaryProject || state.projectId).length) {
          break;
        }
      }
    }
    state.projectNames = addArrayValue(state.projectNames, state.primaryProject || state.projectId);
    if (typeof state.answer === "undefined" || state.answer === null) {
      state.answer = "";
    }
    if (typeof state.answerIsFinal === "undefined" || state.answerIsFinal === null) {
      state.answerIsFinal = false;
    }
    if (typeof state.error === "undefined" || state.error === null) {
      state.error = "";
    }
    if (typeof state.progressLog === "undefined" || state.progressLog === null) {
      state.progressLog = "";
    }
    if (!state.progressEvents || typeof state.progressEvents.length === "undefined") {
      state.progressEvents = [];
    }
    if (typeof state.lastProgressLine === "undefined" || state.lastProgressLine === null) {
      state.lastProgressLine = "";
    }
    if (typeof state.lastStatusText === "undefined" || state.lastStatusText === null) {
      state.lastStatusText = "";
    }
    if (!state.warnings || typeof state.warnings.length === "undefined") {
      state.warnings = [];
    }
    if (!state.language) {
      state.language = detectLanguage(state.userQuestion || state.answer || "");
    }
    if (typeof state.model === "undefined" || state.model === null) {
      state.model = normalizeModel(state.provider, "");
    }
    if (typeof state.reasoningEffort === "undefined" || state.reasoningEffort === null) {
      state.reasoningEffort = "";
    }
    if (typeof state.serviceTier === "undefined" || state.serviceTier === null) {
      state.serviceTier = "";
    }
    if (!state.skillProfile) {
      state.skillProfile = normalizeSkillProfile(state);
    }
    if (!state.agentProfile) {
      state.agentProfile = state.skillProfile;
    }
    if (typeof state.assistantContext === "undefined" || state.assistantContext === null) {
      state.assistantContext = "";
    }
    if (typeof state.assistantSurface === "undefined" || state.assistantSurface === null) {
      state.assistantSurface = "";
    }
    return sanitizeProgressLog(refreshTerminalStateFromRecord(state));
  }

  function recoverState(options, threadid) {
    options = options || {};
    options.threadid = threadid;
    var state = createState(options);
    if (state.status !== "completed" && state.status !== "closed") {
      state.status = "in_progress";
      appendProgress(state, lang(state).thinking);
    }
    state.updatedAt = now();
    saveState(state);
    return sanitizeProgressLog(state);
  }

  function createState(options) {
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var threadid = normalizeConversationId(options.threadid) || makeConversationId();
    var provider = trim(options.provider).length ? normalizeProvider(options.provider) : "all";
    var record = readConversationRecord(workspaceRoot, userKey, threadid, provider);
    if (record && record.provider) {
      provider = normalizeProvider(record.provider);
    }
    if (provider === "all") {
      provider = "vibe";
    }
    if (record && trim(record.workspaceRoot).length) {
      workspaceRoot = trim(record.workspaceRoot);
    }
    var conversationDir = conversationDirectory(workspaceRoot, userKey, threadid, provider);
    var primaryProject = trim(options.targetProject || options.projectName || options.projectId);
    if (!primaryProject.length && record) {
      primaryProject = trim(record.primaryProject || record.projectId);
    }
    var projectNames = record && record.projectNames ? record.projectNames : [];
    projectNames = addArrayValue(projectNames, primaryProject);
    var legacyRecordCodexHome = normalizeProvider(provider) === "codex" && (
      isConversationScopedCodexHome(options.codexHome) ||
      (record && (
        isConversationScopedCodexHome(record.codexHome) ||
        isConversationScopedCodexHome(record.agentHome) ||
        isConversationScopedCodexHome(record.vibeHome)
      ))
    );
    var codexHome = normalizeProvider(provider) === "codex" ? sanitizeCodexHome(options.codexHome || (record && record.codexHome)) : "";
    var vibeHome = normalizeProvider(provider) === "codex" ? "" : trim(options.vibeHome || options.agentHome || options.codexHome);
    if (normalizeProvider(provider) !== "codex" && !vibeHome.length) {
      vibeHome = record && trim(record.agentHome || record.vibeHome).length ? trim(record.agentHome || record.vibeHome) : childPath(conversationDir, homeLeafForProvider(provider));
    }
    var model = normalizeModel(provider, options.model || options.agentModel || (record && record.model));
    var reasoningEffort = normalizeReasoningEffort(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort || (record && record.reasoningEffort));
    var serviceTier = trim(options.serviceTier || options.speedTier || (record && record.serviceTier));
    var externalSessionId = legacyRecordCodexHome ? "" : record && trim(record.externalSessionId);
    if (!legacyRecordCodexHome && normalizeProvider(provider) === "codex" && record) {
      externalSessionId = recoverCodexExternalSessionId(record, externalSessionId);
    }
    var skillProfile = normalizeSkillProfile({
      agentProfile: options.agentProfile || (record && record.agentProfile),
      skillProfile: options.skillProfile || (record && record.skillProfile),
      assistantContext: options.assistantContext || (record && record.assistantContext),
      projectName: primaryProject
    });
    return {
      conversationId: threadid,
      threadid: threadid,
      handle: record && trim(record.handle).length ? trim(record.handle) : threadid,
      provider: provider,
      agentProfile: trim(options.agentProfile || (record && record.agentProfile)) || skillProfile,
      skillProfile: skillProfile,
      assistantContext: trim(options.assistantContext || (record && record.assistantContext)),
      assistantSurface: trim(options.assistantSurface || (record && record.assistantSurface)),
      model: model,
      reasoningEffort: reasoningEffort,
      serviceTier: serviceTier,
      bridgeBaseUrl: trim(options.bridgeBaseUrl) || (record && trim(record.bridgeBaseUrl)) || defaultBridgeUrl(),
      mcpEndpoint: trim(options.mcpEndpoint) || (record && trim(record.mcpEndpoint)) || defaultMcpEndpoint({ agentProfile: skillProfile }),
      workspaceRoot: workspaceRoot,
      cwd: trim(options.cwd) || (record && trim(record.cwd)) || workspaceRoot,
      userKey: userKey,
      codexHome: codexHome,
      vibeHome: vibeHome,
      agentHome: normalizeProvider(provider) === "codex" ? "" : vibeHome,
      conversationDir: filePath(conversationDir),
      conversationFile: filePath(conversationRecordFile(conversationDir)),
      transcriptFile: filePath(conversationTranscriptFile(conversationDir)),
      summaryFile: filePath(conversationSummaryFile(conversationDir)),
      projectId: primaryProject,
      primaryProject: primaryProject,
      projectNames: projectNames,
      userId: trim(options.userId),
      title: record ? conversationTitleFromText(record.title) : "",
      externalSessionId: externalSessionId,
      language: normalizeAssistantLanguage(options.language || options.locale || options.assistantLanguage || (record && record.language)) || detectLanguage(options.userQuestion || options.Question || ""),
      userQuestion: trim(options.userQuestion || extractUserMessage(options.Question || "")),
      status: record && trim(record.status).length ? trim(record.status) : "created",
      cursor: record && record.lastCursor ? Number(record.lastCursor) : 0,
      runid: record && record.lastRunId ? String(record.lastRunId) : "",
      answer: record && trim(record.status) === "completed" ? String(record.lastAnswerPreview || "") : "",
      answerIsFinal: record && trim(record.status) === "completed" && trim(record.lastAnswerPreview).length > 0,
      progressLog: record && record.progress ? String(record.progress) : "",
      progressEvents: record && record.progressEvents ? record.progressEvents : [],
      lastProgressLine: "",
      lastStatusText: record && record.phase ? String(record.phase) : "",
      warnings: record && record.warnings ? record.warnings : [],
      readErrors: 0,
      error: "",
      codexPrewarmStartedAt: record && record.codexPrewarmStartedAt ? Number(record.codexPrewarmStartedAt) : 0,
      codexPrewarmStatus: record && record.codexPrewarmStatus ? String(record.codexPrewarmStatus) : "",
      createdAt: record && record.createdAt ? Number(record.createdAt) : now(),
      updatedAt: now()
    };
  }

  function publicState(state) {
    return {
      threadid: state.threadid,
      handle: state.handle,
      provider: state.provider,
      agentProfile: state.agentProfile || state.skillProfile || "",
      skillProfile: normalizeSkillProfile(state),
      assistantContext: state.assistantContext || "",
      assistantSurface: state.assistantSurface || "",
      language: state.language || "",
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      serviceTier: state.serviceTier || "",
      status: state.status,
      runid: state.runid,
      cursor: state.cursor,
      conversationId: state.conversationId || state.threadid,
      userKey: state.userKey || "studio",
      workspaceRoot: state.workspaceRoot || "",
      vibeHome: normalizeProvider(state.provider) === "codex" ? "" : state.vibeHome,
      agentHome: normalizeProvider(state.provider) === "codex" ? "" : state.agentHome || state.vibeHome || "",
      codexHome: normalizeProvider(state.provider) === "codex" ? sanitizeCodexHome(state.codexHome) : "",
      conversationDir: state.conversationDir || "",
      externalSessionId: state.externalSessionId || "",
      projectId: state.projectId,
      primaryProject: state.primaryProject || state.projectId || "",
      projectNames: state.projectNames || [],
      progress: state.progressLog || "",
      progressEvents: state.progressEvents || [],
      phase: state.lastStatusText || "",
      warnings: state.warnings || [],
      setupRequired: state.setupRequired === true,
      setup: state.setupReport || null,
      codexPrewarmStartedAt: state.codexPrewarmStartedAt || 0,
      codexPrewarmStatus: state.codexPrewarmStatus || "",
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    };
  }

  function responseMessages(state) {
    if (!trim(state.answer).length) {
      return [];
    }
    return [{
      type: "assistant",
      id: state.runid || -1,
      msg: state.answer
    }];
  }

  function conversationAIData(state, historyLimit) {
    return {
      threadid: state.threadid,
      status: state.status || "",
      runid: state.runid || "",
      progress: state.progressLog || "",
      progressEvents: state.progressEvents || [],
      phase: state.lastStatusText || "",
      warnings: state.warnings || [],
      state: publicState(state),
      messages: transcriptMessages(state, historyLimit)
    };
  }

  function responseForState(state) {
    return {
      id: state.runid || state.threadid,
      object: "agent.run",
      status: state.status,
      provider: state.provider,
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      serviceTier: state.serviceTier || "",
      threadid: state.threadid,
      AIData: {
        type: "agent",
        threadid: state.threadid,
        explanation: state.answer || state.error || "",
        progress: state.progressLog || "",
        progressEvents: state.progressEvents || [],
        setupRequired: state.setupRequired === true,
        setup: state.setupReport || null,
        warnings: state.warnings || [],
        messages: responseMessages(state)
      },
      state: publicState(state)
    };
  }

  function bridgeProcessLostMessage(state, bridgeState) {
    var message = lang(state).bridgeProcessLost;
    var detail = trim(bridgeState && bridgeState.lastError);
    if (detail.length) {
      message += "\n\nDiagnostic: " + detail;
    }
    return message;
  }

  function recoverableBridgeError(error) {
    var message = String(error || "").toLowerCase();
    return message.indexOf("timed out") !== -1 ||
      message.indexOf("timeout") !== -1 ||
      message.indexOf("read timed") !== -1 ||
      message.indexOf("connect timed") !== -1 ||
      message.indexOf("sockettimeoutexception") !== -1;
  }

  function keepRunAliveAfterBridgeReadFailure(state, progressText) {
    state.readErrors = Number(state.readErrors || 0) + 1;
    appendProgress(state, progressText || lang(state).bridgeStateRecover);
    if (state.readErrors <= MAX_TRANSIENT_READ_ERRORS && !trim(state.answer).length) {
      state.status = "in_progress";
      state.error = "";
      return true;
    }
    return false;
  }

  function shouldInstallForRun(options, provider) {
    if (typeof options.install !== "undefined") {
      return boolValue(options.install, true);
    }
    if (normalizeProvider(provider) === "codex" && typeof options.installCodex !== "undefined") {
      return boolValue(options.installCodex, true);
    }
    if (normalizeProvider(provider) === "vibe" && typeof options.installVibe !== "undefined") {
      return boolValue(options.installVibe, true);
    }
    return false;
  }

  function shouldShowAgentPreparingProgress(state, options, provider, installRequested) {
    if (installRequested !== true) {
      return false;
    }
    if (trim(state.externalSessionId || state.codexThreadId || state.sessionId).length) {
      return false;
    }
    if (boolValue(options.forceCodexInstall || options.forceVibeInstall || options.forceInstall || options.forceAgentInstall, false)) {
      return true;
    }
    return state.setupRequired === true || !trim(state.setupReport && state.setupReport.status).length;
  }

  function agentSetupPayload(state, options, installOverride) {
    options = options || {};
    var provider = normalizeProvider(state.provider);
    var install = typeof installOverride === "undefined" ? boolValue(options.install || options.installCodex || options.installVibe, false) : installOverride === true;
    if (provider === "codex") {
      var codexScope = codexHomeScopeForRun(options);
      return {
        codexHome: codexHomeForRun(options, codexScope),
        codexHomeScope: codexScope,
        conversationId: state.threadid || state.conversationId || "",
        projectId: state.primaryProject || state.projectId || "",
        userId: state.userId || state.userKey || "",
        agentProfile: state.agentProfile || state.skillProfile || options.agentProfile || options.skillProfile || "",
        skillProfile: state.skillProfile || options.skillProfile || options.agentProfile || "",
        assistantContext: state.assistantContext || options.assistantContext || "",
        assistantSurface: state.assistantSurface || options.assistantSurface || "",
        codexPath: trim(options.codexPath || options.commandPath),
        install: install ? "true" : "false",
        codexLogin: typeof options.codexLogin === "undefined" ? "" : options.codexLogin,
        codexLoginStatus: typeof options.codexLoginStatus === "undefined" ? "" : options.codexLoginStatus,
        forceLogin: typeof options.forceLogin === "undefined" ? "" : options.forceLogin,
        nodeVersion: trim(options.nodeVersion),
        nodeDir: trim(options.nodeDir || options.nodeInstallDir),
        npmPath: trim(options.npmPath),
        allowNodeDownload: typeof options.allowNodeDownload === "undefined" ? "" : options.allowNodeDownload,
        codexPackage: trim(options.codexPackage || options.packageName),
        codexVersion: trim(options.codexVersion || options.packageVersion),
        codexInstallMethod: trim(options.codexInstallMethod || options.installMethod),
        codexInstallTimeoutMs: trim(options.codexInstallTimeoutMs),
        forceCodexInstall: typeof options.forceCodexInstall === "undefined" ? "" : options.forceCodexInstall,
        mcpSkillsSourceDir: trim(options.mcpSkillsSourceDir || options.skillsSourceDir || options.convertigoMcpDir),
        skipSkillsInstall: typeof options.skipSkillsInstall === "undefined" ? "" : options.skipSkillsInstall,
        mcpEndpoint: state.mcpEndpoint,
        browserDebugUrl: trim(options.browserDebugUrl),
        browserDevToolsJsonUrl: trim(options.browserDevToolsJsonUrl),
        browserDevToolsWebSocketUrl: trim(options.browserDevToolsWebSocketUrl),
        playwrightCdpEndpoint: trim(options.playwrightCdpEndpoint || options.viewerCdpEndpoint),
        playwrightMcpEndpoint: trim(options.playwrightMcpEndpoint),
        viewerCdpEndpoint: trim(options.viewerCdpEndpoint),
        agentRevealMode: revealModeOption(options),
        model: state.model || "",
        reasoningEffort: state.reasoningEffort || "",
        serviceTier: state.serviceTier || ""
      };
    }
    var vibeScope = trim(options.vibeHomeScope || options.homeScope);
    if (!vibeScope.length) {
      vibeScope = "user";
    }
    return {
      install: install ? "true" : "false",
      configure: "true",
      vibeHome: trim(options.vibeHome),
      vibeHomeScope: vibeScope,
      homeScope: vibeScope,
      conversationId: state.threadid || state.conversationId || "",
      projectId: state.primaryProject || state.projectId || "",
      userId: state.userId || state.userKey || "",
      agentProfile: state.agentProfile || state.skillProfile || options.agentProfile || options.skillProfile || "",
      skillProfile: state.skillProfile || options.skillProfile || options.agentProfile || "",
      assistantContext: state.assistantContext || options.assistantContext || "",
      assistantSurface: state.assistantSurface || options.assistantSurface || "",
      mcpEndpoint: state.mcpEndpoint,
      model: state.model || "",
      mcpSkillsSourceDir: trim(options.mcpSkillsSourceDir || options.skillsSourceDir || options.convertigoMcpDir),
      skipSkillsInstall: typeof options.skipSkillsInstall === "undefined" ? "" : options.skipSkillsInstall,
      forceVibeInstall: typeof options.forceVibeInstall === "undefined" ? "" : options.forceVibeInstall,
      forcePythonInstall: typeof options.forcePythonInstall === "undefined" ? "" : options.forcePythonInstall,
      allowPythonDownload: typeof options.allowPythonDownload === "undefined" ? "" : options.allowPythonDownload,
      pythonPath: trim(options.pythonPath),
      pythonInstallDir: trim(options.pythonInstallDir),
      pythonArchiveUrl: trim(options.pythonArchiveUrl),
      pythonArchiveSha256: trim(options.pythonArchiveSha256),
      pythonAssetUrlPrefix: trim(options.pythonAssetUrlPrefix || options.pythonMirrorBaseUrl),
      pythonVersion: trim(options.pythonVersion),
      pythonBuildTag: trim(options.pythonBuildTag),
      pythonPlatform: trim(options.pythonPlatform),
      pythonArchiveFlavor: trim(options.pythonArchiveFlavor),
      agentRevealMode: revealModeOption(options)
    };
  }

  function callAgentSetup(state, options, installOverride) {
    var provider = normalizeProvider(state.provider);
    var setupSequence = provider === "codex" ? "agent_codex_setup" : "agent_vibe_setup";
    var setup = bridgeCall(state, setupSequence, agentSetupPayload(state, options, installOverride), 900000);
    return {
      provider: provider,
      sequence: setupSequence,
      result: setup
    };
  }

  function agentSettingsForOptions(options, workspaceRoot, userKey, projectFilter, provider) {
    options = optionsWithRequestFallbacks(options);
    var providerSelector = normalizeProviderSelector(provider || options.provider || options.agentProvider);
    var providerFilter = providerSelector === "all" ? "" : providerSelector;
    var explicitProject = trim(projectFilter || options.targetProject || options.projectName || options.projectId);
    var agentProfile = trim(options.agentProfile || options.skillProfile || options.assistantContext);
    var skillProfile = agentProfile.length ? normalizeSkillProfile(options) : "";
    var mcpEndpoint = trim(options.mcpEndpoint);
    if (!mcpEndpoint.length && skillProfile.length) {
      mcpEndpoint = defaultMcpEndpoint({ agentProfile: skillProfile });
    }
    var payload = {
      provider: providerFilter,
      workspaceRoot: workspaceRoot || resolveWorkspaceRoot(options),
      projectId: explicitProject,
      userId: trim(options.userId) || userKey || "studio",
      conversationId: normalizeConversationId(options.threadid || options.conversationId),
      agentProfile: agentProfile,
      skillProfile: skillProfile,
      assistantContext: trim(options.assistantContext),
      assistantSurface: trim(options.assistantSurface),
      mcpEndpoint: mcpEndpoint,
      codexHome: codexHomeForRun(options, codexHomeScopeForRun(options)),
      codexHomeScope: codexHomeScopeForRun(options),
      codexPath: trim(options.codexPath || options.commandPath),
      vibeHome: trim(options.vibeHome || options.agentHome),
      vibeHomeScope: trim(options.vibeHomeScope || options.homeScope),
      model: trim(options.model),
      reasoningEffort: trim(options.reasoningEffort || options.reasoningLevel),
      serviceTier: trim(options.serviceTier),
      savePreferences: typeof options.savePreferences === "undefined" ? "" : options.savePreferences,
      settingsTimeoutMs: trim(options.settingsTimeoutMs),
      checkUpdates: typeof options.checkUpdates === "undefined" ? "" : options.checkUpdates,
      refreshUpdateCheck: typeof options.refreshUpdateCheck === "undefined" ? "" : options.refreshUpdateCheck,
      updateCheckTimeoutMs: trim(options.updateCheckTimeoutMs),
      updateCheckCacheMs: trim(options.updateCheckCacheMs),
      runtimePresenceOnly: typeof options.runtimePresenceOnly === "undefined" ? "" : options.runtimePresenceOnly
    };
    try {
      var settings = bridgeCall(options, "agent_settings", payload, 120000);
      settings.ok = settings.ok !== false;
      return settings;
    } catch (e) {
      return {
        ok: false,
        status: "error",
        error: String(e),
        defaults: {
          provider: "",
          model: "",
          reasoning: ""
        },
        providers: [],
        timestamp: now()
      };
    }
  }

  function setupRequiredAnswer(state, setup) {
    var t = lang(state);
    var provider = providerLabel(state.provider);
    var lines = [];
    if (setup && setup.status === "authentication_required") {
      if (normalizeProvider(state.provider) === "codex") {
        lines.push(state.language === "fr" ? "Codex est installé, mais aucune authentification utilisable n'a été trouvée." : "Codex is installed, but no usable authentication was found.");
        lines.push(state.language === "fr" ? "Connectez-vous avec Codex Desktop ou lancez `codex login`, puis revenez dans cette configuration." : "Sign in with Codex Desktop or run `codex login`, then return to this configuration.");
      } else {
        lines.push(state.language === "fr" ? "Vibe est installé, mais aucune clé Mistral n'a été trouvée." : "Vibe is installed, but no Mistral key was found.");
        lines.push(state.language === "fr" ? "Ajoutez `MISTRAL_API_KEY` au profil Vibe (`~/.vibe/.env`), puis revenez dans cette configuration." : "Add `MISTRAL_API_KEY` to the Vibe profile (`~/.vibe/.env`), then return to this configuration.");
      }
      return lines.join("\n");
    }
    lines.push(t.setupRequired);
    if (setup && setup.messages && setup.messages.length) {
      lines.push("");
      lines.push(state.language === "fr" ? "Diagnostic :" : "Diagnostic:");
      for (var i = 0; i < setup.messages.length && i < 4; i++) {
        lines.push("- " + String(setup.messages[i]));
      }
    }
    lines.push("");
    lines.push((state.language === "fr" ? "Agent : " : "Agent: ") + provider);
    lines.push(t.setupCanInstall);
    return lines.join("\n");
  }

  function setupReadyAnswer(state, setup) {
    var t = lang(state);
    var provider = providerLabel(state.provider);
    var lines = [(state.language === "fr" ? "Agent : " : "Agent: ") + provider, t.setupReady];
    var detail = setup && setup.setup ? setup.setup : {};
    var installation = setup && setup.installation ? setup.installation : {};
    if (installation && installation.attempted === true) {
      if (installation.installed === true) {
        lines.push(state.language === "fr" ? "Installation locale terminée." : "Local installation completed.");
      } else if (installation.reused === true) {
        lines.push(state.language === "fr" ? "Runtime local existant reutilise." : "Existing local runtime reused.");
      }
    }
    if (detail.codex && detail.codex.path) {
      lines.push("Codex: " + detail.codex.path);
    }
    if (detail.vibe && detail.vibe.path) {
      lines.push("Vibe: " + detail.vibe.path);
    }
    if (detail.codexHome) {
      lines.push("CODEX_HOME: " + detail.codexHome);
    } else if (setup && setup.skills && setup.skills.resolvedCodexHome) {
      lines.push("CODEX_HOME: " + setup.skills.resolvedCodexHome);
    }
    if (detail.vibeHome) {
      lines.push("VIBE_HOME: " + detail.vibeHome);
    }
    if (detail.installDir) {
      lines.push((state.language === "fr" ? "Répertoire agent: " : "Agent directory: ") + detail.installDir);
    }
    if (setup && setup.skills && setup.skills.message) {
      lines.push(setup.skills.message);
    }
    if (setup && setup.messages && setup.messages.length) {
      for (var i = 0; i < setup.messages.length && i < 4; i++) {
        var message = String(setup.messages[i] || "");
        if (message.length && lines.indexOf(message) === -1) {
          lines.push(message);
        }
      }
    }
    return lines.join("\n");
  }

  function publicCommandDiagnostic(command) {
    if (!command) {
      return null;
    }
    return {
      found: command.found === true,
      path: String(command.path || ""),
      version: String(command.version || ""),
      error: String(command.error || "")
    };
  }

  function publicInstallationDiagnostic(installation) {
    if (!installation) {
      return null;
    }
    return {
      attempted: installation.attempted === true,
      installed: installation.installed === true || installation.installedNode === true,
      reused: installation.reused === true,
      method: String(installation.method || ""),
      package: String(installation.package || ""),
      stepsCount: installation.steps && installation.steps.length ? installation.steps.length : 0,
      python: installation.python ? {
        attempted: installation.python.attempted === true,
        installed: installation.python.installed === true,
        reused: installation.python.reused === true,
        python: publicCommandDiagnostic(installation.python.python)
      } : null,
      codex: publicCommandDiagnostic(installation.codex)
    };
  }

  function publicSetupReport(report) {
    if (!report) {
      return null;
    }
    var setup = report.setup || {};
    var out = {
      ok: report.ok === true,
      status: String(report.status || ""),
      phase: String(report.phase || ""),
      error: String(report.error || ""),
      authentication: report.authentication ? {
        configured: report.authentication.configured === true,
        status: String(report.authentication.status || ""),
        method: String(report.authentication.method || ""),
        action: String(report.authentication.action || "")
      } : null,
      messages: report.messages || [],
      installation: publicInstallationDiagnostic(report.installation),
      skills: report.skills || null,
      setup: {
        workspaceRoot: String(setup.workspaceRoot || ""),
        installDir: String(setup.installDir || ""),
        venvDir: String(setup.venvDir || ""),
        vibeHome: String(setup.vibeHome || ""),
        codexHome: String(setup.codexHome || ""),
        mcpEndpoint: String(setup.mcpEndpoint || ""),
        model: String(setup.model || ""),
        home: setup.home || null,
        config: setup.config ? {
          selected: setup.config.selected || null
        } : null,
        mcp: setup.mcp ? {
          checked: setup.mcp.checked === true,
          ok: setup.mcp.ok === true,
          hasConvertigo: setup.mcp.hasConvertigo === true,
          error: String(setup.mcp.error || "")
        } : null,
        python: publicCommandDiagnostic(setup.python),
        uv: publicCommandDiagnostic(setup.uv),
        vibe: publicCommandDiagnostic(setup.vibe),
        vibeAcp: publicCommandDiagnostic(setup.vibeAcp),
        codex: publicCommandDiagnostic(setup.codex)
      },
      timestamp: report.timestamp || now()
    };
    return out;
  }

  C8O.assistantAgentBridge.createConversation = function (options) {
    options = options || {};
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var provider = trim(options.provider).length ? normalizeProvider(options.provider) : "all";
    var skillProfile = normalizeSkillProfile(options);
    var projectFilter = trim(options.targetProject || options.projectName || options.projectId);
    var includeSettings = boolValue(options.includeSettings, true);
    var requestedThreadId = normalizeThreadId(options.threadid);
    var resumedLatest = false;
    var hasQuestion = trim(options.Question || options.question || options.userQuestion).length > 0;
    var shouldResumeLatest = boolValue(options.resumeLatest, false);
    if (!requestedThreadId.length && !boolValue(options.forceNew, false) && shouldResumeLatest) {
      var latest = latestConversationRecord(workspaceRoot, userKey, projectFilter, provider, skillProfile);
      if (latest !== null) {
        requestedThreadId = normalizeConversationId(latest.conversationId || latest.threadid);
        options.threadid = requestedThreadId;
        resumedLatest = requestedThreadId.length > 0;
      }
    }
    if (!requestedThreadId.length && !hasQuestion) {
      setBuffer("", "");
      var previewSettings = includeSettings ? agentSettingsForOptions(options, workspaceRoot, userKey, projectFilter, provider) : null;
      var previewDefaults = applyAgentSettingsDefaults(options, previewSettings, provider);
      var resolvedProvider = provider === "all" ? "" : (previewDefaults.provider || provider);
      return {
        ok: true,
        id: "",
        object: "agent.conversation",
        provider: resolvedProvider,
        model: previewDefaults.model || "",
        status: provider === "all" ? "agent_selection_required" : "new_conversation_ready",
        setupRequired: false,
        requiresAgentSelection: provider === "all",
        resumed: false,
        state: null,
        conversation: null,
        conversations: publicConversations(workspaceRoot, userKey, "", false, "all", skillProfile),
        settings: previewSettings,
        AIData: {
          type: "agent",
          threadid: "",
          explanation: "",
          progress: "",
          setupRequired: false,
          setup: null,
          warnings: [],
          messages: []
        }
      };
    }
    if (!requestedThreadId.length && provider === "all") {
      setBuffer("", "");
      var emptySettings = includeSettings ? agentSettingsForOptions(options, workspaceRoot, userKey, projectFilter, provider) : null;
      applyAgentSettingsDefaults(options, emptySettings, provider);
      return {
        ok: true,
        id: "",
        object: "agent.conversation",
        provider: "",
        model: "",
        status: "agent_selection_required",
        setupRequired: false,
        requiresAgentSelection: true,
        resumed: false,
        state: null,
        conversation: null,
        conversations: publicConversations(workspaceRoot, userKey, "", false, "all", skillProfile),
        settings: emptySettings,
        AIData: {
          type: "agent",
          threadid: "",
          explanation: "",
          progress: "",
          setupRequired: false,
          setup: null,
          warnings: [],
          messages: []
        }
      };
    }
    var creationSettings = includeSettings ? agentSettingsForOptions(options, workspaceRoot, userKey, projectFilter, provider) : null;
    var creationDefaults = applyAgentSettingsDefaults(options, creationSettings, provider);
    if (creationDefaults.provider.length) {
      provider = creationDefaults.provider;
    }
    var state = readState(requestedThreadId);
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    if (!trim(state.model).length && creationDefaults.model.length) {
      state.model = creationDefaults.model;
    }
    if (!trim(state.reasoningEffort).length && creationDefaults.reasoningEffort.length) {
      state.reasoningEffort = normalizeReasoningEffort(creationDefaults.reasoningEffort);
    }
    state.updatedAt = now();
    saveState(state);
    if (!isTerminalStatus(state.status) && trim(state.runid).length && C8O.assistantAgentBridge.readResponse) {
      try {
        C8O.assistantAgentBridge.readResponse({
          threadid: state.threadid,
          runid: state.runid,
          limit: 100,
          waitMs: 0
        });
        state = readState(state.threadid) || state;
        state = ensureState(state);
      } catch (_ignoreCreateConversationRead) {}
    } else {
      setBuffer("", "");
    }
    var prewarming = false;
    if (!hasQuestion && (resumedLatest || requestedThreadId.length > 0)) {
      prewarming = prewarmCodexAppServer(state, options);
    }
    return {
      ok: true,
      id: state.threadid,
      object: "agent.conversation",
      provider: state.provider,
      model: state.model || "",
      status: state.status,
      resumed: resumedLatest || requestedThreadId.length > 0,
      prewarming: prewarming,
      state: publicState(state),
      conversation: publicConversation(readJsonFile(new File(state.conversationFile)) || {}),
      conversations: publicConversations(state.workspaceRoot, state.userKey, "", false, "all", normalizeSkillProfile(state)),
      settings: includeSettings ? (creationSettings || agentSettingsForOptions(options, state.workspaceRoot, state.userKey, state.primaryProject || state.projectId, state.provider)) : null,
      AIData: conversationAIData(state, options.historyLimit)
    };
  };

  C8O.assistantAgentBridge.settings = function (options) {
    options = optionsWithRequestFallbacks(options);
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var provider = trim(options.provider).length ? normalizeProviderSelector(options.provider) : "all";
    var projectFilter = trim(options.targetProject || options.projectName || options.projectId);
    var settings = agentSettingsForOptions(options, workspaceRoot, userKey, projectFilter, provider);
    return {
      ok: settings.ok !== false,
      status: settings.status || (settings.ok === false ? "error" : "ready"),
      provider: provider,
      userKey: userKey,
      workspaceRoot: workspaceRoot,
      settings: settings,
      preferences: settings.preferences || null,
      defaults: settings.defaults || {
        provider: "",
        model: "",
        reasoning: ""
      },
      providers: settings.providers || [],
      conversations: publicConversations(workspaceRoot, userKey, "", false, "all", normalizeSkillProfile(options)),
      timestamp: now()
    };
  };

  C8O.assistantAgentBridge.setupAgent = function (options) {
    options = optionsWithRequestFallbacks(options || {});
    var threadid = normalizeThreadId(options.threadid);
    var state = threadid.length ? readState(threadid) : null;
    if (state === null && !threadid.length && !trim(options.provider || options.agentProvider).length) {
      return {
        ok: true,
        id: "",
        object: "agent.setup",
        status: "agent_selection_required",
        provider: "",
        model: "",
        installRequested: false,
        setupRequired: false,
        requiresAgentSelection: true,
        canInstall: false,
        setup: null,
        state: null,
        message: ""
      };
    }
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    var codexLoginRequested = normalizeProvider(state.provider) === "codex" && boolValue(options.codexLogin || options.codexLoginStatus, false);
    if (codexLoginRequested) {
      var loginInfo = callAgentSetup(state, options, false);
      var login = loginInfo.result || {};
      state.setupRequired = login.authenticated !== true;
      state.setupReport = {
        ok: login.authenticated === true,
        status: login.status || "login_required",
        authentication: {
          configured: login.authenticated === true,
          status: login.authenticated === true ? "configured" : "missing",
          action: login.authenticated === true ? "" : "codex_login"
        }
      };
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);
      return {
        ok: login.ok !== false,
        id: state.threadid,
        object: "agent.login",
        status: login.status || (login.authenticated === true ? "authenticated" : "login_required"),
        provider: "codex",
        setupRequired: login.authenticated !== true,
        login: login,
        state: publicState(state),
        message: login.message || login.error || ""
      };
    }
    var updateRequested = boolValue(options.updateRuntime || options.forceRuntimeUpdate || options.forceUpdate, false);
    if (updateRequested) {
      if (normalizeProvider(state.provider) === "codex") {
        options.forceCodexInstall = true;
      } else {
        options.forceVibeInstall = true;
      }
    }
    clearCancellationRequested(state.threadid);
    if (trim(options.model || options.agentModel).length) {
      state.model = normalizeModel(state.provider, options.model || options.agentModel);
    } else if (!trim(state.model).length) {
      state.model = normalizeModel(state.provider, "");
    }
    if (trim(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort).length) {
      state.reasoningEffort = normalizeReasoningEffort(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort);
    }
    if (trim(options.serviceTier || options.speedTier).length) {
      state.serviceTier = trim(options.serviceTier || options.speedTier);
    }
    state.language = detectLanguage(options.userQuestion || options.Question || "");
    enrichViewerDebugOptions(options, state);
    var install = boolValue(options.diagnosticOnly, false) ? false : true;
    var setupInfo = callAgentSetup(state, options, install);
    var setup = setupInfo.result || {};
    var publicSetup = publicSetupReport(setup);
    state.setupReport = publicSetup;
    state.setupRequired = setup.ok !== true;
    state.lastStatusText = setup.ok === true ? lang(state).setupReady : lang(state).setupRequired;
    state.updatedAt = now();
    saveState(state);
    setStateBuffer(state);
    var setupConversationId = setup.ok === true ? "" : state.threadid;
    var refreshedSettings = null;
    if (setup.ok === true) {
      options.checkUpdates = true;
      options.refreshUpdateCheck = true;
      refreshedSettings = agentSettingsForOptions(
        options,
        state.workspaceRoot,
        state.userKey,
        state.primaryProject || state.projectId,
        state.provider
      );
    }
    return {
      ok: setup.ok === true,
      id: setupConversationId,
      object: "agent.setup",
      status: setup.status || (setup.ok === true ? "ready" : "missing"),
      provider: state.provider,
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      serviceTier: state.serviceTier || "",
      installRequested: install,
      setupRequired: setup.ok !== true,
      canInstall: true,
      setup: publicSetup,
      settings: refreshedSettings,
      state: publicState(state),
      message: setup.ok === true ? setupReadyAnswer(state, setup) : setupRequiredAnswer(state, setup)
    };
  };

  function sequenceScopeValue(scope, name) {
    try {
      if (scope && typeof scope[name] !== "undefined") {
        return scope[name];
      }
    } catch (_ignoreSequenceScopeValue) {}
    return requestParameter(name);
  }

  function sequenceArrayValue(value) {
    return value && Object.prototype.toString.call(value) === "[object Array]";
  }

  function parseSequenceFiles(value) {
    var text = trim(value);
    if (!text.length) {
      return [];
    }
    try {
      var parsed = JSON.parse(text);
      if (sequenceArrayValue(parsed)) {
        return parsed;
      }
      if (parsed && sequenceArrayValue(parsed.files)) {
        return parsed.files;
      }
      if (parsed) {
        return [parsed];
      }
    } catch (_ignoreParseSequenceFiles) {}
    return [{ raw: text }];
  }

  function sequenceFileValue(file, names) {
    if (!file) {
      return "";
    }
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (file[name] !== null && typeof file[name] !== "undefined") {
        var value = trim(file[name]);
        if (value.length) {
          return value;
        }
      }
    }
    return "";
  }

  function sequenceAttachmentLine(file, index) {
    var label = sequenceFileValue(file, ["filename", "name", "file_name", "id", "object"]);
    var path = sequenceFileValue(file, ["path", "filepath", "filePath", "localPath", "absolutePath", "file"]);
    var type = sequenceFileValue(file, ["type", "mime", "mimeType", "content_type", "contentType"]);
    var id = sequenceFileValue(file, ["id", "file_id", "fileId"]);
    var size = sequenceFileValue(file, ["bytes", "size", "length"]);
    var raw = sequenceFileValue(file, ["raw"]);
    var parts = [];
    parts.push("attachment " + (index + 1));
    if (label.length) parts.push("name=" + label);
    if (path.length) parts.push("path=" + path);
    if (type.length) parts.push("type=" + type);
    if (id.length) parts.push("id=" + id);
    if (size.length) parts.push("size=" + size);
    if (raw.length) parts.push("raw=" + raw);
    return parts.join("; ");
  }

  function simpleViewerFollowupText(value) {
    var text = trim(String(value || ""));
    if (!text.length || text.length > 160) {
      return false;
    }
    var normalized = (" " + text.toLowerCase().replace(/[’']/g, " ") + " ");
    var actionHits = [
      " encore ", " fois ", " clique ", " cliquer ", " clic ", " appuie ", " appuis ",
      " appuyer ", " bouton ", " boutons ", " reteste ", " re-teste ", " refais ",
      " recommence ", " continue "
    ];
    var hasAction = false;
    for (var i = 0; i < actionHits.length; i++) {
      if (normalized.indexOf(actionHits[i]) !== -1) {
        hasAction = true;
        break;
      }
    }
    if (!hasAction) {
      return false;
    }
    var mutationHits = [
      " modifie ", " modifier ", " corrige ", " corriger ", " change ", " changer ",
      " ajoute ", " ajouter ", " supprime ", " supprimer ", " crée ", " creer ",
      " créer ", " patch ", " yaml ", " code ", " composant ", " sequence ", " séquence "
    ];
    for (var j = 0; j < mutationHits.length; j++) {
      if (normalized.indexOf(mutationHits[j]) !== -1) {
        return false;
      }
    }
    return true;
  }

  function shouldUseSimpleViewerFollowup(rawQuestion, options) {
    return trim(options && options.threadid).length > 0 &&
      trim(options && (options.targetProject || options.projectName || options.projectId)).length > 0 &&
      existingViewerCdpEndpoint(options).length > 0 &&
      boolValue(options && options.browserControlReady, true) &&
      simpleViewerFollowupText(rawQuestion);
  }

  function buildSequencePrompt(rawQuestion, options) {
    options = options || {};
    var targetProject = trim(options.targetProject);
    if (!targetProject.length) {
      targetProject = trim(options.projectName);
    }
    var capabilityProfile = assistantProfileDescriptor(options);
    var userId = trim(options.userId);
    var isStudioSurface = !userId.length || userId.toLowerCase() === "studio";
    var isNoCodeSurface = !isStudioSurface;
    var routingHint = capabilityProfile.id;
    var selectedThread = trim(options.threadid);
    var uploadedFiles = parseSequenceFiles(options.AIFiles);
    var promptParts = [];
    promptParts.push(isNoCodeSurface ? "You are an AI agent integrated in Convertigo NoCode Studio (C8Oforms)." : "You are an AI coding agent integrated in Convertigo Studio.");
    promptParts.push(isNoCodeSurface ? "Your job is to help the user inspect, explain, and improve forms, no-code applications, pages, fields, roles, publication, permissions, and data sources through Convertigo tools." : "Your job is to inspect, edit, test, and validate Convertigo projects with the Legacy or Flow capability pack that owns the target model.");
    promptParts.push("Reply to the user in the same language as their message. The system and operational instructions are in English, but the user-facing answer must follow the user's language.");
    promptParts.push("While working, provide short user-facing progress updates when the agent interface supports streamed updates. Keep them factual, one or two sentences, in the user's language, and do not reveal hidden chain-of-thought; summarize what you are doing, what you found, or what you will try next.");
    promptParts.push("");
    promptParts.push(isNoCodeSurface ? "Convertigo NoCode context:" : "Convertigo Studio context:");
    promptParts.push("- Surface profile: " + (isNoCodeSurface ? "nocode" : "studio"));
    if (!isNoCodeSurface) {
      promptParts.push("- Routing hint: " + routingHint + " (a hint only; explicit user intent and the selected project's model take precedence).");
    }
    promptParts.push("- Authoring policy: " + (isNoCodeSurface ? capabilityProfile.authoringPolicy : "route-by-target-model"));
    promptParts.push("- Selected project: " + (targetProject.length ? targetProject : "none"));
    if (isNoCodeSurface) {
      promptParts.push("- Project selection is optional in this surface. Do not require an Eclipse/Studio selected project before inspecting or explaining C8Oforms/no-code resources.");
    }
    promptParts.push("- Assistant conversation/thread id: " + (selectedThread.length ? selectedThread : "none"));
    promptParts.push("- MCP endpoint: " + trim(options.mcpEndpoint));
    if (trim(options.provider).toLowerCase() === "codex" && !isNoCodeSurface) {
      promptParts.push("- Codex callable routes for the standard Convertigo path are already known: `tools.mcp__convertigo__project_list`, `tools.mcp__convertigo__marketplace_import`, `tools.mcp__convertigo__mobile_builder_open`, `tools.mcp__convertigo__upsert_crud`, `tools.mcp__convertigo__upsert_ngx_crud_kit`, `tools.mcp__convertigo__crud_proof`, `tools.mcp__convertigo__databaseobject_tree_get`, `tools.mcp__convertigo__databaseobject_tree_apply`, `tools.mcp__convertigo__palette_list`, `tools.mcp__convertigo__palette_describe`, and `tools.mcp__convertigo__batch_call`. Call these directly through `exec`; do not query `ALL_TOOLS` to locate or inspect them.");
      promptParts.push("- Managed JxBrowser proof routes are `tools.mcp__playwright__browser_tabs`, `tools.mcp__playwright__browser_find`, and `tools.mcp__playwright__browser_evaluate`. Call them directly and do not enumerate Playwright metadata.");
      promptParts.push("- Named Convertigo resources are read directly with `read_mcp_resource({server:\"convertigo\",uri:...})`; do not enumerate resource catalogs first.");
    }
    var viewerControlReady = boolValue(options.browserControlReady, true);
    var viewerCdpEndpoint = viewerControlReady ? existingViewerCdpEndpoint(options) : "";
    var establishedAgentFollowup = boolValue(options.establishedAgentFollowup, false);
    if (targetProject.length && viewerCdpEndpoint.length) {
      promptParts.push("- Latest Studio viewer CDP endpoint for this turn: " + viewerCdpEndpoint);
      promptParts.push("- Ignore older Studio viewer CDP endpoints from previous conversation history; they are stale after a builder/view restart.");
      promptParts.push("- Browser proof must use the managed Playwright MCP/browser-control tools attached to that Studio JxBrowser endpoint and the selected capability pack's viewer readiness contract. If the browser remains blank or attached elsewhere after readiness, report the managed configuration problem; do not open a separate browser, tab, page, Node script, or raw CDP workaround.");
    }
    var simpleViewerFollowup = shouldUseSimpleViewerFollowup(rawQuestion, options);
    if (simpleViewerFollowup) {
      promptParts.push("");
      promptParts.push("Fast path for this turn:");
      promptParts.push("- This is a simple follow-up action on an already selected project and an already attached Studio viewer. Do not bootstrap the full Convertigo guidance again.");
      promptParts.push("- Do not use or reread managed skills, do not read `SKILL.md`, do not call `resources/list`, `prompts/list`, `convertigo.read_mcp_resource`, `project-list`, or broad tree inspection before acting.");
      promptParts.push("- Do not run shell, PowerShell, UIAutomation, Node scripts, raw CDP, external browsers, or new tabs.");
      promptParts.push("- First call the managed Playwright/browser MCP current-tab/list-tabs tool and confirm it is on the selected project viewer URL. If it is already on the viewer, perform the requested click/check directly with Playwright.");
      promptParts.push("- If the current browser target is stale or blank, use the selected capability pack's readiness operation and start the viewer asynchronously only when needed, then retry Playwright after readiness.");
    } else if (establishedAgentFollowup) {
      promptParts.push("");
      promptParts.push("Continuation rules for this turn:");
      promptParts.push("- This agent conversation already completed its Convertigo bootstrap for the current MCP endpoint. Reuse the skill and guidance already present in the conversation context.");
      promptParts.push("- Do not reread a managed `SKILL.md`, `convertigo://capabilities`, `convertigo://resources/convertigo-start`, or any guide already read in this conversation. Do not repeat catalog discovery.");
      promptParts.push("- Read only the smallest new specialized recipe if this request introduces a genuinely new route not covered by the conversation, or repeat bootstrap only if the MCP reports a guidance-version mismatch or the endpoint changed.");
      promptParts.push("- Reuse object classes, property shapes, target QNames, and tool contracts that already succeeded in this conversation or are present in a targeted tree read. Do not reconfirm them through `palette-list`, `palette-describe`, or `ALL_TOOLS` metadata.");
      promptParts.push("- For `databaseobject-tree-get`, use `childrenDepth` for recursive descendants; `depth` is only a compatibility alias. Request the needed subtree once instead of walking one QName level per call.");
      promptParts.push("- For `databaseobject-tree-apply` with `at:\"inside\"`, the submitted `tree` is the one child to create and must include its own `className` and `name`; never send a children-only wrapper. Put sibling creations in separate optimized `batch-call` entries.");
      promptParts.push("- For unfamiliar NGX objects, call `palette-list` with the exact intended parent QName as `target`, then pass the returned logical `className` unchanged to `palette-describe`. Do not list from the project root and guess a `#logicalId`.");
      promptParts.push("- For common NGX primitives, treat `UIStyle#UIStyle.styleContent`, `UIAttribute#UIAttribute.attrName/attrValue`, `UIDynamicElement#TextItem`, and `UIText#UIText.textValue` as known contracts. Use one targeted palette lookup only when the requested object or property is genuinely unfamiliar.");
      promptParts.push("- Group independent mutations for one intent in one `batch-call` using `{calls:[{tool:\"databaseobject-tree-apply\",arguments:{...}}],onError:\"stop\",optimizeMutations:true}`. It performs one final refresh, save, and mobile-builder notification; do not separately save after a successful optimized mutation batch.");
      promptParts.push("- For a running frontend, use one readiness call `mobile-builder-open({project, stateOnly:true, wait:true, timeoutSec:30})`, then one combined Playwright proof. Do not inspect tool descriptions first and do not repeat readiness or browser proof unless that proof identifies a concrete defect.");
      promptParts.push("- Recheck the user's explicit acceptance behaviors before the final answer. Do not infer that a requested filter, counter, domain action, or other interaction exists merely because the underlying field or generic CRUD shell exists; prove it in the viewer or state the task is still incomplete and continue implementing it.");
    }
    promptParts.push("");
    promptParts.push("Operational rules:");
    promptParts.push(isNoCodeSurface ? "- Use the Convertigo NoCode MCP/tools for all form and no-code work." : "- Route the task through the managed `convertigo-studio` skill before authoring. Explicit Flow/FlowScript/Flow Svelte intent selects `convertigo-flow`; explicit Legacy/NGX intent selects `convertigo`; otherwise inspect the selected project's model and choose its owner.");
    if (!isNoCodeSurface) {
      promptParts.push("- After routing, use only the owning MCP for each target model. Never use curl, handwritten JSON-RPC, YAML edits, generated-file edits, or the other MCP as a fallback for a failed mutation.");
    }
    promptParts.push(isNoCodeSurface ? "- Use the Convertigo NoCode workflow and vocabulary. Prefer forms, applications, pages, fields, data sources, roles, publication, and permissions over Eclipse Studio terminology." : "- When a project is selected, work only on it unless the user explicitly asks for another project.");
    promptParts.push(isNoCodeSurface ? "- If a specific form, application, page, or data source is needed but not identified by the current context, inspect the available NoCode/C8Oforms resources first, then ask a focused clarification only if still ambiguous." : "- A missing project selection does not block an explicit new-project or new-application request. Derive a concise valid technical name from the request when none was supplied, check for collisions with Convertigo MCP, create the starter project, and continue. Ask for a selection only when the user wants work on an existing project that cannot be identified.");
    if (!simpleViewerFollowup && !establishedAgentFollowup) {
      promptParts.push(isNoCodeSurface
        ? "- Read and follow the managed `" + capabilityProfile.skillSlug + "` skill before the first authoring operation."
        : "- Read and follow the managed `convertigo-studio` routing skill before the first authoring operation, then read only the selected capability pack's specialist guidance.");
    }
    promptParts.push("- Prefer Convertigo source objects and MCP operations. Do not edit generated folders such as _private/ionic, _private/svelte, DisplayObjects, dist, build outputs, or generated runtime artifacts.");
    promptParts.push("- If the user asks for advice only, answer without modifying the project.");
    promptParts.push(isNoCodeSurface ? "- Use the NoCode capability's own validation workflow." : "- For UI clicks, button presses, and visual checks, prepare or reuse the viewer through the selected capability pack, then use the managed Playwright MCP attached to the Studio JxBrowser endpoint.");
    promptParts.push("- If the managed Playwright/browser-control tools are unavailable, blank after readiness, or attached elsewhere, report the configuration problem. Do not use PowerShell, UIAutomation, computer-use, raw CDP, Node scripts, a separate browser, a new tab, or generic OS-level clicks as a workaround.");
    promptParts.push("- If you modify a project, validate with the available Convertigo tools before claiming completion, then summarize the concrete changes.");
    promptParts.push("- Always finish with a concise but useful final summary in the user's language. Never answer only that the task is done.");
    promptParts.push("- In the final summary, mention what changed, what was validated, and any remaining limitation or blocker. If nothing changed, explain what was checked and why.");
    promptParts.push("- Do not expose secrets, credentials, API keys, or private environment values.");
    promptParts.push("- If installation, credentials, network access, or permissions block the work, explain the blocker and the next action clearly.");
    if (uploadedFiles.length) {
      promptParts.push("");
      promptParts.push("User attachments:");
      promptParts.push("The user attached file metadata through Convertigo Assistant. Image attachments are usually screenshots or UI evidence; inspect the referenced local file/path when one is available before acting on visual issues.");
      promptParts.push("If this provider or bridge cannot access the binary image content, say it clearly and use the attachment metadata plus the user's description instead of pretending you saw the image.");
      for (var fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex++) {
        promptParts.push("- " + sequenceAttachmentLine(uploadedFiles[fileIndex], fileIndex));
      }
    }
    promptParts.push("");
    promptParts.push("User message:");
    promptParts.push(String(rawQuestion));
    return promptParts.join("\n");
  }

  C8O.assistantAgentBridge.sendMessageFromSequenceScope = function (scope) {
    var names = [
      "threadid", "provider", "bridgeBaseUrl", "mcpEndpoint", "workspaceRoot", "cwd",
      "vibeHome", "agentHome", "codexHome", "codexHomeScope", "homeScope",
      "agentProfile", "skillProfile", "assistantContext", "assistantSurface", "model",
      "bypassApprovalsAndSandbox", "sandbox", "targetProject", "projectName", "userId",
      "install", "installCodex", "installVibe", "codexPath", "nodeVersion", "nodeDir",
      "npmPath", "allowNodeDownload", "codexPackage", "codexVersion", "codexInstallMethod",
      "codexInstallTimeoutMs", "forceCodexInstall", "forceVibeInstall", "forcePythonInstall",
      "allowPythonDownload", "mcpSkillsSourceDir", "skipSkillsInstall", "agentRevealMode",
      "browserDebugUrl", "browserDevToolsJsonUrl", "browserDevToolsWebSocketUrl",
      "playwrightCdpEndpoint", "viewerCdpEndpoint", "playwrightMcpEndpoint", "AIFiles"
    ];
    var options = {};
    for (var i = 0; i < names.length; i++) {
      options[names[i]] = sequenceScopeValue(scope, names[i]);
    }
    var rawQuestion = sequenceScopeValue(scope, "Question");
    options.rawUserQuestion = rawQuestion;
    options.userQuestion = rawQuestion;
    options.Question = buildSequencePrompt(rawQuestion, options);
    return C8O.assistantAgentBridge.sendMessage(options);
  };

  C8O.assistantAgentBridge.sendMessage = function (options) {
    options = optionsWithRequestFallbacks(options || {});
    var question = enrichNoCodePrompt(String(options.Question || options.question || ""), options);
    var rawUserQuestion = trim(options.rawUserQuestion || options.userQuestion || extractUserMessage(question));
    options.Question = question;
    if (!rawUserQuestion.length) {
      return {
        ok: false,
        status: "failed",
        error: {
          message: "Question is required"
        }
      };
    }

    var threadid = normalizeThreadId(options.threadid);
    var state = threadid.length ? readState(threadid) : null;
    if (state === null && !threadid.length && !trim(options.provider || options.agentProvider).length) {
      return {
        ok: true,
        id: "",
        object: "agent.run",
        status: "agent_selection_required",
        threadid: "",
        setupRequired: false,
        requiresAgentSelection: true,
        canInstall: false,
        AIData: {
          type: "agent",
          threadid: "",
          explanation: "",
          progress: "",
          setupRequired: false,
          setup: null,
          warnings: [],
          messages: []
        },
        state: null
      };
    }
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    var previousMcpEndpoint = trim(state.mcpEndpoint);
    var requestedMcpEndpoint = trim(options.mcpEndpoint);
    var mcpEndpointChanged = previousMcpEndpoint.length > 0 &&
      requestedMcpEndpoint.length > 0 &&
      previousMcpEndpoint !== requestedMcpEndpoint;
    options.establishedAgentFollowup = trim(state.externalSessionId).length > 0 && !mcpEndpointChanged;
    if (requestedMcpEndpoint.length) {
      state.mcpEndpoint = requestedMcpEndpoint;
    }
    clearCancellationRequested(state.threadid);
    if (trim(options.model || options.agentModel).length) {
      state.model = normalizeModel(state.provider, options.model || options.agentModel);
    } else if (!trim(state.model).length) {
      state.model = normalizeModel(state.provider, "");
    }
    if (trim(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort).length) {
      state.reasoningEffort = normalizeReasoningEffort(options.reasoningEffort || options.reasoningLevel || options.modelReasoningEffort);
    }
    if (trim(options.serviceTier || options.speedTier).length) {
      state.serviceTier = trim(options.serviceTier || options.speedTier);
    }
    state.status = "starting";
    state.answer = "";
    state.answerIsFinal = false;
    state.error = "";
    state.warnings = [];
    state.readErrors = 0;
    state.progressLog = "";
    state.progressEvents = [];
    state.lastProgressLine = "";
    state.setupRequired = false;
    state.setupReport = null;
    state.userQuestion = rawUserQuestion;
    if (!trim(state.title).length) {
      state.title = conversationTitleFromText(state.userQuestion || question);
    }
    var explicitLanguage = normalizeAssistantLanguage(options.language || options.locale || options.assistantLanguage);
    var detectedLanguage = detectLanguage(state.userQuestion || question);
    if (explicitLanguage.length) {
      state.language = explicitLanguage;
    } else if (!trim(state.language).length || detectedLanguage === "fr") {
      state.language = detectedLanguage;
    }
    var currentProject = trim(options.targetProject || options.projectName || options.projectId);
    if (currentProject.length) {
      state.primaryProject = state.primaryProject || currentProject;
      state.projectId = currentProject;
      state.projectNames = addArrayValue(state.projectNames, currentProject);
    }
    enrichViewerDebugOptions(options, state);
    if (trim(options.rawUserQuestion).length) {
      question = enrichNoCodePrompt(buildSequencePrompt(options.rawUserQuestion, options), options);
      options.Question = question;
    }
    var runProvider = normalizeProvider(state.provider);
    var runInstallRequested = shouldInstallForRun(options, runProvider);
    appendProgress(state, lang(state).starting);
    if (shouldShowAgentPreparingProgress(state, options, runProvider, runInstallRequested)) {
      appendProgress(state, lang(state).agentPreparing);
    }
    state.updatedAt = now();
    saveState(state);
    setStateBuffer(state);

    try {
      var provider = runProvider;
      var startSequence = provider === "codex" ? "agent_codex_start" : "agent_vibe_start";
      var promptSequence = provider === "codex" ? "agent_codex_prompt" : "agent_vibe_prompt";
      var installRequested = runInstallRequested;
      if (provider !== "codex") {
        var setupInfo = callAgentSetup(state, options, installRequested);
        var setup = setupInfo.result || {};
        if (setup.ok === false) {
          if (!installRequested && trim(setup.status).toLowerCase() === "missing") {
            state.status = "setup_required";
            state.setupRequired = true;
            state.setupReport = publicSetupReport(setup);
            state.answer = setupRequiredAnswer(state, setup);
            state.answerIsFinal = true;
            state.runid = makeRunId("setup");
            appendTranscript(state, "user", state.userQuestion || question);
            appendTranscript(state, "assistant", state.answer);
            appendProgress(state, lang(state).setupRequired);
            state.updatedAt = now();
            saveState(state);
            setStateBuffer(state);
            return {
              ok: false,
              id: state.runid,
              object: "agent.run",
              status: "setup_required",
              threadid: state.threadid,
              setupRequired: true,
              canInstall: true,
              setup: state.setupReport,
              AIData: responseForState(state).AIData,
              state: publicState(state)
            };
          }
          throw new Error(setup.error || setupInfo.sequence + " failed");
        }
        state.setupRequired = false;
        state.setupReport = publicSetupReport(setup);
      } else {
        state.setupRequired = false;
        state.setupReport = null;
      }
      if (cancellationRequested(state.threadid)) {
        return cancelledRunResponse(state);
      }
      if (provider === "codex" && codexViewerSessionNeedsFreshThread(options, state)) {
        clearCodexExternalSession(state);
      }

      var startPayload = agentStartPayload(state, options, provider, installRequested);
      var promptPayload = provider === "codex" ? {
        handle: state.handle,
        prompt: question,
        codexThreadId: state.externalSessionId || "",
        model: state.model || "",
        reasoningEffort: state.reasoningEffort || "",
        serviceTier: state.serviceTier || "",
        browserDebugUrl: trim(options.browserDebugUrl),
        browserDevToolsJsonUrl: trim(options.browserDevToolsJsonUrl),
        browserDevToolsWebSocketUrl: trim(options.browserDevToolsWebSocketUrl),
        playwrightCdpEndpoint: trim(options.playwrightCdpEndpoint || options.viewerCdpEndpoint),
        playwrightMcpEndpoint: trim(options.playwrightMcpEndpoint),
        viewerCdpEndpoint: trim(options.viewerCdpEndpoint),
        bypassApprovalsAndSandbox: typeof options.bypassApprovalsAndSandbox === "undefined" ? "true" : options.bypassApprovalsAndSandbox,
        sandbox: trim(options.sandbox),
        agentRevealMode: revealModeOption(options)
      } : {
        handle: state.handle,
        prompt: question,
        model: state.model || "",
        agentRevealMode: revealModeOption(options),
        waitForCompletion: "false"
      };
      var prompt = null;
      if (provider === "codex" && trim(state.externalSessionId).length) {
        prompt = bridgeCall(state, promptSequence, promptPayload, 70000);
        if (prompt.ok === false && codexPromptRequiresStart(prompt)) {
          if (existingViewerCdpEndpoint(options).length) {
            clearCodexExternalSession(state);
            promptPayload.codexThreadId = "";
          }
          prompt = null;
        } else if (prompt.ok === false) {
          throw new Error(prompt.error || promptSequence + " failed");
        } else {
          rememberCodexSessionFromResult(state, prompt);
        }
      }
      if (prompt === null) {
        var start = bridgeCall(state, startSequence, startPayload, 90000);
        if (start.ok === false) {
          throw new Error(start.error || startSequence + " failed");
        }
        if (provider === "codex" && start.setup) {
          state.setupReport = publicSetupReport(start.setup);
        }
        if (provider === "vibe" && start.state) {
          state.model = trim(start.state.model) || state.model;
          state.reasoningEffort = normalizeReasoningEffort(start.state.reasoningEffort) || state.reasoningEffort;
        }
        rememberCodexSessionFromResult(state, start);
        var startedHome = start.home || (start.state && start.state.home) || (start.setup && start.setup.setup && start.setup.setup.home);
        if (provider === "codex" && startedHome && trim(startedHome.path).length) {
          state.codexHome = sanitizeCodexHome(startedHome.path);
          state.agentHome = "";
          state.vibeHome = "";
        }
        if (cancellationRequested(state.threadid)) {
          try {
            bridgeCall(state, provider === "codex" ? "agent_codex_close" : "agent_vibe_close", {
              handle: state.handle
            }, 15000);
          } catch (_ignoreCloseAfterStartCancel) {}
          return cancelledRunResponse(state);
        }
        if (provider === "codex") {
          promptPayload.codexThreadId = state.externalSessionId || "";
        }
        prompt = bridgeCall(state, promptSequence, promptPayload, 70000);
      }
      if (prompt.ok === false) {
        throw new Error(prompt.error || promptSequence + " failed");
      }
      if (provider === "codex") {
        rememberCodexSessionFromResult(state, prompt);
      }
      if (cancellationRequested(state.threadid)) {
        try {
          bridgeCall(state, provider === "codex" ? "agent_codex_close" : "agent_vibe_close", {
            handle: state.handle
          }, 15000);
        } catch (_ignoreCloseAfterPromptCancel) {}
        return cancelledRunResponse(state);
      }

      state.status = "in_progress";
      state.runid = makeRunId(prompt.requestId);
      state.cursor = typeof prompt.cursor !== "undefined" ? Number(prompt.cursor) : 0;
      appendTranscript(state, "user", state.userQuestion || question);
      appendProgress(state, lang(state).thinking);
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);

      return {
        ok: true,
        id: state.runid,
        object: "agent.run",
        status: "queued",
        threadid: state.threadid,
        state: publicState(state)
      };
    } catch (e) {
      if (cancellationRequested(state.threadid)) {
        return cancelledRunResponse(state);
      }
      if (recoverableBridgeError(e)) {
        state.status = "in_progress";
        state.runid = state.runid || makeRunId("pending");
        state.cursor = Number(state.cursor || 0);
        appendTranscript(state, "user", state.userQuestion || question);
        appendProgress(state, lang(state).bridgeStateRecover);
        state.updatedAt = now();
        saveState(state);
        setStateBuffer(state);
        return {
          ok: true,
          id: state.runid,
          object: "agent.run",
          status: "queued",
          threadid: state.threadid,
          state: publicState(state)
        };
      }
      state.status = "failed";
      if (provider === "codex" && isCodexAuthenticationError(String(e))) {
        state.error = lang(state).codexAuthExpired;
        state.setupRequired = true;
        state.setupReport = {
          ok: false,
          status: "authentication_required",
          authentication: {
            configured: false,
            status: "expired",
            action: "codex_login"
          }
        };
      } else {
        state.error = String(e);
      }
      state.answer = state.error;
      state.answerIsFinal = true;
      appendTranscript(state, "user", state.userQuestion || question);
      appendTranscript(state, "assistant", state.answer);
      state.answerTranscriptRunid = state.runid;
      appendProgress(state, lang(state).startFailed);
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);
      return {
        ok: false,
        id: state.runid || "",
        object: "agent.run",
        status: "failed",
        threadid: state.threadid,
        setupRequired: state.setupRequired === true,
        setup: state.setupReport,
        error: {
          message: state.error
        },
        state: publicState(state)
      };
    }
  };

  C8O.assistantAgentBridge.readResponse = function (options) {
    options = options || {};
    var threadid = normalizeThreadId(options.threadid);
    var state = threadid.length ? readState(threadid) : null;
    if (state === null) {
      if (!threadid.length) {
        return {
          ok: false,
          status: "failed",
          error: {
            message: "Unknown agent conversation"
          }
        };
      }
      state = recoverState(options, threadid);
    }
    state = ensureState(state);
    if (!isTerminalStatus(state.status) && normalizeProvider(state.provider) === "codex" && trim(state.answer).length && state.answerIsFinal !== true) {
      state.answer = "";
    }
    if (state.status === "completed" || state.status === "failed" || state.status === "cancelled" || state.status === "closed" || state.status === "deleted") {
      if (state.status === "completed") {
        if (!trim(state.answer).length) {
          state.answer = completedFallbackAnswer(state);
          state.answerIsFinal = true;
          saveState(state);
        } else if (answerLooksIncomplete(state, state.answer)) {
          state.answer = finalAnswerFromProgress(state) || incompleteFinalAnswer(state);
          state.answerIsFinal = true;
          saveState(state);
        }
      }
      setStateBuffer(state);
      return responseForState(state);
    }

    try {
      var events = bridgeCall(state, "agent_events", {
        handle: state.handle,
        cursor: String(state.cursor || 0),
        limit: String(intValue(options.limit, 100, 1, 500)),
        waitMs: String(intValue(options.waitMs, DEFAULT_EVENT_WAIT_MS, 0, 30000))
      }, 45000);
      if (events && events.ok === false) {
        var bridgeStatus = trim(events.status).toLowerCase();
        if (bridgeStatus === "not_found") {
          if (trim(state.answer).length) {
            state.status = "completed";
            state.answerIsFinal = true;
          } else if (keepRunAliveAfterBridgeReadFailure(state, lang(state).bridgeStateRecover)) {
            state.updatedAt = now();
            saveState(state);
            setStateBuffer(state);
            return responseForState(state);
          } else {
            state.status = "failed";
            state.error = bridgeProcessLostMessage(state, events && events.state);
            state.answer = state.error;
            state.answerIsFinal = true;
            appendProgress(state, state.error);
          }
          state.updatedAt = now();
          saveState(state);
          setStateBuffer(state);
          return responseForState(state);
        }
        throw new Error(events.error || ("agent_events " + (bridgeStatus || "failed")));
      }
      state.readErrors = 0;
      var list = events.events || [];
      for (var i = 0; i < list.length; i++) {
        var event = list[i] || {};
        var type = String(event.type || "");
        var data = event.data || {};
        if (type === "session/update") {
          if (data.threadId || data.sessionId) {
            state.externalSessionId = String(data.threadId || data.sessionId);
          }
        } else if (type === "progress/message" || type === "status/message") {
          appendProgress(state, eventText(data));
        } else if (type === "progress/chunk") {
          appendProgressChunk(state, eventText(data));
        } else if (type === "answer/chunk") {
          if (codexAnswerChunkIsProgress(state, data)) {
            appendProgressChunk(state, eventText(data));
          } else {
            markProgressEventsIdle(state);
            appendAnswerChunk(state, eventText(data));
            state.answerIsFinal = true;
          }
        } else if (type === "reasoning/chunk") {
          if (!state.answer.length) {
            appendActivityEvent(state, lang(state).thinking, true);
            appendProgressLine(state, lang(state).thinking);
          }
        } else if (type === "tool/start" || type === "tool/update") {
          var toolStatus = eventToolStatus(data);
          rememberProjectFromToolEvent(state, data);
          appendToolEvent(state, event, data, type);
          if (toolStatus === "failed" || toolStatus === "error") {
            appendProgressLine(state, lang(state).toolRetry);
            state.warnings.push({
              type: type,
              title: eventToolTitle(event, data),
              status: toolStatus
            });
          } else if (type === "tool/start") {
            appendProgressLine(state, progressTextForTool(state, eventToolTitle(event, data)));
          } else if (toolStatus === "completed" || toolStatus === "complete" || toolStatus === "success" || toolStatus === "succeeded") {
            state.lastStatusText = progressTextForTool(state, eventToolTitle(event, data));
          }
        } else if (type === "turn/end") {
          markProgressEventsIdle(state);
          state.status = "completed";
          state.error = "";
          if (!trim(state.answer).length) {
            state.answer = completedFallbackAnswer(state);
            state.answerIsFinal = true;
          } else if (answerLooksIncomplete(state, state.answer)) {
            state.answer = finalAnswerFromProgress(state) || incompleteFinalAnswer(state);
            state.answerIsFinal = true;
          }
          if (state.answerTranscriptRunid !== state.runid) {
            appendTranscript(state, "assistant", state.answer);
            state.answerTranscriptRunid = state.runid;
          }
        } else if (type === "turn/error" || type === "acp/response_error" || type === "error") {
          state.status = "failed";
          state.error = userFacingAgentError(state, data);
          if (normalizeProvider(state.provider) === "codex" && isCodexAuthenticationError(data)) {
            state.setupRequired = true;
            state.setupReport = {
              ok: false,
              status: "authentication_required",
              authentication: {
                configured: false,
                status: "expired",
                action: "codex_login"
              }
            };
          }
          state.answer = state.error;
          state.answerIsFinal = true;
          state.lastStatusText = state.error;
          if (state.answerTranscriptRunid !== state.runid) {
            appendTranscript(state, "assistant", state.answer);
            state.answerTranscriptRunid = state.runid;
          }
        } else if (type === "system/closed" && state.status !== "completed") {
          if (trim(state.answer).length) {
            state.status = "completed";
            state.answerIsFinal = true;
            appendProgress(state, lang(state).closedAfterAnswer);
          } else {
            state.status = "failed";
            state.error = lang(state).closedEarly;
            appendProgress(state, state.error);
          }
        }
      }
      state.cursor = typeof events.nextCursor !== "undefined" ? Number(events.nextCursor) : state.cursor;
      var bridgeState = events.state || {};
      var bridgeStatus = trim(bridgeState.status).toLowerCase();
      if (state.status !== "completed" && state.status !== "failed" && !list.length && bridgeState.alive !== true && (bridgeStatus === "exited" || bridgeStatus === "closed" || bridgeStatus === "error")) {
        if (trim(state.answer).length) {
          state.status = "completed";
          state.answerIsFinal = true;
        } else if (keepRunAliveAfterBridgeReadFailure(state, lang(state).bridgeStateRecover)) {
          state.status = "in_progress";
        } else {
          state.status = "failed";
          state.error = bridgeProcessLostMessage(state, bridgeState);
          state.answer = state.error;
          state.answerIsFinal = true;
          appendProgress(state, state.error);
          appendTranscript(state, "assistant", state.answer);
          state.answerTranscriptRunid = state.runid;
        }
      }
      if (state.status !== "completed" && state.status !== "failed") {
        state.status = "in_progress";
      }
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);
      return responseForState(state);
    } catch (e) {
      state.error = String(e);
      if (keepRunAliveAfterBridgeReadFailure(state, lang(state).bridgeReadError)) {
        state.status = "in_progress";
      } else if (trim(state.answer).length) {
        state.status = "completed";
      } else {
        state.status = "failed";
      }
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);
      return responseForState(state);
    }
  };

  C8O.assistantAgentBridge.listConversations = function (options) {
    options = options || {};
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var provider = trim(options.provider).length ? normalizeProvider(options.provider) : "all";
    var root = provider === "all" ? new File(workspaceRoot, "agents") : conversationsRoot(workspaceRoot, userKey, provider);
    var includeDeleted = boolValue(options.includeDeleted, false);
    var projectFilter = trim(options.targetProject || options.projectName || options.projectId);
    var conversations = publicConversations(workspaceRoot, userKey, projectFilter, includeDeleted, provider, normalizeSkillProfile(options));
    return {
      ok: true,
      provider: provider,
      userKey: userKey,
      workspaceRoot: workspaceRoot,
      conversationsRoot: filePath(root),
      conversations: conversations
    };
  };

  C8O.assistantAgentBridge.resumeConversation = function (options) {
    options = options || {};
    var threadid = normalizeConversationId(options.threadid || options.conversationId);
    if (!threadid.length) {
      return {
        ok: false,
        status: "not_found",
        error: {
          message: "conversationId is required"
        }
      };
    }
    var state = readState(threadid);
    if (state === null) {
      var workspaceRoot = resolveWorkspaceRoot(options);
      var userKey = normalizeUserKey(options.userId);
      var record = readConversationRecord(workspaceRoot, userKey, threadid, options.provider);
      if (!record) {
        return {
          ok: false,
          status: "not_found",
          threadid: threadid,
          error: {
            message: "Conversation not found"
          }
        };
      }
      state = createState(options);
    }
    state = ensureState(state);
    state.status = state.status === "deleted" ? "deleted" : (state.status || "created");
    state.updatedAt = now();
    saveState(state);
    var prewarming = prewarmCodexAppServer(state, options);
    return {
      ok: state.status !== "deleted",
      id: state.threadid,
      object: "agent.conversation",
      provider: state.provider,
      model: state.model || "",
      reasoningEffort: state.reasoningEffort || "",
      serviceTier: state.serviceTier || "",
      status: state.status,
      prewarming: prewarming,
      threadid: state.threadid,
      state: publicState(state),
      conversation: publicConversation(readJsonFile(new File(state.conversationFile)) || {}),
      conversations: publicConversations(state.workspaceRoot, state.userKey, "", false, "all", normalizeSkillProfile(state)),
      AIData: conversationAIData(state, options.historyLimit)
    };
  };

  C8O.assistantAgentBridge.deleteConversation = function (options) {
    options = options || {};
    var threadid = normalizeConversationId(options.threadid || options.conversationId);
    if (!threadid.length) {
      return {
        ok: false,
        status: "not_found",
        error: {
          message: "conversationId is required"
        }
      };
    }
    var state = readState(threadid);
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    var oldStatus = state.status;
    var oldUpdatedAt = state.updatedAt;
    var conversationsBeforeDelete = publicConversations(state.workspaceRoot, state.userKey, "", false, "all", normalizeSkillProfile(state));
    markCancellationRequested(threadid);
    var bridge = {};
    var cleanup = {};
    try {
      bridge = bridgeCall(state, normalizeProvider(state.provider) === "codex" ? "agent_codex_close" : "agent_vibe_close", {
        handle: state.handle
      }, 15000);
    } catch (e) {
      bridge = {
        ok: false,
        error: String(e)
      };
    }
    var dir = new File(state.conversationDir);
    var wasListed = false;
    for (var beforeIndex = 0; beforeIndex < conversationsBeforeDelete.length; beforeIndex++) {
      if (conversationsBeforeDelete[beforeIndex].conversationId === threadid) {
        wasListed = true;
        break;
      }
    }
    var dirExistsBeforeDelete = dir.exists();
    var deleted = dirExistsBeforeDelete ? deleteRecursively(dir) : false;
    var remainingConversations = conversationsBeforeDelete;
    if (deleted) {
      state.status = "deleted";
      state.updatedAt = now();
      removeState(threadid);
      remainingConversations = publicConversations(state.workspaceRoot, state.userKey, "", false, "all", normalizeSkillProfile(state));
      var stillListed = false;
      for (var afterIndex = 0; afterIndex < remainingConversations.length; afterIndex++) {
        if (remainingConversations[afterIndex].conversationId === threadid) {
          stillListed = true;
          break;
        }
      }
      if (stillListed) {
        deleted = false;
        remainingConversations = conversationsBeforeDelete;
        state.status = oldStatus;
        state.updatedAt = oldUpdatedAt || now();
        try {
          saveState(state);
        } catch (_ignoreDeleteFailureRestore) {}
      } else {
        try {
          cleanup = bridgeCall(state, "agent_cleanup_storage", {
            workspaceRoot: state.workspaceRoot,
            userId: state.userId || "",
            userKey: state.userKey || "",
            conversationId: state.conversationId || state.threadid || threadid,
            threadid: state.threadid || threadid,
            handle: state.handle || threadid,
            externalSessionId: state.externalSessionId || "",
            force: "true"
          }, 30000);
        } catch (cleanupError) {
          cleanup = {
            ok: false,
            status: "cleanup_failed",
            error: String(cleanupError)
          };
        }
        setBuffer("", "");
      }
    } else {
      if (!wasListed && !dir.exists()) {
        remainingConversations = publicConversations(state.workspaceRoot, state.userKey, "", false, "all", normalizeSkillProfile(state));
      }
      state.status = oldStatus;
      state.updatedAt = oldUpdatedAt || now();
      try {
        saveState(state);
      } catch (_ignoreDeleteFailureState) {}
    }
    return {
      ok: deleted,
      status: deleted ? "deleted" : "delete_failed",
      threadid: threadid,
      conversationDir: filePath(dir),
      conversations: remainingConversations,
      bridge: bridge,
      cleanup: cleanup,
      error: deleted ? undefined : {
        message: "Conversation directory could not be deleted"
      }
    };
  };

  C8O.assistantAgentBridge.renameConversation = function (options) {
    options = options || {};
    var threadid = normalizeConversationId(options.threadid || options.conversationId);
    var title = conversationTitleFromText(options.title || options.name || "");
    if (!threadid.length) {
      return {
        ok: false,
        status: "not_found",
        error: {
          message: "conversationId is required"
        }
      };
    }
    if (!title.length) {
      return {
        ok: false,
        status: "invalid_title",
        threadid: threadid,
        error: {
          message: "title is required"
        }
      };
    }
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var provider = trim(options.provider).length ? normalizeProvider(options.provider) : "all";
    var state = readState(threadid);
    var recordFile = conversationRecordFileFor(workspaceRoot, userKey, threadid, provider);
    var record = recordFile ? readJsonFile(recordFile) : null;
    if (state !== null) {
      state = ensureState(state);
      state.title = title;
      state.updatedAt = now();
      saveState(state);
      writeConversationRecord(state);
      recordFile = conversationRecordFileFor(state.workspaceRoot, state.userKey, threadid, state.provider);
      record = recordFile ? readJsonFile(recordFile) : null;
    } else if (record && record.deleted !== true) {
      record.title = title;
      record.updatedAt = now();
      writeJsonFile(recordFile, record);
    } else {
      return {
        ok: false,
        status: "not_found",
        threadid: threadid,
        error: {
          message: "Conversation not found"
        }
      };
    }
    var listWorkspaceRoot = state ? state.workspaceRoot : workspaceRoot;
    var listUserKey = state ? state.userKey : userKey;
    var listSkillProfile = state ? normalizeSkillProfile(state) : normalizeSkillProfile(options);
    return {
      ok: true,
      status: "renamed",
      threadid: threadid,
      title: title,
      conversation: publicConversation(record || readJsonFile(recordFile) || {}),
      conversations: publicConversations(listWorkspaceRoot, listUserKey, "", false, "all", listSkillProfile)
    };
  };

  C8O.assistantAgentBridge.closeConversation = function (options) {
    options = options || {};
    var threadid = normalizeThreadId(options.threadid);
    if (!threadid.length) {
      var workspaceRoot = resolveWorkspaceRoot(options);
      var userKey = normalizeUserKey(options.userId);
      var projectFilter = trim(options.targetProject || options.projectName || options.projectId);
      var providerFilter = trim(options.provider || options.agentProvider);
      var latest = latestActiveConversationRecord(workspaceRoot, userKey, projectFilter, providerFilter, normalizeSkillProfile(options));
      if (latest) {
        threadid = normalizeConversationId(latest.conversationId || latest.threadid);
        options.threadid = threadid;
        if (!trim(options.provider || options.agentProvider).length && latest.provider) {
          options.provider = latest.provider;
        }
      }
    }
    var state = threadid.length ? readState(threadid) : null;
    if (state === null) {
      if (threadid.length) {
        var workspaceRoot = resolveWorkspaceRoot(options);
        var userKey = normalizeUserKey(options.userId);
        var record = readConversationRecord(workspaceRoot, userKey, threadid, options.provider);
        if (!record) {
          return {
            ok: true,
            status: "not_found",
            threadid: threadid
          };
        }
        options.threadid = threadid;
        if (!trim(options.provider || options.agentProvider).length && record.provider) {
          options.provider = record.provider;
        }
        state = createState(options);
      } else {
        return {
          ok: true,
          status: "not_found",
          threadid: threadid
        };
      }
    }
    state = ensureState(state);
    markCancellationRequested(threadid);
    var bridge = {};
    try {
      bridge = bridgeCall(state, normalizeProvider(state.provider) === "codex" ? "agent_codex_close" : "agent_vibe_close", {
        handle: state.handle
      }, 15000);
    } catch (e) {
      bridge = {
        ok: false,
        error: String(e)
      };
    }
    state.status = "cancelled";
    state.updatedAt = now();
    saveState(state);
    removeState(threadid);
    setBuffer("", "");
    return {
      ok: bridge.ok !== false,
      status: bridge.status || "closed",
      threadid: threadid,
      conversation: publicConversation(readJsonFile(new File(state.conversationFile)) || {}),
      bridge: bridge
    };
  };
}());
