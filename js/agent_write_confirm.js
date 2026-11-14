/*
 * "Confirmer avant de modifier": while a user has it on, lib_ConvertigoMCP holds each write of their agent until they
 * answer a card of the Tigo panel (lib_ConvertigoMCP js/nocode_write_confirm.js in No Code, js/studio_write_confirm.js in
 * a Studio, have the other half). In a Studio the choice has a third value, "Lecture seule" (readonly): every write of
 * Tigo is refused, and the agent is told why. The Studio panel's user is "studio" (one per engine).
 *
 * The user's choice is kept for them (agents/nocode/users/<userKey>/write-confirm.json, agents/assistant/
 * write-confirm.json for the Studio, off by default) and published in the store the server shares between projects
 * (context.server), where the MCP reads it at each write: lib_ConvertigoAssistant.writeConfirm is a map of JSON strings,
 * "user:<owner>" {on, mode, at} and "grant:<conversation>" {user, at} (the card's "allow all for this turn"). It is
 * published when the user switches and at each message, so a restarted engine has it again before the agent writes.
 *
 * The cards are the "write-confirm" requests the MCP leaves in lib_ConvertigoAssistant.hostRequests (js/
 * agent_host_requests.js hands them to the panel). answer() decides one; endTurn() closes those still open when a turn
 * ends (and at the next message): the MCP then refuses the change. Every change is a compare-and-set on the JSON string.
 *
 * host: readChoice() -> {on, mode} or null, writeChoice(record), server() -> {get, set}, newMap(), now(), defaultOn().
 */
if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantWriteConfirm = C8O.assistantWriteConfirm || {};

(function (api) {
  var STORE_KEY = "lib_ConvertigoAssistant.writeConfirm";
  var REQUESTS_KEY = "lib_ConvertigoAssistant.hostRequests";
  var DECISIONS = { allow: "allowed", allow_turn: "allowed_turn", refuse: "refused" };
  // off, confirm (each write waits for a card) and readonly (every write refused, the Studio only)
  api.MODES = ["off", "confirm", "readonly"];
  api.STUDIO_USER = "studio";
  var OPEN = { pending: true, taken: true };

  function str(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
  }

  // The owner the MCP names (C8Oforms signs an OAuth user in as "provider:subject:email"): the email, in lower case.
  api.owner = function (user) {
    var text = str(user);
    var parts = text.split(":");
    var last = parts[parts.length - 1];
    return (parts.length > 2 && last.indexOf("@") > 0 ? last : text).toLowerCase();
  };

  function confirmMap(host) {
    var store = host.server();
    if (store.get(STORE_KEY) == null) {
      // context.server has no putIfAbsent: only the first write of the engine creates the map
      store.set(STORE_KEY, host.newMap());
    }
    return store.get(STORE_KEY);
  }

  function requestsOf(host, conversationId) {
    var conversations = host.server().get(REQUESTS_KEY);
    return conversations == null || !str(conversationId).length ? null : conversations.get(str(conversationId));
  }

  function readJson(map, id) {
    var json = map == null ? null : map.get(id);
    if (json == null) {
      return null;
    }
    try {
      return JSON.parse(String(json));
    } catch (_unreadable) {
      return null;
    }
  }

  function keysOf(map) {
    var ids = [];
    var keys = map.keySet().toArray();
    for (var i = 0; i < keys.length; i++) {
      ids.push(String(keys[i]));
    }
    return ids;
  }

  function sameUser(a, b) {
    var user = api.owner(a);
    return user.length > 0 && user === api.owner(b);
  }

  // A mode from a choice or a value: true and "on" are confirm; anything else unknown is off. A choice is a record with
  // on or mode; a variable of a sequence is a Java string, whose typeof is "object" in Rhino.
  api.modeOf = function (value) {
    if (value && typeof value === "object" && (typeof value.mode !== "undefined" || typeof value.on !== "undefined")) {
      var named = api.modeOf(value.mode);
      return value.mode != null && str(value.mode).length ? named : (value.on === true ? "confirm" : "off");
    }
    var text = str(value).toLowerCase();
    if (value === true || text === "on" || text === "true" || text === "confirm") {
      return "confirm";
    }
    return text === "readonly" || text === "read-only" || text === "read_only" ? "readonly" : "off";
  };

  // The user's choice, as kept for them: the server's default (No Code) or off when nothing is kept.
  api.mode = function (host) {
    var choice = null;
    try {
      choice = host.readChoice();
    } catch (_unreadableChoice) {}
    if (!choice || (typeof choice.on !== "boolean" && !str(choice.mode).length)) {
      try {
        return typeof host.defaultOn === "function" && host.defaultOn() === true ? "confirm" : "off";
      } catch (_noDefault) {
        return "off";
      }
    }
    return api.modeOf(choice);
  };

  api.isOn = function (host) {
    return api.mode(host) !== "off";
  };

  // The choice in the store, where the MCP reads it: {on, mode, at}; on stays for the MCP of No Code (on = held).
  api.publish = function (userId, onOrMode, host) {
    var owner = api.owner(userId);
    if (!owner.length) {
      return false;
    }
    var mode = api.modeOf(onOrMode);
    confirmMap(host).put("user:" + owner, JSON.stringify({ on: mode !== "off", mode: mode, at: host.now() }));
    return true;
  };

  // Switching takes effect at the next write of the agent, also in a running turn. Off answers no open card.
  api.choose = function (userId, onOrMode, host) {
    var mode = api.modeOf(onOrMode);
    host.writeChoice({ schema: "tigo-write-confirm/1", on: mode !== "off", mode: mode, updatedAt: host.now() });
    api.publish(userId, mode, host);
    return { status: "ok", on: mode !== "off", mode: mode };
  };

  // The user's answer to a card: allow, allow_turn (the next writes of this turn go on without a card) or refuse.
  api.answer = function (params, host) {
    params = params || {};
    var status = DECISIONS[str(params.decision)];
    var id = str(params.requestId);
    var map = requestsOf(host, params.conversationId);
    var json = map == null || !id.length ? null : map.get(id);
    var request = readJson(map, id);
    if (!status) {
      return { status: "error", error: { code: "invalid_decision", message: "decision is allow, allow_turn or refuse." } };
    }
    if (!request || request.kind !== "write-confirm" || !sameUser(request.user, params.userId)) {
      return { status: "error", error: { code: "unknown_request", message: "No change waits for confirmation under " + id + " in this conversation." } };
    }
    if (!OPEN[request.status]) {
      return { status: "error", error: { code: "not_waiting", message: "The change is " + request.status + "." }, state: request.status, reason: request.reason || "" };
    }
    var next = JSON.parse(JSON.stringify(request));
    next.status = status;
    next.decidedAt = host.now();
    if (!map.replace(id, String(json), JSON.stringify(next))) {
      return { status: "error", error: { code: "changed", message: "The change was answered meanwhile." } };
    }
    if (status === "allowed_turn") {
      confirmMap(host).put("grant:" + str(params.conversationId), JSON.stringify({ user: api.owner(params.userId), at: host.now() }));
    }
    return { status: "ok", state: status };
  };

  // The end of a turn: the cards still open are closed (a call that still waits refuses its change), the answers no
  // call used are dropped, and so is "allow all for this turn". The next message drops every card of the conversation
  // (all): nothing a turn left answers a call of the next one.
  api.endTurn = function (conversationId, userId, host, all) {
    var closed = 0;
    var dropped = 0;
    var map = requestsOf(host, conversationId);
    if (map != null) {
      keysOf(map).forEach(function (id) {
        var json = map.get(id);
        var request = readJson(map, id);
        if (!request || request.kind !== "write-confirm" || !sameUser(request.user, userId)) {
          return;
        }
        if (all === true) {
          if (map.remove(id, String(json))) {
            dropped++;
          }
        } else if (OPEN[request.status]) {
          var next = JSON.parse(JSON.stringify(request));
          next.status = "expired";
          next.reason = "turn_end";
          if (map.replace(id, String(json), JSON.stringify(next))) {
            closed++;
          }
        } else if (request.status !== "expired" && map.remove(id, String(json))) {
          dropped++;
        }
      });
    }
    var store = host.server().get(STORE_KEY);
    var grant = store == null || !str(conversationId).length ? null : readJson(store, "grant:" + str(conversationId));
    if (grant && sameUser(grant.user, userId)) {
      store.remove("grant:" + str(conversationId));
    }
    return { status: "ok", closed: closed, dropped: dropped };
  };

  // A message starts a turn: the choice kept for the user is published again, and what the last turn left is closed.
  api.newTurn = function (conversationId, userId, host) {
    var mode = api.mode(host);
    api.publish(userId, mode, host);
    if (str(conversationId).length) {
      api.endTurn(conversationId, userId, host, true);
    }
    api.lastMode = mode;
    return mode !== "off";
  };

  // The line of a Studio agent's prompt: the MCP holds or refuses its writes, and no card covers a file it would edit.
  api.studioPromptLine = function (mode) {
    mode = api.modeOf(mode);
    if (mode === "readonly") {
      return "- Change mode: read-only. The user set Tigo to read-only in this Studio: every Convertigo MCP write is refused, and you must not change any project or file either (no file edit, no shell command that writes). Inspect, explain, review and propose; say what you would change.";
    }
    if (mode === "confirm") {
      return "- Change mode: confirm before changing. Each Convertigo MCP write waits for the user's answer on a card of the Tigo panel that shows what it changes: call write tools as usual, do not ask the same question in chat, and call again with the same arguments while the answer says awaiting_confirmation. Change projects through the Convertigo MCP tools only: no card covers a file you would edit with file or shell tools.";
    }
    return "- Change mode: free (the Tigo settings offer \"Confirmer avant de modifier\" and \"Lecture seule\").";
  };

  // The line of the agent's prompt that says whether the user confirms each change.
  api.promptLine = function (on) {
    return on
      ? "- Change confirmation: on. Each write waits for the user's answer on a card of the Tigo panel that shows what it changes: call write tools as usual and do not ask the same question in chat."
      : "- Change confirmation: off (the switch \"Confirmer avant de modifier\" next to the input bar turns it on).";
  };
})(C8O.assistantWriteConfirm);
