/*
 * "Confirmer avant de modifier" (No Code): while a user has it on, lib_ConvertigoMCP holds each No Code write of their
 * agent until they answer a card of the Tigo panel (lib_ConvertigoMCP js/nocode_write_confirm.js has the other half).
 *
 * The user's choice is kept for them (agents/nocode/users/<userKey>/write-confirm.json, off by default) and published
 * in the store the server shares between projects (context.server), where the MCP reads it at each write:
 * lib_ConvertigoAssistant.writeConfirm is a map of JSON strings, "user:<owner>" {on, at} and "grant:<conversation>"
 * {user, at} (the card's "allow all for this turn"). It is published when the user switches and at each message, so a
 * restarted engine has it again before the agent writes.
 *
 * The cards are the "write-confirm" requests the MCP leaves in lib_ConvertigoAssistant.hostRequests (js/
 * agent_host_requests.js hands them to the panel). answer() decides one; endTurn() closes those still open when a turn
 * ends (and at the next message): the MCP then refuses the change. Every change is a compare-and-set on the JSON string.
 *
 * host: readChoice() -> {on} or null, writeChoice(record), server() -> {get, set}, newMap(), now().
 */
if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantWriteConfirm = C8O.assistantWriteConfirm || {};

(function (api) {
  var STORE_KEY = "lib_ConvertigoAssistant.writeConfirm";
  var REQUESTS_KEY = "lib_ConvertigoAssistant.hostRequests";
  var DECISIONS = { allow: "allowed", allow_turn: "allowed_turn", refuse: "refused" };
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

  // The user's choice, as kept for them: off when nothing is kept.
  api.isOn = function (host) {
    var choice = null;
    try {
      choice = host.readChoice();
    } catch (_unreadableChoice) {}
    return !!choice && choice.on === true;
  };

  // The choice in the store, where the MCP reads it.
  api.publish = function (userId, on, host) {
    var owner = api.owner(userId);
    if (!owner.length) {
      return false;
    }
    confirmMap(host).put("user:" + owner, JSON.stringify({ on: on === true, at: host.now() }));
    return true;
  };

  // Switching takes effect at the next write of the agent, also in a running turn. Off answers no open card.
  api.choose = function (userId, on, host) {
    on = on === true;
    host.writeChoice({ schema: "tigo-write-confirm/1", on: on, updatedAt: host.now() });
    api.publish(userId, on, host);
    return { status: "ok", on: on };
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
    var on = api.isOn(host);
    api.publish(userId, on, host);
    if (str(conversationId).length) {
      api.endTurn(conversationId, userId, host, true);
    }
    return on;
  };

  // The line of the agent's prompt that says whether the user confirms each change.
  api.promptLine = function (on) {
    return on
      ? "- Change confirmation: on. Each write waits for the user's answer on a card of the Tigo panel that shows what it changes: call write tools as usual and do not ask the same question in chat."
      : "- Change confirmation: off (the switch \"Confirmer avant de modifier\" next to the input bar turns it on).";
  };
})(C8O.assistantWriteConfirm);
