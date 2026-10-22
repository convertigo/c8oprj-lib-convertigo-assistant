// Feedback to Convertigo: the frictions and bugs Tigo meets, kept in the Studio and sent with the user's consent.
// Contract, modes and masking: docs/tigo-feedback.md. Every input and output goes through F._store, so the logic runs
// in tests without a Convertigo engine.
if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantFeedback = C8O.assistantFeedback || {};

(function (F) {
  var SCHEMA = "tigo-feedback/1";
  var MODES = { off: true, ask: true, auto: true };
  var POLICIES = { user: true, off: true, ask: true, auto: true };
  var KINDS = { agent_friction: true, tool_error: true, runtime_error: true, user_report: true };
  var CHANNELS = { dev: true, release: true };
  var MAX_PENDING = 100;
  var MAX_BATCH = 50;
  var MAX_BATCH_BYTES = 256 * 1024;
  var MAX_SENT = 50;
  var LIMITS = { subject: 120, summary: 500, suggestion: 500, template: 300, comment: 1000 };
  var SNOOZE_MS = 7 * 24 * 3600 * 1000;

  F.SCHEMA = SCHEMA;
  F.LIMITS = LIMITS;

  function trim(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function cut(text, max) {
    text = trim(text);
    return text.length > max ? text.substring(0, max - 1) + "…" : text;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Masking: what could name the customer, its systems or a credential never leaves the Studio.
  F.redact = function (text, names) {
    var out = String(text == null ? "" : text);
    out = out.replace(/\b(?:https?|wss?|ftp|file|jdbc:[a-z0-9]+):\/\/[^\s"'<>)\]]+/gi, "<url>");
    out = out.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "<email>");
    out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "<secret>");
    out = out.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, "$1 <secret>");
    out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<secret>");
    out = out.replace(/((?:password|passwd|pwd|secret|token|apikey|api_key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1<secret>");
    out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>");
    out = out.replace(/(?:\b[A-Za-z]:\\|~\/|\/(?:Users|home|private|var|tmp|opt|etc|Volumes|mnt|srv|root|Library|Applications)\/)[^\s"'<>`]*/g, "<path>");
    out = out.replace(/\b[0-9a-f]{24,}\b/gi, "<hex>");
    out = out.replace(/[A-Za-z0-9+\/_-]{40,}={0,2}/g, "<data>");
    var list = (names || []).filter(function (name) {
      return trim(name).length >= 3;
    }).sort(function (a, b) {
      return String(b).length - String(a).length;
    });
    for (var i = 0; i < list.length; i++) {
      out = out.replace(new RegExp("(^|[^A-Za-z0-9_])" + escapeRegExp(list[i]) + "(?=[^A-Za-z0-9_]|$)", "g"), "$1<project>");
    }
    return out;
  };

  // An error template: its first two lines, masked, with quoted values and numbers replaced, so that the same error
  // with other names or values gets the same fingerprint.
  F.template = function (message, names) {
    var lines = String(message == null ? "" : message).split(/\r?\n/).map(trim).filter(function (line) {
      return line.length;
    }).slice(0, 2);
    var text = F.redact(lines.join(" / "), names);
    text = text.replace(/'[^']*'|"[^"]*"|`[^`]*`|«[^»]*»|“[^”]*”/g, "…");
    // The customer's own names: qualified names (PcaUpdateTracker.pg:Home), snake_case and camelCase identifiers.
    // Product class names (SimpleStep, SqlTransaction) stay readable.
    text = text.replace(/(?:<project>|\b[A-Za-z_]\w*)(?:[.:][\w*]+)+\b/g, "<name>");
    text = text.replace(/\b[a-z][a-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g, "<name>");
    text = text.replace(/\b\d+(?:[.,]\d+)*\b/g, "N");
    text = text.replace(/\s+/g, " ");
    return cut(text, LIMITS.template);
  };

  // The MCP tool a Bridge title names, or "" for another tool (shell, files, browser): only Convertigo tools are ours.
  F.convertigoTool = function (title) {
    var text = trim(title);
    var match = /^(?:mcp_Convertigo\.|mcp__convertigo__|Convertigo_|convertigo\.)([A-Za-z0-9_-]+)/i.exec(text);
    return match ? match[1].replace(/_/g, "-").toLowerCase() : "";
  };

  // The text a tool answered: the text blocks of an MCP result ({"content":[{"type":"text","text":...}]}), or the
  // preview itself; a cut preview is unescaped as far as it goes.
  F.resultText = function (preview) {
    var text = String(preview == null ? "" : preview);
    try {
      var value = JSON.parse(text);
      var content = value && (value.content || (value.result && value.result.content));
      if (Array.isArray(value)) {
        content = value;
      }
      var parts = [];
      for (var i = 0; content && i < content.length; i++) {
        var block = content[i] || {};
        var piece = typeof block.text === "string" ? block.text : (block.content && typeof block.content.text === "string" ? block.content.text : "");
        if (piece.length) {
          parts.push(piece);
        }
      }
      if (parts.length) {
        return parts.join("\n");
      }
    } catch (_ignoreParse) {
      if (/\\"/.test(text)) {
        return text.replace(/\\n/g, "\n").replace(/\\"/g, "\"");
      }
    }
    return text;
  };

  // The message of an MCP error answered as a result ({"code":"-1","message":...} or {"status":"error",...}).
  F.errorMessage = function (preview, failed) {
    var text = F.resultText(preview);
    var isError = failed === true || /"code"\s*:\s*"-1"/.test(text) || /"status"\s*:\s*"error"/.test(text) || /"isError"\s*:\s*true/.test(text);
    if (!isError) {
      return "";
    }
    // A cut preview ends inside the message: take what is there.
    var match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/.exec(text);
    if (match) {
      try {
        return JSON.parse("\"" + match[1] + "\"");
      } catch (_ignoreEscape) {
        return match[1];
      }
    }
    return failed === true ? text : "";
  };

  // TigoAccess's submitFeedback: HTTPS, except a loopback test server (localhost, 127.0.0.1, *.localhost) in plain HTTP.
  F.endpoint = function (host) {
    host = trim(host) || "backend-apps.convertigo.net";
    if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) {
      throw new Error("Invalid TigoAccess host");
    }
    var loopback = /^(?:localhost|127\.0\.0\.1|[A-Za-z0-9-]+\.localhost)(?::\d+)?$/i.test(host);
    return (loopback ? "http://" : "https://") + host + "/convertigo/projects/TigoAccess/.json?__sequence=submitFeedback&__disableAutologin=true";
  };

  function store() {
    if (!F._store) {
      F._store = engineStore();
    }
    return F._store;
  }

  F.policy = function () {
    var value = trim(store().symbol("assistant.feedback.policy")).toLowerCase();
    return POLICIES[value] ? value : "user";
  };

  F.available = function () {
    return store().studio() === true;
  };

  F.mode = function () {
    if (!F.available()) {
      return "off";
    }
    var policy = F.policy();
    if (policy !== "user") {
      return policy;
    }
    var settings = store().readSettings() || {};
    var mode = trim(settings.mode).toLowerCase();
    return MODES[mode] ? mode : "off";
  };

  F.setMode = function (mode) {
    mode = trim(mode).toLowerCase();
    if (!MODES[mode]) {
      return { status: "error", code: "unknown_mode" };
    }
    if (!F.available()) {
      return { status: "error", code: "unavailable" };
    }
    if (F.policy() !== "user") {
      return { status: "error", code: "locked_by_policy", mode: F.policy() };
    }
    var now = store().now();
    store().writeSettings({ mode: mode, updatedAt: now, decidedAt: now });
    return { status: "ok", mode: mode };
  };

  // "Not now" on the invitation: it comes back in a week, unless the user chooses a mode meanwhile.
  F.later = function () {
    if (!F.available()) {
      return { status: "error", code: "unavailable" };
    }
    if (F.policy() !== "user") {
      return { status: "error", code: "locked_by_policy", mode: F.policy() };
    }
    var settings = store().readSettings() || {};
    var until = store().now() + SNOOZE_MS;
    store().writeSettings({ mode: MODES[trim(settings.mode)] ? trim(settings.mode) : "off", updatedAt: store().now(), snoozedUntil: until });
    return { status: "ok", snoozedUntil: until };
  };

  // The page invites the user to share once: a mode nobody chose, nothing imposed, no snooze running.
  F.invite = function () {
    if (!F.available() || F.policy() !== "user" || F.mode() !== "off") {
      return false;
    }
    var settings = store().readSettings() || {};
    return !Number(settings.decidedAt) && !(Number(settings.snoozedUntil) > store().now());
  };

  function iso(ms) {
    return new Date(Number(ms)).toISOString();
  }

  function clean(report, names) {
    // The report as it is stored and sent: known fields only, masked and cut again.
    var finding = report.finding || {};
    var out = {
      schemaVersion: SCHEMA,
      reportId: trim(report.reportId),
      kind: trim(report.kind),
      fingerprint: trim(report.fingerprint),
      count: Math.max(1, Math.floor(Number(report.count) || 1)),
      firstAt: trim(report.firstAt),
      lastAt: trim(report.lastAt || report.firstAt),
      finding: {},
      stack: {}
    };
    var keys = ["area", "subject", "severity", "summary", "suggestion", "template"];
    for (var i = 0; i < keys.length; i++) {
      var value = trim(finding[keys[i]]);
      if (value.length) {
        out.finding[keys[i]] = cut(F.redact(value, names), LIMITS[keys[i]] || 60);
      }
    }
    var stack = report.stack || {};
    var stackKeys = ["assistant", "bridge", "mcp", "studio", "provider", "model"];
    for (var j = 0; j < stackKeys.length; j++) {
      var item = trim(stack[stackKeys[j]]);
      if (item.length) {
        out.stack[stackKeys[j]] = cut(item, 60);
      }
    }
    if (CHANNELS[trim(stack.channel)]) {
      out.stack.channel = trim(stack.channel);
    }
    if (report.turn && typeof report.turn === "object") {
      out.turn = {
        steps: Math.max(0, Math.floor(Number(report.turn.steps) || 0)),
        tools: (report.turn.tools || []).slice(0, 20).map(function (tool) {
          return {
            name: cut(F.redact(tool && tool.name, names), 80),
            calls: Math.max(0, Math.floor(Number(tool && tool.calls) || 0)),
            failures: Math.max(0, Math.floor(Number(tool && tool.failures) || 0))
          };
        })
      };
    }
    if (trim(report.comment).length) {
      out.comment = cut(F.redact(report.comment, names), LIMITS.comment);
    }
    return out;
  }
  F.clean = clean;

  function fingerprintOf(kind, finding) {
    var subject = trim(finding.subject);
    var basis = trim(finding.template) || trim(finding.summary);
    return store().sha256(kind + "|" + subject + "|" + basis);
  }

  // Adds a report to the outbox, or counts it on the waiting report with the same fingerprint.
  F.add = function (kind, finding, extra) {
    extra = extra || {};
    if (!KINDS[kind]) {
      return null;
    }
    var names = store().projectNames();
    var now = store().now();
    var report = clean({
      reportId: store().uuid(),
      kind: kind,
      finding: finding || {},
      count: 1,
      firstAt: iso(now),
      lastAt: iso(now),
      stack: store().stack(extra.provider, extra.model),
      turn: extra.turn,
      comment: extra.comment
    }, names);
    report.fingerprint = kind === "user_report" ? store().sha256(kind + "|" + report.reportId) : fingerprintOf(kind, report.finding);
    var pending = store().listPending();
    for (var i = 0; i < pending.length; i++) {
      if (pending[i] && pending[i].fingerprint === report.fingerprint) {
        pending[i].count = Math.max(1, Number(pending[i].count) || 1) + 1;
        pending[i].lastAt = report.lastAt;
        store().savePending(pending[i]);
        return pending[i];
      }
    }
    // The outbox stays small: the oldest waiting reports give way.
    for (var drop = 0; drop <= pending.length - MAX_PENDING; drop++) {
      store().removePending(pending[drop].reportId);
    }
    store().savePending(report);
    return report;
  };

  F.collectToolError = function (options) {
    options = options || {};
    if (F.mode() === "off") {
      return null;
    }
    var tool = F.convertigoTool(options.tool);
    var message = trim(options.message);
    if (!tool.length || !message.length) {
      return null;
    }
    return F.add("tool_error", { subject: tool, template: F.template(message, store().projectNames()) }, options);
  };

  F.collectRuntimeError = function (options) {
    options = options || {};
    if (F.mode() === "off") {
      return null;
    }
    var message = trim(options.message);
    if (!message.length) {
      return null;
    }
    var subject = trim(options.provider) || "agent";
    return F.add("runtime_error", { subject: subject, template: F.template(message, store().projectNames()) }, options);
  };

  // A report the user writes with /signaler: always prepared (an explicit act), sent when the user says so, or at once
  // in automatic mode. An administrator's "off" policy forbids it.
  F.userReport = function (options) {
    options = options || {};
    if (!F.available()) {
      return { status: "error", code: "unavailable" };
    }
    if (F.policy() === "off") {
      return { status: "error", code: "locked_by_policy", mode: "off" };
    }
    var comment = trim(options.comment);
    if (!comment.length) {
      return { status: "error", code: "comment_required" };
    }
    var turn = options.turn || null;
    var report = F.add("user_report", { subject: "turn", summary: cut(comment, 120) }, {
      provider: options.provider,
      model: options.model,
      turn: turn,
      comment: comment
    });
    return { status: "ok", report: report };
  };

  // The tools of a finished turn, from its saved events: names, calls and failures only.
  F.turnSummary = function (events) {
    var tools = {};
    var order = [];
    var steps = 0;
    for (var i = 0; i < (events || []).length; i++) {
      var event = events[i] || {};
      if (event.type !== "tool") {
        if (event.type === "narrative") {
          steps++;
        }
        continue;
      }
      steps++;
      var name = F.convertigoTool(event.toolName || event.title) || trim(event.toolName || event.groupKey || "other").split(/[.:\s]/)[0] || "other";
      if (!tools[name]) {
        tools[name] = { name: name, calls: 0, failures: 0 };
        order.push(name);
      }
      tools[name].calls++;
      if (event.status === "failed" || event.status === "error" || F.errorMessage(event.detail, false).length) {
        tools[name].failures++;
      }
    }
    return { steps: steps, tools: order.map(function (name) { return tools[name]; }) };
  };

  // The MCP's report-create leaves raw agent frictions in incoming/: they get the same masking, fingerprint and count
  // as the others before they join the outbox.
  F.ingest = function () {
    var incoming = store().listIncoming();
    var added = 0;
    for (var i = 0; i < incoming.length; i++) {
      var item = incoming[i] || {};
      var finding = item.finding || {};
      if (trim(item.kind) === "agent_friction" && trim(finding.subject).length && trim(finding.summary).length) {
        F.add("agent_friction", {
          area: finding.area,
          subject: finding.subject,
          severity: finding.severity,
          summary: finding.summary,
          suggestion: finding.suggestion
        }, { provider: item.provider, model: item.model });
        added++;
      }
      store().removeIncoming(item.__file);
    }
    return added;
  };

  F.pending = function () {
    F.ingest();
    var names = store().projectNames();
    return store().listPending().map(function (report) {
      return clean(report, names);
    });
  };

  F.clear = function () {
    var pending = store().listPending();
    for (var i = 0; i < pending.length; i++) {
      store().removePending(pending[i].reportId);
    }
    return { status: "ok", cleared: pending.length };
  };

  F.status = function () {
    var sent = store().readSent() || [];
    return {
      status: "ok",
      available: F.available(),
      mode: F.mode(),
      policy: F.policy(),
      locked: F.policy() !== "user",
      invite: F.invite(),
      pending: F.available() ? F.pending() : [],
      sent: sent.slice(-10),
      sentCount: sent.length
    };
  };

  function batchOf(reports) {
    var batch = [];
    var size = 2;
    for (var i = 0; i < reports.length && batch.length < MAX_BATCH; i++) {
      var length = JSON.stringify(reports[i]).length + 1;
      if (size + length > MAX_BATCH_BYTES) {
        break;
      }
      batch.push(reports[i]);
      size += length;
    }
    return batch;
  }

  F.send = function () {
    if (!F.available()) {
      return { status: "error", code: "unavailable" };
    }
    if (F.policy() === "off") {
      return { status: "error", code: "locked_by_policy", mode: "off" };
    }
    var pending = F.pending();
    if (!pending.length) {
      return { status: "ok", accepted: 0, rejected: [], pending: 0 };
    }
    var apiKey = store().readKey();
    if (!apiKey) {
      return { status: "error", code: "not_connected", pending: pending.length };
    }
    var batch = batchOf(pending);
    var answer;
    try {
      answer = store().post({ apiKey: apiKey, reports: JSON.stringify(batch) });
    } catch (e) {
      return { status: "error", code: "service_unavailable", pending: pending.length };
    } finally {
      apiKey = null;
    }
    var response = answer && (answer.response || answer);
    if (!response || response.status !== "ok") {
      return { status: "error", code: trim(response && response.code) || "service_unavailable", pending: pending.length };
    }
    var accepted = response.accepted || [];
    var sent = store().readSent() || [];
    for (var i = 0; i < batch.length; i++) {
      if (accepted.indexOf(batch[i].reportId) !== -1) {
        store().removePending(batch[i].reportId);
        sent.push({ reportId: batch[i].reportId, kind: batch[i].kind, subject: batch[i].finding.subject || "", count: batch[i].count, sentAt: iso(store().now()) });
      }
    }
    store().writeSent(sent.slice(-MAX_SENT));
    return { status: "ok", accepted: accepted.length, rejected: response.rejected || [], pending: store().listPending().length };
  };

  // After a turn: in automatic mode, what waits is sent; otherwise nothing happens.
  F.flush = function () {
    if (F.mode() === "off") {
      return { status: "ok", accepted: 0, skipped: true };
    }
    F.ingest();
    if (F.mode() !== "auto" || !store().listPending().length) {
      return { status: "ok", accepted: 0, skipped: true };
    }
    return F.send();
  };

  // One entry for the AgentFeedback sequence.
  F.run = function (options) {
    options = options || {};
    var action = trim(options.action).toLowerCase() || "status";
    var result;
    if (action === "mode") {
      result = F.setMode(options.mode);
    } else if (action === "send") {
      result = F.send();
    } else if (action === "flush") {
      result = F.flush();
    } else if (action === "clear") {
      result = F.clear();
    } else if (action === "later") {
      result = F.later();
    } else if (action === "report") {
      result = F.userReport(options);
      if (result.status === "ok" && F.mode() === "auto") {
        result.sent = F.send();
      }
    } else if (action !== "status") {
      return { status: "error", code: "unknown_action" };
    }
    var status = F.status();
    if (result) {
      status.result = result;
    }
    return status;
  };

  // The store of a Convertigo engine: files under <engine workspace>/agents/feedback, symbols, versions, the local
  // Tigo key and the TigoAccess endpoint.
  function engineStore() {
    var Engine = Packages.com.twinsoft.convertigo.engine.Engine;
    var Files = java.nio.file.Files;
    var UTF8 = java.nio.charset.StandardCharsets.UTF_8;
    var workspace = java.nio.file.Paths.get(String(Engine.USER_WORKSPACE_PATH)).toRealPath();
    var root = workspace.resolve("agents").resolve("feedback");
    var outbox = root.resolve("outbox");

    function safe(path) {
      for (var p = path; p != null && !p.equals(workspace); p = p.getParent()) {
        if (Files.isSymbolicLink(p)) {
          throw new Error("Unsafe feedback path");
        }
      }
      return path;
    }

    function read(path, fallback) {
      safe(path);
      if (!Files.isRegularFile(path) || Files.size(path) > 1024 * 1024) {
        return fallback;
      }
      try {
        return JSON.parse(String(new java.lang.String(Files.readAllBytes(path), UTF8)));
      } catch (_ignoreRead) {
        return fallback;
      }
    }

    function write(path, value) {
      safe(path);
      Files.createDirectories(path.getParent());
      var temp = path.resolveSibling(path.getFileName() + ".tmp");
      Files.write(temp, new java.lang.String(JSON.stringify(value, null, 2) + "\n").getBytes(UTF8));
      Files.move(temp, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    function idFile(reportId) {
      var id = trim(reportId);
      if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
        throw new Error("Invalid report id");
      }
      return outbox.resolve(id + ".json");
    }

    function version(name) {
      try {
        var project = Engine.theApp.databaseObjectsManager.getOriginalProjectByName(name);
        return project ? String(project.getVersion()) : "";
      } catch (_ignoreVersion) {
        return "";
      }
    }

    function text(path) {
      return String(new java.lang.String(Files.readAllBytes(path), UTF8));
    }

    // "dev" when the Assistant runs from a git clone on a branch (a developer's checkout, or a reference that follows a
    // branch); "release" for a CAR install or a clone checked out at a tag (detached HEAD).
    function channel() {
      try {
        var project = Engine.theApp.databaseObjectsManager.getOriginalProjectByName("lib_ConvertigoAssistant");
        var dir = project ? project.getDirFile().toPath() : null;
        var git = dir ? dir.resolve(".git") : null;
        if (!git || !Files.exists(git)) {
          return "release";
        }
        if (Files.isRegularFile(git)) {
          // A worktree: .git names the folder that holds its HEAD.
          var pointer = /^gitdir:\s*(.+)$/m.exec(text(git));
          if (!pointer) {
            return "dev";
          }
          git = dir.resolve(trim(pointer[1]));
        }
        var head = git.resolve("HEAD");
        return Files.isRegularFile(head) && /^ref:\s*refs\/heads\//.test(text(head)) ? "dev" : "release";
      } catch (_ignoreChannel) {
        return "release";
      }
    }

    return {
      studio: function () {
        return Engine.isStudioMode() === true;
      },
      symbol: function (name) {
        try {
          var value = Engine.theApp.databaseObjectsManager.symbolsGetValue(name);
          return value == null ? "" : String(value);
        } catch (_ignoreSymbol) {
          return "";
        }
      },
      now: function () {
        return Number(java.lang.System.currentTimeMillis());
      },
      uuid: function () {
        return String(java.util.UUID.randomUUID().toString());
      },
      sha256: function (text) {
        var digest = java.security.MessageDigest.getInstance("SHA-256").digest(new java.lang.String(String(text)).getBytes(UTF8));
        return String(Packages.com.twinsoft.convertigo.engine.util.HexUtils.toHexString(digest)).toLowerCase();
      },
      projectNames: function () {
        var out = [];
        try {
          var list = Engine.theApp.databaseObjectsManager.getAllProjectNamesList();
          for (var i = 0; i < list.size(); i++) {
            var name = String(list.get(i));
            if (!/^(lib_|mobilebuilder_tpl)/.test(name)) {
              out.push(name);
            }
          }
        } catch (_ignoreNames) {}
        return out;
      },
      stack: function (provider, model) {
        var studio = "";
        try {
          studio = String(Packages.com.twinsoft.convertigo.engine.ProductVersion.fullProductVersion);
        } catch (_ignoreStudio) {}
        return {
          assistant: version("lib_ConvertigoAssistant"),
          bridge: version("lib_ConvertigoAgentBridge"),
          mcp: version("lib_ConvertigoMCP"),
          studio: studio,
          provider: trim(provider),
          model: trim(model),
          channel: channel()
        };
      },
      readSettings: function () {
        return read(root.resolve("settings.json"), {});
      },
      writeSettings: function (value) {
        write(root.resolve("settings.json"), value);
      },
      listPending: function () {
        safe(outbox);
        if (!Files.isDirectory(outbox)) {
          return [];
        }
        var out = [];
        var stream = Files.list(outbox);
        try {
          var it = stream.iterator();
          while (it.hasNext()) {
            var path = it.next();
            if (/\.json$/.test(String(path.getFileName())) && !Files.isSymbolicLink(path)) {
              var report = read(path, null);
              if (report && report.reportId) {
                out.push(report);
              }
            }
          }
        } finally {
          stream.close();
        }
        out.sort(function (a, b) {
          return String(a.firstAt).localeCompare(String(b.firstAt));
        });
        return out;
      },
      savePending: function (report) {
        write(idFile(report.reportId), report);
      },
      removePending: function (reportId) {
        var path = idFile(reportId);
        safe(path);
        Files.deleteIfExists(path);
      },
      listIncoming: function () {
        var incoming = root.resolve("incoming");
        safe(incoming);
        if (!Files.isDirectory(incoming)) {
          return [];
        }
        var out = [];
        var stream = Files.list(incoming);
        try {
          var it = stream.iterator();
          while (it.hasNext() && out.length < 200) {
            var path = it.next();
            var name = String(path.getFileName());
            if (/^[A-Za-z0-9._-]+\.json$/.test(name) && !Files.isSymbolicLink(path)) {
              var item = read(path, {}) || {};
              item.__file = name;
              out.push(item);
            }
          }
        } finally {
          stream.close();
        }
        return out;
      },
      removeIncoming: function (name) {
        if (/^[A-Za-z0-9._-]+\.json$/.test(String(name || ""))) {
          var path = safe(root.resolve("incoming").resolve(String(name)));
          Files.deleteIfExists(path);
        }
      },
      readSent: function () {
        return read(root.resolve("sent.json"), []);
      },
      writeSent: function (value) {
        write(root.resolve("sent.json"), value);
      },
      // The local Tigo key, only when its metadata proves it came from TigoAccess (as TigoAccessStatus checks).
      readKey: function () {
        var directory = workspace.resolve("agents").resolve("convertigo");
        var keyPath = safe(directory.resolve("llm-api-key"));
        var metadataPath = safe(directory.resolve("tigo-access.json"));
        if (!Files.isRegularFile(keyPath) || Files.size(keyPath) >= 512) {
          return "";
        }
        var apiKey = trim(new java.lang.String(Files.readAllBytes(keyPath), UTF8));
        var metadata = read(metadataPath, null);
        if (!metadata || metadata.source !== "TigoAccess" || metadata.keyHash !== this.sha256(apiKey) || !/^sk-[A-Za-z0-9_-]{32,128}$/.test(apiKey)) {
          return "";
        }
        return apiKey;
      },
      post: function (fields) {
        var conn = new java.net.URL(F.endpoint(this.symbol("assistant.tigo.access.host"))).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
        conn.setRequestProperty("Accept", "application/json");
        conn.setDoOutput(true);
        var body = [];
        for (var key in fields) {
          if (Object.prototype.hasOwnProperty.call(fields, key)) {
            body.push(java.net.URLEncoder.encode(key, "UTF-8") + "=" + java.net.URLEncoder.encode(String(fields[key]), "UTF-8"));
          }
        }
        var out = conn.getOutputStream();
        out.write(new java.lang.String(body.join("&")).getBytes(UTF8));
        out.close();
        var code = conn.getResponseCode();
        var stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        var text = stream ? String(new java.lang.String(stream.readAllBytes(), UTF8)) : "";
        if (code >= 400) {
          throw new Error("HTTP " + code);
        }
        return JSON.parse(text);
      }
    };
  }
})(C8O.assistantFeedback);
