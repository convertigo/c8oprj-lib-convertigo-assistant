if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantAgentBridge = C8O.assistantAgentBridge || {};

(function () {
  var DEFAULT_BRIDGE_URL = "http://localhost:18082/convertigo/projects/ConvertigoAgentBridge/.json";
  var DEFAULT_MCP_ENDPOINT = "http://localhost:18082/convertigo/api/mcp";
  var STATE_PREFIX = "ConvertigoAssistant.agentConversation.";
  var BUFFER_KEY = "C8OAiAssistantBuffer";

  var File = Packages.java.io.File;
  var BufferedReader = Packages.java.io.BufferedReader;
  var InputStreamReader = Packages.java.io.InputStreamReader;
  var URL = Packages.java.net.URL;
  var URLEncoder = Packages.java.net.URLEncoder;
  var UUID = Packages.java.util.UUID;
  var System = Packages.java.lang.System;
  var MessageDigest = Packages.java.security.MessageDigest;
  var Files = Packages.java.nio.file.Files;
  var StandardOpenOption = Packages.java.nio.file.StandardOpenOption;
  var StandardCharsets = Packages.java.nio.charset.StandardCharsets;

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

  function postForm(urlText, params, timeoutMs) {
    var conn = new URL(urlText).openConnection();
    conn.setRequestMethod("POST");
    conn.setConnectTimeout(timeoutMs);
    conn.setReadTimeout(timeoutMs);
    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    conn.setRequestProperty("Accept", "application/json");
    conn.setDoOutput(true);

    var body = encodeForm(params);
    var bytes = new java.lang.String(body).getBytes(StandardCharsets.UTF_8);
    var out = conn.getOutputStream();
    out.write(bytes);
    out.close();

    var code = conn.getResponseCode();
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
    var response = postForm(trim(options.bridgeBaseUrl) || DEFAULT_BRIDGE_URL, payload, timeoutMs || 70000);
    return response && typeof response.result !== "undefined" ? response.result : response;
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

  function normalizeConversationId(value) {
    var text = normalizeThreadId(value);
    return text.length ? safePathPart(text) : "";
  }

  function normalizeUserKey(value) {
    var text = trim(value);
    if (!text.length || text.toLowerCase() === "studio") {
      return "studio";
    }
    return "u-" + hashShort(text);
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
    return normalizeProvider(provider) === "vibe" ? "vibe-thinking" : "";
  }

  function normalizeModel(provider, value) {
    var model = trim(value);
    var lower = model.toLowerCase();
    if (!model.length || lower === "default" || lower === "auto") {
      return defaultModelForProvider(provider);
    }
    return model;
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
    var providers = providerSearchList(provider);
    for (var i = 0; i < providers.length; i++) {
      var file = conversationRecordFile(conversationDirectory(workspaceRoot, userKey, conversationId, providers[i]));
      var record = readJsonFile(file);
      if (record && record.deleted !== true) {
        return record;
      }
    }
    return null;
  }

  function publicConversation(record) {
    return {
      conversationId: String(record.conversationId || record.threadid || ""),
      provider: String(record.provider || "vibe"),
      userKey: String(record.userKey || "studio"),
      status: String(record.status || ""),
      primaryProject: String(record.primaryProject || record.projectId || ""),
      projectNames: record.projectNames || [],
      createdAt: Number(record.createdAt || 0),
      updatedAt: Number(record.updatedAt || 0),
      lastCursor: Number(record.lastCursor || 0),
      lastRunId: String(record.lastRunId || ""),
      lastAnswerPreview: String(record.lastAnswerPreview || ""),
      progress: String(record.progress || ""),
      phase: String(record.phase || ""),
      model: String(record.model || ""),
      warnings: record.warnings || [],
      vibeHome: String(record.vibeHome || ""),
      agentHome: String(record.agentHome || record.vibeHome || ""),
      codexHome: normalizeProvider(record.provider) === "codex" ? String(record.codexHome || record.agentHome || record.vibeHome || "") : "",
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

  function conversationRecords(workspaceRoot, userKey, projectFilter, includeDeleted, provider) {
    var records = [];
    var filter = trim(projectFilter);
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

  function publicConversations(workspaceRoot, userKey, projectFilter, includeDeleted, provider) {
    var records = conversationRecords(workspaceRoot, userKey, projectFilter, includeDeleted, provider);
    var conversations = [];
    for (var i = 0; i < records.length; i++) {
      conversations.push(publicConversation(records[i]));
    }
    return conversations;
  }

  function latestConversationRecord(workspaceRoot, userKey, projectFilter, provider) {
    var records = conversationRecords(workspaceRoot, userKey, projectFilter, false, provider);
    for (var i = 0; i < records.length; i++) {
      if (conversationActivityScore(records[i]) > 1) {
        return records[i];
      }
    }
    return records.length ? records[0] : null;
  }

  function writeConversationRecord(state) {
    if (!state || !state.conversationFile) {
      return;
    }
    var answer = state.answerIsFinal === true || state.status === "completed" || state.status === "closed" ? String(state.answer || "") : "";
    var record = {
      version: 1,
      conversationId: state.conversationId || state.threadid,
      threadid: state.threadid,
      provider: state.provider || "vibe",
      userKey: state.userKey || "studio",
      handle: state.handle || state.threadid,
      status: state.status || "created",
      model: state.model || "",
      primaryProject: state.primaryProject || state.projectId || "",
      projectNames: state.projectNames || [],
      workspaceRoot: state.workspaceRoot || "",
      cwd: state.cwd || "",
      vibeHome: state.vibeHome || "",
      agentHome: state.agentHome || state.vibeHome || "",
      codexHome: normalizeProvider(state.provider) === "codex" ? state.agentHome || state.vibeHome || "" : "",
      conversationDir: state.conversationDir || "",
      externalSessionId: state.externalSessionId || "",
      createdAt: Number(state.createdAt || now()),
      updatedAt: Number(state.updatedAt || now()),
      lastCursor: Number(state.cursor || 0),
      lastRunId: String(state.runid || ""),
      lastAnswerPreview: answer.length > 500 ? answer.substring(0, 500) : answer,
      progress: String(state.progressLog || ""),
      phase: String(state.lastStatusText || ""),
      warnings: state.warnings || [],
      deleted: false
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
    return status === "completed" || status === "failed" || status === "cancelled" || status === "closed" || status === "deleted";
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
      state.cursor = Number(record.lastCursor || state.cursor || 0);
      state.runid = String(record.lastRunId || state.runid || "");
      state.externalSessionId = String(record.externalSessionId || state.externalSessionId || "");
      state.progressLog = String(record.progress || "");
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

  function readState(threadid) {
    var raw;
    try {
      raw = context.httpSession.getAttribute(stateKey(threadid));
      if (raw !== null && typeof raw !== "undefined") {
        if (typeof raw === "string") {
          return JSON.parse(String(raw));
        }
        return JSON.parse(String(raw));
      }
    } catch (_ignoreReadState) {}
    try {
      var storage = sharedStorage();
      if (storage !== null && storage.get) {
        raw = storage.get(stateKey(threadid));
        if (raw !== null && typeof raw !== "undefined" && trim(raw).length) {
          return JSON.parse(String(raw));
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
    var marker = "\nUser message:\n";
    var index = text.lastIndexOf(marker);
    if (index !== -1) {
      return trim(text.substring(index + marker.length));
    }
    return trim(text);
  }

  function detectLanguage(text) {
    var sample = (" " + String(text || "").toLowerCase() + " ");
    if (/[\u00e0\u00e2\u00e4\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00ff\u0153]/.test(sample)) {
      return "fr";
    }
    var frenchHits = 0;
    var words = [" je ", " tu ", " il ", " elle ", " nous ", " vous ", " les ", " des ", " une ", " pour ", " avec ", " dans ", " faut ", " projet ", " application ", " corrige ", " corriger ", " fonctionne "];
    for (var i = 0; i < words.length; i++) {
      if (sample.indexOf(words[i]) !== -1) {
        frenchHits++;
      }
    }
    return frenchHits >= 2 ? "fr" : "en";
  }

  var TRANSLATIONS = {
    fr: {
      starting: "Je pr\u00e9pare l'agent local.",
      thinking: "J'analyse la demande.",
      projectList: "Je v\u00e9rifie les projets disponibles.",
      inspect: "J'inspecte la structure Convertigo du projet.",
      apply: "J'applique une modification dans le projet.",
      rename: "Je renomme un objet Convertigo.",
      save: "Je sauvegarde le projet.",
      execute: "Je teste une s\u00e9quence ou une transaction.",
      logs: "Je consulte les logs pour comprendre le r\u00e9sultat.",
      builder: "Je relance l'application pour v\u00e9rifier l'\u00e9cran.",
      palette: "Je v\u00e9rifie les composants Convertigo disponibles.",
      tool: "J'utilise un outil Convertigo.",
      toolRetry: "Une tentative d'outil a \u00e9chou\u00e9, je cherche une autre piste.",
      closedAfterAnswer: "L'agent a termin\u00e9 sa r\u00e9ponse.",
      closedEarly: "L'agent s'est arr\u00eat\u00e9 avant d'avoir termin\u00e9.",
      completedNoAnswer: "J'ai termin\u00e9 le traitement.",
      completedIncomplete: "L'agent a termin\u00e9, mais sa r\u00e9ponse finale est incompl\u00e8te.",
      lastObservedAction: "Derni\u00e8re action observ\u00e9e : ",
      toolWarning: "Une tentative d'outil a \u00e9chou\u00e9 pendant le traitement.",
      bridgeReadError: "Je n'arrive pas \u00e0 lire le retour de l'agent local.",
      startFailed: "Je n'ai pas pu d\u00e9marrer l'agent local."
    },
    en: {
      starting: "I am preparing the local agent.",
      thinking: "I am analyzing the request.",
      projectList: "I am checking the available projects.",
      inspect: "I am inspecting the Convertigo project structure.",
      apply: "I am applying a change in the project.",
      rename: "I am renaming a Convertigo object.",
      save: "I am saving the project.",
      execute: "I am testing a sequence or transaction.",
      logs: "I am checking the logs to understand the result.",
      builder: "I am restarting the application to verify the screen.",
      palette: "I am checking the available Convertigo components.",
      tool: "I am using a Convertigo tool.",
      toolRetry: "A tool attempt failed, I am trying another path.",
      closedAfterAnswer: "The agent finished its response.",
      closedEarly: "The agent stopped before completion.",
      completedNoAnswer: "I have finished the task.",
      completedIncomplete: "The agent finished, but its final answer is incomplete.",
      lastObservedAction: "Last observed action: ",
      toolWarning: "A tool attempt failed during processing.",
      bridgeReadError: "I cannot read the local agent response.",
      startFailed: "I could not start the local agent."
    }
  };

  function lang(state) {
    var code = state && state.language === "fr" ? "fr" : "en";
    return TRANSLATIONS[code];
  }

  function progressTextForTool(state, title) {
    var text = String(title || "").toLowerCase();
    var t = lang(state);
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

  function appendProgress(state, text) {
    text = compactLine(text);
    if (!text.length) {
      return;
    }
    if (!state.progressLog) {
      state.progressLog = "";
    }
    if (state.lastProgressLine === text) {
      return;
    }
    var existing = "\n" + state.progressLog + "\n";
    if (existing.indexOf("\n" + text + "\n") !== -1) {
      return;
    }
    state.progressLog += (state.progressLog.length ? "\n" : "") + text;
    state.lastProgressLine = text;
    state.lastStatusText = text;
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
    if (text.indexOf("<tool_error>") !== -1 || text.indexOf("\"JsonResponse\"") !== -1) {
      return true;
    }
    if (!trim(state && state.progressLog).length) {
      return false;
    }
    var words = text.split(/\s+/);
    return text.length < 24 && words.length <= 3;
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

  function setStateBuffer(state) {
    setBuffer(displayContent(state), state.status, {
      phase: state.lastStatusText || "",
      progress: state.progressLog || "",
      warnings: state.warnings || []
    });
  }

  function eventToolTitle(event, data) {
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
    if (String(data.phase || "") === "commentary") {
      return true;
    }
    if (data.item && String(data.item.type || "").toLowerCase() === "agent_message") {
      return true;
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
    if (!state.vibeHome) {
      state.vibeHome = childPath(new File(state.conversationDir), homeLeafForProvider(state.provider));
    }
    state.agentHome = state.agentHome || state.vibeHome;
    if (!state.projectNames || typeof state.projectNames.length === "undefined") {
      state.projectNames = [];
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
    return refreshTerminalStateFromRecord(state);
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
    return state;
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
    var vibeHome = trim(options.vibeHome || options.agentHome || options.codexHome);
    if (!vibeHome.length) {
      vibeHome = record && trim(record.agentHome || record.vibeHome).length ? trim(record.agentHome || record.vibeHome) : childPath(conversationDir, homeLeafForProvider(provider));
    }
    var model = normalizeModel(provider, options.model || options.agentModel || (record && record.model));
    return {
      conversationId: threadid,
      threadid: threadid,
      handle: record && trim(record.handle).length ? trim(record.handle) : threadid,
      provider: provider,
      model: model,
      bridgeBaseUrl: trim(options.bridgeBaseUrl) || (record && trim(record.bridgeBaseUrl)) || DEFAULT_BRIDGE_URL,
      mcpEndpoint: trim(options.mcpEndpoint) || (record && trim(record.mcpEndpoint)) || DEFAULT_MCP_ENDPOINT,
      workspaceRoot: workspaceRoot,
      cwd: trim(options.cwd) || (record && trim(record.cwd)) || workspaceRoot,
      userKey: userKey,
      vibeHome: vibeHome,
      agentHome: vibeHome,
      conversationDir: filePath(conversationDir),
      conversationFile: filePath(conversationRecordFile(conversationDir)),
      transcriptFile: filePath(conversationTranscriptFile(conversationDir)),
      summaryFile: filePath(conversationSummaryFile(conversationDir)),
      projectId: primaryProject,
      primaryProject: primaryProject,
      projectNames: projectNames,
      userId: trim(options.userId),
      externalSessionId: record && trim(record.externalSessionId),
      language: detectLanguage(options.userQuestion || options.Question || ""),
      userQuestion: trim(options.userQuestion || extractUserMessage(options.Question || "")),
      status: record && trim(record.status).length ? trim(record.status) : "created",
      cursor: record && record.lastCursor ? Number(record.lastCursor) : 0,
      runid: record && record.lastRunId ? String(record.lastRunId) : "",
      answer: record && trim(record.status) === "completed" ? String(record.lastAnswerPreview || "") : "",
      answerIsFinal: record && trim(record.status) === "completed" && trim(record.lastAnswerPreview).length > 0,
      progressLog: record && record.progress ? String(record.progress) : "",
      lastProgressLine: "",
      lastStatusText: record && record.phase ? String(record.phase) : "",
      warnings: record && record.warnings ? record.warnings : [],
      readErrors: 0,
      error: "",
      createdAt: record && record.createdAt ? Number(record.createdAt) : now(),
      updatedAt: now()
    };
  }

  function publicState(state) {
    return {
      threadid: state.threadid,
      handle: state.handle,
      provider: state.provider,
      model: state.model || "",
      status: state.status,
      runid: state.runid,
      cursor: state.cursor,
      conversationId: state.conversationId || state.threadid,
      userKey: state.userKey || "studio",
      workspaceRoot: state.workspaceRoot || "",
      vibeHome: state.vibeHome,
      agentHome: state.agentHome || state.vibeHome || "",
      conversationDir: state.conversationDir || "",
      externalSessionId: state.externalSessionId || "",
      projectId: state.projectId,
      primaryProject: state.primaryProject || state.projectId || "",
      projectNames: state.projectNames || [],
      progress: state.progressLog || "",
      phase: state.lastStatusText || "",
      warnings: state.warnings || [],
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
      threadid: state.threadid,
      AIData: {
        type: "agent",
        threadid: state.threadid,
        explanation: state.answer || state.error || "",
        progress: state.progressLog || "",
        warnings: state.warnings || [],
        messages: responseMessages(state)
      },
      state: publicState(state)
    };
  }

  function credentialsEnv() {
    var env = readEnvFile(new File(new File(String(System.getProperty("user.home")), ".vibe"), ".env"));
    var selected = {};
    if (env.MISTRAL_API_KEY) {
      selected.MISTRAL_API_KEY = env.MISTRAL_API_KEY;
    }
    return selected;
  }

  C8O.assistantAgentBridge.createConversation = function (options) {
    options = options || {};
    var workspaceRoot = resolveWorkspaceRoot(options);
    var userKey = normalizeUserKey(options.userId);
    var provider = trim(options.provider).length ? normalizeProvider(options.provider) : "all";
    var requestedThreadId = normalizeThreadId(options.threadid);
    var resumedLatest = false;
    if (!requestedThreadId.length && !boolValue(options.forceNew, false)) {
      var latest = latestConversationRecord(workspaceRoot, userKey, trim(options.targetProject || options.projectName || options.projectId), provider);
      if (latest !== null) {
        requestedThreadId = normalizeConversationId(latest.conversationId || latest.threadid);
        options.threadid = requestedThreadId;
        resumedLatest = requestedThreadId.length > 0;
      }
    }
    var state = readState(requestedThreadId);
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    state.updatedAt = now();
    saveState(state);
    setBuffer("", "");
    return {
      ok: true,
      id: state.threadid,
      object: "agent.conversation",
      provider: state.provider,
      model: state.model || "",
      status: state.status,
      resumed: resumedLatest || requestedThreadId.length > 0,
      state: publicState(state),
      conversation: publicConversation(readJsonFile(new File(state.conversationFile)) || {}),
      conversations: publicConversations(state.workspaceRoot, state.userKey, state.primaryProject || state.projectId, false, "all"),
      AIData: conversationAIData(state, options.historyLimit)
    };
  };

  C8O.assistantAgentBridge.sendMessage = function (options) {
    options = options || {};
    var question = String(options.Question || options.question || "");
    if (!trim(question).length) {
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
    if (state === null) {
      state = createState(options);
    }
    state = ensureState(state);
    if (trim(options.model || options.agentModel).length) {
      state.model = normalizeModel(state.provider, options.model || options.agentModel);
    } else if (!trim(state.model).length) {
      state.model = normalizeModel(state.provider, "");
    }
    state.status = "starting";
    state.answer = "";
    state.answerIsFinal = false;
    state.error = "";
    state.warnings = [];
    state.readErrors = 0;
    state.progressLog = "";
    state.lastProgressLine = "";
    state.userQuestion = trim(options.userQuestion || extractUserMessage(question));
    state.language = detectLanguage(state.userQuestion || question);
    var currentProject = trim(options.targetProject || options.projectName || options.projectId);
    if (currentProject.length) {
      state.primaryProject = state.primaryProject || currentProject;
      state.projectId = currentProject;
      state.projectNames = addArrayValue(state.projectNames, currentProject);
    }
    appendProgress(state, lang(state).starting);
    state.updatedAt = now();
    saveState(state);
    setStateBuffer(state);

    try {
      var provider = normalizeProvider(state.provider);
      var setupSequence = provider === "codex" ? "agent_codex_setup" : "agent_vibe_setup";
      var startSequence = provider === "codex" ? "agent_codex_start" : "agent_vibe_start";
      var promptSequence = provider === "codex" ? "agent_codex_prompt" : "agent_vibe_prompt";
      var setupPayload = provider === "codex" ? {
        codexHome: trim(options.codexHome || options.agentHome),
        codexHomeScope: trim(options.codexHomeScope || options.homeScope),
        mcpEndpoint: state.mcpEndpoint,
        model: state.model || ""
      } : {
        install: "false",
        configure: "true",
        vibeHome: state.vibeHome,
        mcpEndpoint: state.mcpEndpoint,
        model: state.model || ""
      };
      var setup = bridgeCall(state, setupSequence, setupPayload, 70000);
      if (setup.ok === false) {
        throw new Error(setup.error || setupSequence + " failed");
      }

      var env = credentialsEnv();
      var startPayload = provider === "codex" ? {
        handle: state.handle,
        cwd: state.cwd,
        codexHome: trim(options.codexHome || options.agentHome),
        codexHomeScope: trim(options.codexHomeScope || options.homeScope),
        mcpEndpoint: state.mcpEndpoint,
        env: JSON.stringify(env),
        codexThreadId: state.externalSessionId || "",
        model: state.model || ""
      } : {
        handle: state.handle,
        cwd: state.cwd,
        vibeHome: state.vibeHome,
        mcpEndpoint: state.mcpEndpoint,
        model: state.model || "",
        env: JSON.stringify(env),
        requestTimeoutMs: "60000"
      };
      var start = bridgeCall(state, startSequence, startPayload, 90000);
      if (start.ok === false) {
        throw new Error(start.error || startSequence + " failed");
      }
      if (start.state && (start.state.codexThreadId || start.state.sessionId)) {
        state.externalSessionId = String(start.state.codexThreadId || start.state.sessionId);
      } else if (start.codexThreadId) {
        state.externalSessionId = String(start.codexThreadId);
      } else if (start.state && start.state.sessionId) {
        state.externalSessionId = String(start.state.sessionId);
      } else if (start.sessionId) {
        state.externalSessionId = String(start.sessionId);
      }
      if (provider === "codex" && start.home && trim(start.home.path).length) {
        state.agentHome = String(start.home.path);
        state.vibeHome = state.agentHome;
      }

      var promptPayload = provider === "codex" ? {
        handle: state.handle,
        prompt: question,
        codexThreadId: state.externalSessionId || "",
        model: state.model || "",
        bypassApprovalsAndSandbox: typeof options.bypassApprovalsAndSandbox === "undefined" ? "true" : options.bypassApprovalsAndSandbox,
        sandbox: trim(options.sandbox)
      } : {
        handle: state.handle,
        prompt: question,
        model: state.model || "",
        waitForCompletion: "false"
      };
      var prompt = bridgeCall(state, promptSequence, promptPayload, 70000);
      if (prompt.ok === false) {
        throw new Error(prompt.error || promptSequence + " failed");
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
      state.status = "failed";
      state.error = String(e);
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
        error: {
          message: String(e)
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
          state.answer = trim(state.progressLog).length ? incompleteFinalAnswer(state) : lang(state).completedNoAnswer;
          state.answerIsFinal = true;
          saveState(state);
        } else if (answerLooksIncomplete(state, state.answer)) {
          state.answer = incompleteFinalAnswer(state);
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
        waitMs: String(intValue(options.waitMs, 1000, 0, 30000))
      }, 45000);
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
        } else if (type === "answer/chunk") {
          if (codexAnswerChunkIsProgress(state, data)) {
            appendProgress(state, eventText(data));
          } else {
            state.answer += eventText(data);
            state.answerIsFinal = true;
          }
        } else if (type === "reasoning/chunk") {
          if (!state.answer.length) {
            appendProgress(state, lang(state).thinking);
          }
        } else if (type === "tool/start" || type === "tool/update") {
          var toolStatus = eventToolStatus(data);
          if (toolStatus === "failed" || toolStatus === "error") {
            appendProgress(state, lang(state).toolRetry);
            state.warnings.push({
              type: type,
              title: eventToolTitle(event, data),
              status: toolStatus
            });
          } else if (type === "tool/start") {
            appendProgress(state, progressTextForTool(state, eventToolTitle(event, data)));
          }
        } else if (type === "turn/end") {
          state.status = "completed";
          state.error = "";
          if (!trim(state.answer).length) {
            state.answer = lang(state).completedNoAnswer;
            state.answerIsFinal = true;
          } else if (answerLooksIncomplete(state, state.answer)) {
            state.answer = incompleteFinalAnswer(state);
            state.answerIsFinal = true;
          }
          if (state.answerTranscriptRunid !== state.runid) {
            appendTranscript(state, "assistant", state.answer);
            state.answerTranscriptRunid = state.runid;
          }
        } else if (type === "turn/error" || type === "acp/response_error" || type === "error") {
          state.status = "failed";
          state.error = JSON.stringify(data);
          appendProgress(state, lang(state).bridgeReadError);
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
      if (state.status !== "completed" && state.status !== "failed") {
        state.status = "in_progress";
      }
      state.updatedAt = now();
      saveState(state);
      setStateBuffer(state);
      return responseForState(state);
    } catch (e) {
      state.error = String(e);
      state.readErrors = Number(state.readErrors || 0) + 1;
      appendProgress(state, lang(state).bridgeReadError);
      if (state.readErrors <= 3 && !trim(state.answer).length) {
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
    var conversations = publicConversations(workspaceRoot, userKey, projectFilter, includeDeleted, provider);
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
    return {
      ok: state.status !== "deleted",
      id: state.threadid,
      object: "agent.conversation",
      provider: state.provider,
      model: state.model || "",
      status: state.status,
      threadid: state.threadid,
      state: publicState(state),
      conversation: publicConversation(readJsonFile(new File(state.conversationFile)) || {}),
      conversations: publicConversations(state.workspaceRoot, state.userKey, state.primaryProject || state.projectId, false, "all"),
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
    state.status = "deleted";
    state.updatedAt = now();
    try {
      writeConversationRecord(state);
    } catch (_ignoreDeletedRecord) {}
    removeState(threadid);
    var dir = new File(state.conversationDir);
    var deleted = deleteRecursively(dir);
    var remainingConversations = publicConversations(state.workspaceRoot, state.userKey, state.primaryProject || state.projectId, false, "all");
    setBuffer("", "");
    return {
      ok: deleted,
      status: deleted ? "deleted" : "delete_failed",
      threadid: threadid,
      conversationDir: filePath(dir),
      conversations: remainingConversations,
      bridge: bridge
    };
  };

  C8O.assistantAgentBridge.closeConversation = function (options) {
    options = options || {};
    var threadid = normalizeThreadId(options.threadid);
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
    state.status = "closed";
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
