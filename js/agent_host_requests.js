/*
 * Requests the Convertigo MCP leaves for the page that hosts the Tigo panel: nocode-form-preview-capture of
 * lib_ConvertigoMCP (js/nocode_preview_capture.js) asks the open No Code Studio page for an image of a form's preview.
 *
 * The MCP keeps them in context.server under lib_ConvertigoAssistant.hostRequests: a map of the Tigo conversations,
 * each one a map of its requests, one JSON string per request. readResponse hands the panel the pending requests of its
 * conversation and user, marked taken; the page's answer comes back through AgentHostRequestResult, which writes the
 * PNG in the conversation's attachments and marks the request done, or failed with the page's reason. Every change is
 * a compare-and-set on the JSON string: the MCP may expire the request meanwhile.
 */
if (typeof C8O === "undefined") {
  var C8O = {};
}

C8O.assistantHostRequests = C8O.assistantHostRequests || {};

(function (api) {
  var STORE_KEY = "lib_ConvertigoAssistant.hostRequests";
  var MAX_PNG_BYTES = 5 * 1024 * 1024;
  // what the page answers instead of an image (the reasons nocode-form-preview-capture explains to the agent)
  var REASONS = { sharing_off: true, declined: true, unsupported: true, unsupported_browser: true, render_timeout: true, capture_failed: true, unknown_page: true };

  function str(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
  }

  function sameUser(a, b) {
    var user = str(a).toLowerCase();
    return user.length > 0 && user === str(b).toLowerCase();
  }

  function requestsOf(host, conversationId) {
    var conversations = host.server().get(STORE_KEY);
    return conversations == null || !str(conversationId).length ? null : conversations.get(str(conversationId));
  }

  function readRequest(map, id) {
    var json = map.get(id);
    if (json == null) {
      return null;
    }
    try {
      return JSON.parse(String(json));
    } catch (_unreadable) {
      return null;
    }
  }

  function update(map, id, before, changes) {
    var next = JSON.parse(JSON.stringify(before));
    for (var key in changes) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        next[key] = changes[key];
      }
    }
    return map.replace(id, JSON.stringify(before), JSON.stringify(next)) ? next : null;
  }

  // The pending requests of the conversation for its user, marked taken: what the panel passes to its page.
  api.take = function (conversationId, userId, host) {
    var taken = [];
    var map = requestsOf(host, conversationId);
    if (map == null) {
      return taken;
    }
    var keys = map.keySet().toArray();
    for (var i = 0; i < keys.length; i++) {
      var id = String(keys[i]);
      var request = readRequest(map, id);
      var now = host.now();
      if (!request || request.status !== "pending" || !sameUser(request.user, userId) || now > Number(request.expiresAt || 0)) {
        continue;
      }
      var next = update(map, id, request, { status: "taken", takenAt: now });
      if (next) {
        taken.push({ requestId: next.id, kind: next.kind, formId: next.formId, formName: next.formName, page: next.page, device: next.device });
      }
    }
    return taken;
  };

  function byteAt(bytes, index) {
    return Number(bytes[index]) & 0xff;
  }

  // the size written in the PNG header (IHDR), never the one the page states
  api.pngSize = function (bytes) {
    var signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!bytes || Number(bytes.length) < 24) {
      return null;
    }
    for (var i = 0; i < signature.length; i++) {
      if (byteAt(bytes, i) !== signature[i]) {
        return null;
      }
    }
    var read = function (at) {
      return ((byteAt(bytes, at) * 256 + byteAt(bytes, at + 1)) * 256 + byteAt(bytes, at + 2)) * 256 + byteAt(bytes, at + 3);
    };
    return { width: read(16), height: read(20) };
  };

  function namePart(value, fallback) {
    var text = str(value).replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").substring(0, 64);
    return text.length ? text : fallback;
  }

  // params: conversationId, userId (the caller), requestId, status (done, waiting_sharing or failed), image (a PNG data
  // URL or its base64), reason. host: server(), now(), decodeBase64(text) -> bytes, write(name, bytes) -> absolute path.
  api.result = function (params, host) {
    params = params || {};
    var id = str(params.requestId);
    var map = id.length ? requestsOf(host, params.conversationId) : null;
    var request = map == null ? null : readRequest(map, id);
    if (!request || !sameUser(request.user, params.userId)) {
      return { ok: false, status: "error", error: { code: "unknown_request", message: "No capture request " + id + " in this conversation." } };
    }
    if (request.status !== "taken") {
      return { ok: false, status: "error", error: { code: "not_waiting", message: "The capture request is " + request.status + "." } };
    }
    var image = str(params.image).replace(/^data:image\/png;base64,/, "");
    var status = str(params.status) || (image.length ? "done" : "failed");
    var changed = null;
    if (status === "waiting_sharing") {
      // The user is asked to allow the preview: the MCP keeps waiting 60 s from takenAt, then answers sharing_off.
      changed = update(map, id, request, { note: "sharing_off" });
      return changed ? { ok: true, status: "waiting" } : { ok: false, status: "error", error: { code: "changed" } };
    }
    if (status !== "done") {
      var reason = REASONS[str(params.reason)] === true ? str(params.reason) : "capture_failed";
      changed = update(map, id, request, { status: "failed", error: { reason: reason } });
      return changed ? { ok: true, status: "failed", reason: reason } : { ok: false, status: "error", error: { code: "changed" } };
    }
    var bytes = null;
    try {
      bytes = image.length && image.length <= Math.ceil(MAX_PNG_BYTES / 3) * 4 ? host.decodeBase64(image) : null;
    } catch (_notBase64) {
      bytes = null;
    }
    var size = bytes && Number(bytes.length) <= MAX_PNG_BYTES ? api.pngSize(bytes) : null;
    if (!size || size.width < 1 || size.height < 1) {
      update(map, id, request, { status: "failed", error: { reason: "capture_failed" } });
      return { ok: false, status: "error", error: { code: "invalid_image", message: "The capture must be a PNG image of 5 MB at most." } };
    }
    var name = "preview-" + namePart(request.formId, "form") + "-" + namePart(request.page, "1") + "-" + namePart(request.device, "desktop") + "-" + host.now() + ".png";
    var path = host.write(name, bytes);
    changed = update(map, id, request, { status: "done", result: { path: path, absolutePath: path, width: size.width, height: size.height } });
    return changed ? { ok: true, status: "done", path: path, width: size.width, height: size.height } : { ok: false, status: "error", error: { code: "changed" } };
  };
})(C8O.assistantHostRequests);
