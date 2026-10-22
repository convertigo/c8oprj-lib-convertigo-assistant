// Feedback to Convertigo: the frictions and bugs Tigo meets, kept in the Studio or, on a server, for each user, and sent
// with the user's consent. Contract, modes and masking: docs/tigo-feedback.md. Every input and output goes through a
// store (F._store, or F._storeFor(userKey) for a server user), so the logic runs in tests without a Convertigo engine.
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
  // Where Tigo ran: a Studio, the No Code Studio of a server, or Tigo on a server for its administrators.
  var SURFACES = { studio: true, nocode: true, server: true };
  var MAX_PENDING = 100;
  // A server keeps the reports of each of its users: fewer for each.
  var MAX_PENDING_SERVER = 50;
  var MAX_NAMES = 500;
  var MAX_BATCH = 50;
  var MAX_BATCH_BYTES = 256 * 1024;
  var MAX_SENT = 50;
  var LIMITS = { subject: 120, summary: 500, suggestion: 500, template: 300, comment: 1000 };
  var DAY_MS = 24 * 3600 * 1000;
  // What "not now" puts aside, and for how long: the invitation, the nudge of the "off" mode, the offer of "auto".
  var SNOOZES = { invite: { field: "snoozedUntil", ms: 7 * DAY_MS }, nudge: { field: "nudgeUntil", ms: 7 * DAY_MS }, auto: { field: "autoOfferUntil", ms: 30 * DAY_MS } };
  // On a server, the automatic mode sends one user's reports at most every ten minutes: the server key has an hourly
  // limit shared by all its users.
  var AUTO_GAP_SERVER_MS = 10 * 60 * 1000;
  // Words a no-code name can be without naming anything of the customer (component types, generic labels, the masks
  // themselves): never masked, so that the templates stay readable.
  var GENERIC_NAMES = {};
  ("text textfield textarea email number date datetime time phone tel select checkbox checkboxes radio switch toggle button "
    + "submit reset page pages form forms field fields table tables database databases workspace label title name names "
    + "description value values type key required true false null none default image file files upload signature rating "
    + "slider section group panel container row rows column columns html content address link list item items option "
    + "options choice choices yes oui non id ids the and for with new nouveau nouvelle formulaire champ champs tableau "
    + "base nom prenom prénom adresse telephone téléphone message comment comments note notes status state data host "
    + "project secret path hex url ip date_time datagrid grid hidden password currency day month year week").split(" ").forEach(function (word) {
    GENERIC_NAMES[word] = true;
  });
  // Public services a message may name: their names say nothing of the customer.
  var KNOWN_HOSTS = { "llm.convertigo.com": true, "backend-apps.convertigo.net": true, "github.com": true, "raw.githubusercontent.com": true,
    "api.mistral.ai": true, "api.openai.com": true, "api.anthropic.com": true, "registry.npmjs.org": true, "pypi.org": true };
  // The no-code tools whose results name the user's forms, pages, fields and Baserow tables; the contract only describes
  // the product.
  var NAMING_TOOLS = /^nocode-(?!form-contract-get$)/;
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

  // Masking: what could name the customer, its systems or a credential never leaves the Studio or the server. names: the
  // projects open in the engine (<project>); others: the names a no-code turn showed, case-insensitive (<name>).
  F.redact = function (text, names, others) {
    var out = String(text == null ? "" : text);
    out = out.replace(/\b(?:https?|wss?|ftp|file|jdbc:[a-z0-9]+):\/\/[^\s"'<>)\]]+/gi, "<url>");
    out = out.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "<email>");
    out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "<secret>");
    out = out.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, "$1 <secret>");
    out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<secret>");
    out = out.replace(/((?:password|passwd|pwd|secret|token|apikey|api_key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1<secret>");
    out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>");
    out = out.replace(/(?:\b[A-Za-z]:\\|~\/|\/(?:Users|home|private|var|tmp|opt|etc|Volumes|mnt|srv|root|Library|Applications)\/)[^\s"'<>`]*/g, "<path>");
    out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>");
    out = out.replace(/\b[0-9a-f]{24,}\b/gi, "<hex>");
    // A host name without a URL (acme-forms.example.com), not a qualified class name (java.net.UnknownHostException).
    out = out.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|fr|de|eu|uk|ch|be|es|nl|ca|us|lu|cloud|app|dev|ai|co|info|biz|local|internal|corp|lan)\b(?![\w-]|\.[A-Za-z0-9_])/g, function (host) {
      return KNOWN_HOSTS[host] ? host : "<host>";
    });
    // Long encoded values (keys, tokens): a digit among letters. A long name without digits, such as tools joined with
    // "/", stays readable.
    out = out.replace(/[A-Za-z0-9+\/_-]{40,}={0,2}/g, function (value) {
      return /\d/.test(value) && /[A-Za-z]/.test(value) ? "<data>" : value;
    });
    var list = (names || []).filter(function (name) {
      return trim(name).length >= 3;
    }).map(function (name) {
      return { name: String(name), flags: "g", mask: "<project>" };
    }).concat((others || []).filter(function (name) {
      return usableName(name).length > 0;
    }).map(function (name) {
      return { name: trim(name), flags: "gi", mask: "<name>" };
    })).sort(function (a, b) {
      return b.name.length - a.name.length;
    });
    for (var i = 0; i < list.length; i++) {
      out = out.replace(new RegExp("(^|[^A-Za-z0-9_\u00C0-\u024F])" + escapeRegExp(list[i].name) + "(?=[^A-Za-z0-9_\u00C0-\u024F]|$)", list[i].flags), "$1" + list[i].mask);
    }
    return out;
  };

  // A name a no-code turn showed that is worth masking: 3 to 120 characters, not a generic word, a number or a tool.
  function usableName(value) {
    var name = trim(value).replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 120 || GENERIC_NAMES[name.toLowerCase()] || /^[\d\s.,:\/-]+$/.test(name) || /^<[a-z]+>$/.test(name)) {
      return "";
    }
    if (/^[a-z]+(?:-[a-z]+)+$/.test(name) && /^(?:nocode|databaseobject|project|requestable|mobile|ngx|business|sql|report)-/.test(name)) {
      return "";
    }
    return name;
  }
  F.usableName = usableName;

  // The names a no-code tool result shows: titles, labels, names and keys of the form, its pages and components, and of
  // the Baserow workspaces, databases, tables and fields. The result may be cut or hold JSON in JSON.
  F.namesIn = function (text) {
    var source = String(text == null ? "" : text);
    if (source.length > 512 * 1024) {
      source = source.substring(0, 512 * 1024);
    }
    source = source.replace(/\\+"/g, "\"");
    var out = [];
    var seen = {};
    var pattern = /"(title|label|name|key|displayName|formName|pageName|tableName|databaseName|workspaceName|placeholder)"\s*:\s*"((?:[^"\\]|\\.){3,240}?)"/g;
    var match;
    while ((match = pattern.exec(source)) !== null && out.length < MAX_NAMES) {
      var value = match[2];
      try {
        value = JSON.parse("\"" + value + "\"");
      } catch (_ignoreEscape) {}
      value = usableName(value);
      if (value.length && !seen[value.toLowerCase()]) {
        seen[value.toLowerCase()] = true;
        out.push(value);
      }
    }
    return out;
  };

  // An error template: its first two lines, masked, with quoted values and numbers replaced, so that the same error
  // with other names or values gets the same fingerprint.
  F.template = function (message, names, others) {
    var lines = String(message == null ? "" : message).split(/\r?\n/).map(trim).filter(function (line) {
      return line.length;
    }).slice(0, 2);
    var text = F.redact(lines.join(" / "), names, others);
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

  // The provider as the Assistant names it (claude, codex, vibe, convertigo), whatever name an agent gives.
  F.provider = function (value) {
    var provider = trim(value).toLowerCase();
    if (/^(anthropic|claude)([ _-]|$)/.test(provider) || provider === "claude-code") {
      return "claude";
    }
    if (/^(openai|codex)([ _-]|$)/.test(provider)) {
      return "codex";
    }
    if (/^(mistral|vibe)([ _-]|$)/.test(provider)) {
      return "vibe";
    }
    return cut(provider, 60);
  };

  // The pure helpers every bound feedback object shares.
  var SHARED = ["SCHEMA", "LIMITS", "redact", "usableName", "namesIn", "template", "convertigoTool", "resultText", "errorMessage", "endpoint", "provider"];

  // The feedback API bound to one store: the Studio's (engine-wide), or one server user's.
  function bind(F, store) {
    for (var s = 0; s < SHARED.length; s++) {
      F[SHARED[s]] = C8O.assistantFeedback[SHARED[s]];
    }

    F.policy = function () {
      var value = trim(store().symbol("assistant.feedback.policy")).toLowerCase();
      return POLICIES[value] ? value : "user";
    };

    // The Studio, or on a server a signed-in user once Convertigo ops installed the server's feedback key.
    F.available = function () {
      if (store().studio() === true) {
        return true;
      }
      return trim(store().userKey).length > 0 && trim(store().serverKey && store().serverKey()).length > 0;
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

    // "Not now" on an offer: the invitation and the nudge come back in a week, the offer of "auto" in a month. Choosing a
    // mode starts afresh.
    F.later = function (topic) {
      var snooze = SNOOZES[trim(topic).toLowerCase() || "invite"];
      if (!snooze) {
        return { status: "error", code: "unknown_topic" };
      }
      if (!F.available()) {
        return { status: "error", code: "unavailable" };
      }
      if (F.policy() !== "user") {
        return { status: "error", code: "locked_by_policy", mode: F.policy() };
      }
      var settings = store().readSettings() || {};
      var until = store().now() + snooze.ms;
      var next = {};
      for (var key in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          next[key] = settings[key];
        }
      }
      next.mode = MODES[trim(settings.mode)] ? trim(settings.mode) : "off";
      next.updatedAt = store().now();
      next[snooze.field] = until;
      store().writeSettings(next);
      return { status: "ok", snoozedUntil: until };
    };

    function offered(field) {
      if (!F.available() || F.policy() !== "user") {
        return null;
      }
      var settings = store().readSettings() || {};
      return Number(settings[field]) > store().now() ? null : settings;
    }

    // The page invites the user to share: a mode nobody chose, nothing imposed, no snooze running.
    F.invite = function () {
      var settings = offered("snoozedUntil");
      return !!settings && F.mode() === "off" && !Number(settings.decidedAt);
    };

    // After a turn with errors, a user who chose "off" is asked again to share them (with review).
    F.nudge = function () {
      var settings = offered("nudgeUntil");
      return !!settings && F.mode() === "off" && !!Number(settings.decidedAt);
    };

    // A user who reviews each send is offered to let the reports go on their own.
    F.offerAuto = function () {
      return !!offered("autoOfferUntil") && F.mode() === "ask";
    };

    // An administrator who imposes the automatic mode: each user is told once that Tigo's errors are shared.
    F.notice = function () {
      if (!F.available() || F.policy() !== "auto") {
        return false;
      }
      var settings = store().readSettings() || {};
      return !Number(settings.noticedAt);
    };

    F.seen = function () {
      if (!F.available()) {
        return { status: "error", code: "unavailable" };
      }
      mergeSettings({ noticedAt: store().now() });
      return { status: "ok" };
    };

    function mergeSettings(patch) {
      var settings = store().readSettings() || {};
      var next = {};
      for (var key in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          next[key] = settings[key];
        }
      }
      for (var field in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          next[field] = patch[field];
        }
      }
      store().writeSettings(next);
    }

    function iso(ms) {
      return new Date(Number(ms)).toISOString();
    }

    function clean(report, names, others) {
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
          out.finding[keys[i]] = cut(F.redact(value, names, others), LIMITS[keys[i]] || 60);
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
      if (SURFACES[trim(stack.surface)]) {
        out.stack.surface = trim(stack.surface);
      }
      if (report.turn && typeof report.turn === "object") {
        out.turn = {
          steps: Math.max(0, Math.floor(Number(report.turn.steps) || 0)),
          tools: (report.turn.tools || []).slice(0, 20).map(function (tool) {
            return {
              name: cut(F.redact(tool && tool.name, names, others), 80),
              calls: Math.max(0, Math.floor(Number(tool && tool.calls) || 0)),
              failures: Math.max(0, Math.floor(Number(tool && tool.failures) || 0))
            };
          })
        };
      }
      if (trim(report.comment).length) {
        out.comment = cut(F.redact(report.comment, names, others), LIMITS.comment);
      }
      return out;
    }
    F.clean = clean;

    // The names the user's no-code turns showed, kept with their reports so that they are masked again before sending.
    function customerNames() {
      var list = store().readNames ? store().readNames() : [];
      return Array.isArray(list) ? list : [];
    }

    // Remembers the names a no-code turn showed (form, pages, components, Baserow tables), for masking. Nothing is kept
    // where feedback is not available or turned off by the administrator.
    F.rememberNames = function (list) {
      if (!F.available() || F.policy() === "off" || !store().writeNames) {
        return 0;
      }
      var known = customerNames();
      var seen = {};
      for (var i = 0; i < known.length; i++) {
        seen[String(known[i]).toLowerCase()] = true;
      }
      var added = [];
      for (var j = 0; j < (list || []).length; j++) {
        var name = F.usableName(list[j]);
        if (name.length && !seen[name.toLowerCase()]) {
          seen[name.toLowerCase()] = true;
          added.push(name);
        }
      }
      if (added.length) {
        store().writeNames(added.concat(known).slice(0, MAX_NAMES));
      }
      return added.length;
    };

    // Where Tigo ran: the surface the caller names, else the Studio, or the No Code Studio on a server.
    function surfaceOf(value) {
      var surface = trim(value).toLowerCase();
      return SURFACES[surface] ? surface : (store().studio() === true ? "studio" : "nocode");
    }

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
      var others = customerNames();
      var now = store().now();
      var stack = store().stack(F.provider(extra.provider), extra.model);
      stack.surface = surfaceOf(extra.surface);
      var report = clean({
        reportId: store().uuid(),
        kind: kind,
        finding: finding || {},
        count: 1,
        firstAt: iso(now),
        lastAt: iso(now),
        stack: stack,
        turn: extra.turn,
        comment: extra.comment
      }, names, others);
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
      var max = store().studio() === true ? MAX_PENDING : MAX_PENDING_SERVER;
      for (var drop = 0; drop <= pending.length - max; drop++) {
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
      return F.add("tool_error", { subject: tool, template: F.template(message, store().projectNames(), customerNames()) }, options);
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
      return F.add("runtime_error", { subject: subject, template: F.template(message, store().projectNames(), customerNames()) }, options);
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
        surface: options.surface,
        turn: turn,
        comment: comment
      });
      return { status: "ok", report: report };
    };

    // The tool errors of a finished turn, from its saved events: what a user who turns feedback on from the nudge of that
    // turn shares at once.
    F.collectTurn = function (events, provider, model, surface) {
      var count = 0;
      for (var n = 0; n < (events || []).length; n++) {
        var named = events[n] || {};
        if (named.type === "tool" && NAMING_TOOLS.test(F.convertigoTool(named.toolName || named.title))) {
          F.rememberNames(F.namesIn(F.resultText(named.detail)));
        }
      }
      for (var i = 0; i < (events || []).length; i++) {
        var event = events[i] || {};
        if (event.type !== "tool") {
          continue;
        }
        var message = F.errorMessage(event.detail, event.status === "failed" || event.status === "error");
        if (message.length && F.collectToolError({ tool: event.toolName || event.title, message: message, provider: provider, model: model, surface: surface })) {
          count++;
        }
      }
      return count;
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
    // as the others before they join the outbox. At the end of a turn the conversation's provider replaces the one the
    // agent named, and its model too unless it is the CLI's default and the agent named the model that answered.
    F.ingest = function (options) {
      options = options || {};
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
          }, {
            provider: trim(options.provider) || item.provider,
            model: trim(options.model) && trim(options.model) !== "default" ? options.model : (trim(item.model) || options.model),
            surface: options.surface
          });
          added++;
        }
        store().removeIncoming(item.__file);
      }
      return added;
    };

    // The reports as they will be sent: masked again, and on a server with the user's pseudonym for Convertigo.
    F.pending = function () {
      F.ingest();
      var names = store().projectNames();
      var others = customerNames();
      var reporter = trim(store().reporter ? store().reporter() : "");
      return store().listPending().map(function (report) {
        var out = clean(report, names, others);
        if (/^[a-f0-9]{64}$/.test(reporter)) {
          out.reporter = reporter;
        }
        return out;
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
        nudge: F.nudge(),
        offerAuto: F.offerAuto(),
        notice: F.notice(),
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
      if (store().studio() !== true) {
        var settings = store().readSettings() || {};
        if (store().now() - (Number(settings.autoSentAt) || 0) < AUTO_GAP_SERVER_MS) {
          return { status: "ok", accepted: 0, skipped: true, waiting: true };
        }
        var sent = F.send();
        if (sent.status === "ok" || sent.code === "rate_limited") {
          mergeSettings({ autoSentAt: store().now() });
        }
        return sent;
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
        if (result.status === "ok" && result.mode !== "off" && options.events) {
          result.collected = F.collectTurn(options.events, options.provider, options.model, options.surface);
        }
      } else if (action === "send") {
        result = F.send();
      } else if (action === "flush") {
        result = F.flush();
      } else if (action === "clear") {
        result = F.clear();
      } else if (action === "later") {
        result = F.later(options.topic);
      } else if (action === "seen") {
        result = F.seen();
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

    return F;
  }

  bind(F, function () {
    if (!F._store) {
      F._store = engineStore("");
    }
    return F._store;
  });

  // One user's feedback on a server: their consent, reports and names under agents/feedback/users/<userKey>. A new
  // object each time, so that a request never reads or writes another user's files.
  F.forUser = function (userKey) {
    var bound = null;
    return bind({ userKey: String(userKey || "") }, function () {
      if (!bound) {
        bound = typeof F._storeFor === "function" ? F._storeFor(String(userKey || "")) : engineStore(String(userKey || ""));
      }
      return bound;
    });
  };

  // The store of a Convertigo engine: files under <engine workspace>/agents/feedback (the Studio's), or
  // agents/feedback/users/<userKey> (one server user's), symbols, versions, the Tigo key (the Studio's, or the server's
  // feedback key) and the TigoAccess endpoint.
  function engineStore(userKey) {
    var Engine = Packages.com.twinsoft.convertigo.engine.Engine;
    var Files = java.nio.file.Files;
    var UTF8 = java.nio.charset.StandardCharsets.UTF_8;
    var workspace = java.nio.file.Paths.get(String(Engine.USER_WORKSPACE_PATH)).toRealPath();
    var feedbackRoot = workspace.resolve("agents").resolve("feedback");
    userKey = trim(userKey);
    if (userKey.length && (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}$/.test(userKey) || userKey.indexOf("..") !== -1)) {
      throw new Error("Invalid feedback user");
    }
    var root = userKey.length ? feedbackRoot.resolve("users").resolve(userKey) : feedbackRoot;
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

    // A file only its owner reads (0600 on POSIX), created once.
    function writePrivate(path, bytes) {
      safe(path);
      Files.createDirectories(path.getParent());
      try {
        Files.write(path, bytes, java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE);
      } catch (_ignoreExisting) {
        return;
      }
      try {
        Files.setPosixFilePermissions(path, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
      } catch (_ignoreNotPosix) {}
    }

    return {
      userKey: userKey,
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
      readNames: function () {
        return read(root.resolve("names.json"), []);
      },
      writeNames: function (value) {
        write(root.resolve("names.json"), value);
      },
      writeSent: function (value) {
        write(root.resolve("sent.json"), value);
      },
      // The server's feedback key (TigoAccess AdminFeedbackClient), installed by Convertigo ops: the TIGO_FEEDBACK_KEY
      // environment variable (a Kubernetes Secret), else <workspace>/agents/feedback/server-key. Never in the Studio.
      serverKey: function () {
        if (Engine.isStudioMode() === true) {
          return "";
        }
        var key = "";
        try {
          key = trim(java.lang.System.getenv("TIGO_FEEDBACK_KEY"));
        } catch (_ignoreEnv) {}
        if (!key.length) {
          var file = safe(feedbackRoot.resolve("server-key"));
          if (Files.isRegularFile(file) && !Files.isSymbolicLink(file) && Files.size(file) < 512) {
            key = trim(new java.lang.String(Files.readAllBytes(file), UTF8));
          }
        }
        return /^sk-[A-Za-z0-9_-]{32,128}$/.test(key) ? key : "";
      },
      // The user's pseudonym for Convertigo: an HMAC of their key with a secret that never leaves the server, so that
      // Convertigo counts the users behind a report without knowing who they are.
      reporter: function () {
        if (!userKey.length || Engine.isStudioMode() === true) {
          return "";
        }
        var saltPath = feedbackRoot.resolve("reporter-salt");
        safe(saltPath);
        if (!Files.isRegularFile(saltPath)) {
          var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32);
          new java.security.SecureRandom().nextBytes(bytes);
          writePrivate(saltPath, new java.lang.String(Packages.com.twinsoft.convertigo.engine.util.HexUtils.toHexString(bytes)).getBytes(UTF8));
        }
        var salt = trim(new java.lang.String(Files.readAllBytes(saltPath), UTF8));
        if (salt.length < 32) {
          return "";
        }
        var mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(new java.lang.String(salt).getBytes(UTF8), "HmacSHA256"));
        return String(Packages.com.twinsoft.convertigo.engine.util.HexUtils.toHexString(mac.doFinal(new java.lang.String(userKey).getBytes(UTF8)))).toLowerCase();
      },
      // The local Tigo key, only when its metadata proves it came from TigoAccess (as TigoAccessStatus checks); on a
      // server, its feedback key.
      readKey: function () {
        if (Engine.isStudioMode() !== true) {
          return this.serverKey();
        }
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
