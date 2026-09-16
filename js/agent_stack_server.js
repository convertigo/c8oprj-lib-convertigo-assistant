if (typeof C8O === "undefined") {
  var C8O = {};
}

// Server-side installation and update of the Tigo agent stack.
//
// Convertigo Studio installs the stack itself through the AssistantView host bridge.
// When the Assistant runs on a plain Convertigo server (No Code Studio, C8Oforms, hosted
// deployments) there is no host bridge, so these helpers perform the same import with the
// engine ReferencedProjectManager, restricted to the official GitHub release CARs.
C8O.assistantAgentStack = C8O.assistantAgentStack || {};

(function () {
  var SELF_UPDATE_SYMBOL = "assistant.stack.selfupdate";
  var DEFAULT_POLICY = "admin";
  var POLICIES = ["admin", "authenticated", "all", "false"];
  // Install order: dependencies first, the Assistant last because replacing it reloads the
  // project that is running this very sequence.
  var STACK_PROJECTS = [
    { name: "lib_ConvertigoMCP", repository: "c8oprj-lib-c8o-mcp" },
    { name: "lib_ConvertigoAgentBridge", repository: "c8oprj-lib-convertigo-agent-bridge" },
    { name: "lib_ConvertigoAssistant", repository: "c8oprj-lib-convertigo-assistant" }
  ];
  var CONTEXT_KEYS = {
    lib_ConvertigoAssistant: { installed: "localAssistantInstalled", version: "localAssistantVersion" },
    lib_ConvertigoMCP: { installed: "localMcpInstalled", version: "localMcpVersion" },
    lib_ConvertigoAgentBridge: { installed: "localAgentBridgeInstalled", version: "localAgentBridgeVersion" }
  };

  function trim(value) {
    return ("" + (value == null ? "" : value)).replace(/^\s+|\s+$/g, "");
  }

  function boolValue(value) {
    if (value === true) { return true; }
    var text = trim(value).toLowerCase();
    return text === "1" || text === "true" || text === "yes" || text === "on";
  }

  function stackProject(name) {
    for (var i = 0; i < STACK_PROJECTS.length; i++) {
      if (STACK_PROJECTS[i].name === name) { return STACK_PROJECTS[i]; }
    }
    return null;
  }

  function engine() {
    return Packages.com.twinsoft.convertigo.engine.Engine;
  }

  function logInfo(message) {
    try { log.info("[assistant-stack] " + message); } catch (_ignoreLog) {}
  }

  function logWarn(message) {
    try { log.warn("[assistant-stack] " + message); } catch (_ignoreLog) {}
  }

  function symbolValue(name) {
    try {
      var value = engine().theApp.databaseObjectsManager.symbolsGetValue(name);
      if (value !== null && typeof value !== "undefined") { return trim(String(value)); }
    } catch (_ignoreSymbol) {}
    return "";
  }

  function selfUpdatePolicy() {
    var raw = symbolValue(SELF_UPDATE_SYMBOL).toLowerCase();
    if (!raw.length) { return DEFAULT_POLICY; }
    if (raw === "true" || raw === "1" || raw === "yes" || raw === "on" || raw === "anonymous") { return "all"; }
    if (raw === "0" || raw === "no" || raw === "off" || raw === "disabled" || raw === "none") { return "false"; }
    return POLICIES.indexOf(raw) >= 0 ? raw : DEFAULT_POLICY;
  }

  function httpSession(options) {
    try {
      if (options && options.httpSession) { return options.httpSession; }
    } catch (_ignoreOption) {}
    try { return context.httpSession; } catch (_ignoreContext) {}
    return null;
  }

  function isAdminSession(options) {
    try {
      var session = httpSession(options);
      if (!session) { return false; }
      var manager = engine().authenticatedSessionManager;
      var Role = Packages.com.twinsoft.convertigo.engine.AuthenticatedSessionManager.Role;
      return manager.hasRole(session, Role.WEB_ADMIN) === true || manager.hasRole(session, Role.PROJECTS_CONFIG) === true;
    } catch (_ignoreAdmin) {}
    return false;
  }

  function isAuthenticatedUser(options) {
    try {
      if (options && trim(options.authenticatedUser).length) { return true; }
    } catch (_ignoreOption) {}
    try {
      var user = context.getAuthenticatedUser();
      return user !== null && typeof user !== "undefined" && trim(String(user)).length > 0;
    } catch (_ignoreUser) {}
    return false;
  }

  function updateAllowed(options) {
    var policy = selfUpdatePolicy();
    if (policy === "false") { return { allowed: false, policy: policy, reason: "disabled" }; }
    if (sourceManagedProjects().length) { return { allowed: false, policy: policy, reason: "source_managed" }; }
    if (policy === "all") { return { allowed: true, policy: policy, reason: "open" }; }
    if (isAdminSession(options)) { return { allowed: true, policy: policy, reason: "admin" }; }
    if (policy === "authenticated" && isAuthenticatedUser(options)) { return { allowed: true, policy: policy, reason: "authenticated" }; }
    return { allowed: false, policy: policy, reason: policy === "authenticated" ? "authentication_required" : "admin_required" };
  }

  // Same rule as Convertigo Studio: a project living in a Git working directory is a
  // development checkout and is never overwritten by a release CAR.
  function isGitCheckout(project) {
    try {
      var GitUtils = Packages.com.twinsoft.convertigo.engine.util.GitUtils;
      var dir = GitUtils.getWorkingDir(project.getDirFile());
      return dir !== null && typeof dir !== "undefined";
    } catch (_ignoreGit) {}
    return false;
  }

  function installedVersion(name) {
    try {
      var manager = engine().theApp.databaseObjectsManager;
      if (!manager.existsProject(name)) { return { installed: false, version: "", gitCheckout: false }; }
      var project = manager.getOriginalProjectByName(name, false);
      return { installed: true, version: project ? trim(String(project.getVersion())) : "", gitCheckout: project ? isGitCheckout(project) : false };
    } catch (_ignoreProject) {}
    return { installed: false, version: "", gitCheckout: false };
  }

  function sourceManagedProjects() {
    var names = [];
    for (var i = 0; i < STACK_PROJECTS.length; i++) {
      if (installedVersion(STACK_PROJECTS[i].name).gitCheckout) { names.push(STACK_PROJECTS[i].name); }
    }
    return names;
  }

  function compareVersions(left, right) {
    var parse = function (value) {
      var parts = trim(value).split(/[.\-+]/);
      var numbers = [];
      for (var i = 0; i < parts.length; i++) {
        var number = parseInt(parts[i], 10);
        numbers.push(isNaN(number) ? 0 : number);
      }
      while (numbers.length < 3) { numbers.push(0); }
      return numbers;
    };
    var a = parse(left), b = parse(right);
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) { return x < y ? -1 : 1; }
    }
    return 0;
  }

  // Only official release CARs of the three stack repositories are accepted, whatever the
  // client sends: the manifest may come from the browser and must not become an import vector.
  function validateImportUrl(name, importUrl) {
    var project = stackProject(name);
    if (!project) { return ""; }
    var url = trim(importUrl);
    var prefix = name + "=";
    if (url.indexOf(prefix) === 0) { url = url.substring(prefix.length); }
    var pattern = new RegExp("^https://github\\.com/convertigo/" + project.repository.replace(/[.]/g, "\\.") + "/releases/download/v[0-9A-Za-z.\\-]+/" + name + "\\.car$");
    return pattern.test(url) ? prefix + url : "";
  }

  function normalizeProjects(value) {
    var list = value;
    // Rhino hands request variables over as java.lang.String objects, not JS strings.
    if (list && typeof list === "object" && !Array.isArray(list) && !list.projects) { list = String(list); }
    if (typeof list === "string") {
      try { list = trim(list).length ? JSON.parse(list) : []; } catch (_ignoreJson) { list = []; }
    }
    if (list && !Array.isArray(list) && list.projects) { list = list.projects; }
    if (!Array.isArray(list)) { list = []; }
    var ordered = [];
    for (var i = 0; i < STACK_PROJECTS.length; i++) {
      for (var j = 0; j < list.length; j++) {
        var item = list[j] || {};
        if (trim(item.name) !== STACK_PROJECTS[i].name) { continue; }
        ordered.push({ name: STACK_PROJECTS[i].name, version: trim(item.version), importUrl: trim(item.importUrl) });
        break;
      }
    }
    return ordered;
  }

  function status(options) {
    options = options || {};
    var access = updateAllowed(options);
    var result = {
      surface: "server",
      localAgentStackUpdateAllowed: access.allowed,
      localAgentStackUpdatePolicy: access.policy,
      localAgentStackUpdateReason: access.reason,
      localAgentStackSelfUpdateSymbol: SELF_UPDATE_SYMBOL,
      projects: []
    };
    var allInstalled = true;
    for (var i = 0; i < STACK_PROJECTS.length; i++) {
      var name = STACK_PROJECTS[i].name;
      var state = installedVersion(name);
      allInstalled = allInstalled && state.installed;
      result[CONTEXT_KEYS[name].installed] = state.installed;
      result[CONTEXT_KEYS[name].version] = state.version;
      result.projects.push({ name: name, installed: state.installed, version: state.version, gitCheckout: state.gitCheckout });
    }
    result.localAgentStackState = allInstalled ? "ready" : "missing";
    return result;
  }

  function importProject(name, importUrl) {
    var ProjectUrlParser = Packages.com.twinsoft.convertigo.engine.util.ProjectUrlParser;
    var parser = new ProjectUrlParser(importUrl);
    if (!parser.isValid()) { throw new Error("Invalid import URL for " + name); }
    var project = engine().theApp.referencedProjectManager.importProject(parser, true);
    if (project === null || typeof project === "undefined") { throw new Error("No project loaded with " + importUrl); }
    var projectName = trim(String(project.getName()));
    try { engine().theApp.schemaManager.clearCache(projectName); } catch (_ignoreSchema) {}
    try { Packages.com.twinsoft.convertigo.beans.core.Project.executeAutoStartSequences(projectName); } catch (_ignoreAutostart) {}
    try { Packages.com.twinsoft.convertigo.engine.sync.SharedWorkspaceSyncManager.markProjectReload(projectName); } catch (_ignoreSync) {}
    return projectName;
  }

  function install(options) {
    options = options || {};
    var access = updateAllowed(options);
    var force = boolValue(options.forceUpdate);
    var response = { status: "error", message: "", policy: access.policy, results: [] };
    if (!access.allowed) {
      response.status = "forbidden";
      response.reason = access.reason;
      response.message = access.reason === "disabled"
        ? "Stack self-update is disabled on this server (" + SELF_UPDATE_SYMBOL + ")."
        : access.reason === "source_managed"
        ? "Stack projects are Git checkouts and are never replaced by release CARs: " + sourceManagedProjects().join(", ")
        : "Stack self-update requires " + (access.policy === "authenticated" ? "an authenticated" : "an administrator") + " session (" + SELF_UPDATE_SYMBOL + "=" + access.policy + ").";
      return response;
    }
    var projects = normalizeProjects(options.projects);
    if (!projects.length) {
      response.message = "No stack project to install.";
      return response;
    }
    var installedCount = 0, updatedAssistant = false;
    for (var i = 0; i < projects.length; i++) {
      var item = projects[i];
      var entry = { name: item.name, targetVersion: item.version, action: "skipped" };
      response.results.push(entry);
      var importUrl = validateImportUrl(item.name, item.importUrl);
      if (!importUrl.length) {
        entry.action = "rejected";
        entry.error = "Import URL is not an official release of " + item.name;
        response.message = entry.error;
        logWarn(entry.error + ": " + item.importUrl);
        return response;
      }
      var current = installedVersion(item.name);
      entry.installedVersion = current.version;
      var upToDate = current.installed && item.version.length && current.version.length && compareVersions(current.version, item.version) >= 0;
      if (upToDate && !force) {
        entry.action = "up_to_date";
        continue;
      }
      try {
        logInfo((current.installed ? "Updating " : "Installing ") + item.name + " from " + importUrl);
        importProject(item.name, importUrl);
        entry.action = current.installed ? "updated" : "installed";
        entry.installedVersion = installedVersion(item.name).version;
        installedCount++;
        if (item.name === "lib_ConvertigoAssistant") { updatedAssistant = true; }
      } catch (error) {
        entry.action = "failed";
        entry.error = "" + (error && error.message ? error.message : error);
        response.message = "Failed to import " + item.name + ": " + entry.error;
        logWarn(response.message);
        return response;
      }
    }
    response.status = "success";
    response.installedCount = installedCount;
    response.assistantUpdated = updatedAssistant;
    response.message = installedCount ? "Agent stack updated on the server." : "Agent stack already up to date.";
    response.state = status(options);
    return response;
  }

  C8O.assistantAgentStack.SELF_UPDATE_SYMBOL = SELF_UPDATE_SYMBOL;
  C8O.assistantAgentStack.STACK_PROJECTS = STACK_PROJECTS;
  C8O.assistantAgentStack.selfUpdatePolicy = selfUpdatePolicy;
  C8O.assistantAgentStack.updateAllowed = updateAllowed;
  C8O.assistantAgentStack.validateImportUrl = validateImportUrl;
  C8O.assistantAgentStack.normalizeProjects = normalizeProjects;
  C8O.assistantAgentStack.compareVersions = compareVersions;
  C8O.assistantAgentStack.status = status;
  C8O.assistantAgentStack.install = install;
})();
