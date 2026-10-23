/*
 * Serves to the Assistant page an image of the Studio workspace that the agent analysed (image-describe) or captured
 * (Playwright screenshots), for the thumbnails of its tool calls.
 *
 * Same rules as the image-describe MCP tool: a WEB_ADMIN session, a path inside the Studio user workspace or the
 * projects folder (relative paths are tried in that order, the canonical path is checked), 10 MB at most, and a PNG,
 * JPEG or WebP content (decided by the bytes, never by the name): no other file of the workspace can be read.
 *
 * A No Code user (a session without WEB_ADMIN) gets the images of their own attachments only, the ones the Agent Bridge
 * had described for a model that cannot see: agents/<provider>/users/<user>/conversations/<id>/attachments and
 * agents/attachments/<user>/ of the user workspace, the user being the one of the session, never of the request.
 */
var C8O = C8O || {};
(function (api) {
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  function str(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function byteAt(bytes, index) {
    return Number(bytes[index]) & 0xff;
  }

  api.detectMimeType = function (bytes) {
    var length = bytes ? Number(bytes.length) : 0;
    if (length >= 8 && byteAt(bytes, 0) === 0x89 && byteAt(bytes, 1) === 0x50 && byteAt(bytes, 2) === 0x4e &&
      byteAt(bytes, 3) === 0x47 && byteAt(bytes, 4) === 0x0d && byteAt(bytes, 5) === 0x0a && byteAt(bytes, 6) === 0x1a &&
      byteAt(bytes, 7) === 0x0a) {
      return "image/png";
    }
    if (length >= 3 && byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8 && byteAt(bytes, 2) === 0xff) {
      return "image/jpeg";
    }
    if (length >= 12 && byteAt(bytes, 0) === 0x52 && byteAt(bytes, 1) === 0x49 && byteAt(bytes, 2) === 0x46 &&
      byteAt(bytes, 3) === 0x46 && byteAt(bytes, 8) === 0x57 && byteAt(bytes, 9) === 0x45 && byteAt(bytes, 10) === 0x42 &&
      byteAt(bytes, 11) === 0x50) {
      return "image/webp";
    }
    return "";
  };

  // the user folder name of the Assistant (userPathSlug of agent_bridge_client.js)
  api.userPathSlug = function (value) {
    var text = str(value);
    if (!text.length || text.toLowerCase() === "studio") {
      return "studio";
    }
    var readable = text.toLowerCase().replace(/[^A-Za-z0-9_.-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!readable.length) {
      readable = "user";
    }
    if (readable.length > 80) {
      readable = readable.substring(0, 80).replace(/[_.-]+$/g, "");
    }
    var bytes = java.security.MessageDigest.getInstance("SHA-256").digest(new java.lang.String(text).getBytes("UTF-8"));
    var hash = "";
    for (var i = 0; i < 8; i++) {
      var n = Number(bytes[i]) & 0xff;
      hash += (n < 16 ? "0" : "") + n.toString(16);
    }
    return readable + "--" + hash;
  };

  // the user of the session, as the Assistant names it (callerUserId): the e-mail of a provider:id:e-mail login
  api.sessionUserId = function (ctx) {
    var user = "";
    try {
      user = str(ctx.getAuthenticatedUser());
    } catch (_noAuthenticatedUser) {}
    var parts = user.split(":");
    var last = parts[parts.length - 1];
    return parts.length > 2 && last.indexOf("@") > 0 ? last : user;
  };

  // a path relative to <user workspace>/agents that holds one of the user's attachments
  api.isOwnAttachment = function (relative, userId) {
    var slug = api.userPathSlug(userId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var rel = String(relative).replace(/\\/g, "/");
    return new RegExp("^[^/]+/users/" + slug + "/conversations/[^/]+/attachments/[^/]").test(rel)
      || new RegExp("^attachments/" + slug + "/[^/]+/[^/]").test(rel);
  };

  api.read = function (ctx, args) {
    var Engine = Packages.com.twinsoft.convertigo.engine.Engine;
    var File = java.io.File;
    var Files = java.nio.file.Files;
    var admin = Engine.authenticatedSessionManager.hasRole(ctx.httpSession,
      Packages.com.twinsoft.convertigo.engine.AuthenticatedSessionManager.Role.WEB_ADMIN) === true;
    var userId = admin ? "" : api.sessionUserId(ctx);
    if (!admin && (!userId.length || userId.toLowerCase() === "studio")) {
      return { ok: false, error: { code: "authentication_required" } };
    }
    var pathText = str(args && args.path);
    if (!pathText.length || pathText.length > 1024 || pathText.indexOf("\u0000") !== -1) {
      return { ok: false, error: { code: "invalid_path" } };
    }
    var roots = [];
    (admin ? [Engine.USER_WORKSPACE_PATH, Engine.PROJECTS_PATH] : [str(Engine.USER_WORKSPACE_PATH).length ? Engine.USER_WORKSPACE_PATH + "/agents" : ""]).forEach(function (root) {
      if (str(root).length) {
        roots.push(new File(String(root)).getCanonicalFile());
      }
    });
    var inside = function (file) {
      for (var i = 0; i < roots.length; i++) {
        if (file.toPath().startsWith(roots[i].toPath())) {
          return admin || api.isOwnAttachment(String(roots[i].toPath().relativize(file.toPath())), userId);
        }
      }
      return false;
    };
    var candidates = [];
    var given = new File(pathText);
    if (given.isAbsolute()) {
      candidates.push(given.getCanonicalFile());
    } else {
      for (var r = 0; r < roots.length; r++) {
        candidates.push(new File(roots[r], pathText).getCanonicalFile());
      }
    }
    var file = null;
    for (var c = 0; c < candidates.length && file === null; c++) {
      if (inside(candidates[c]) && candidates[c].isFile()) {
        file = candidates[c];
      }
    }
    if (file === null) {
      return { ok: false, error: { code: "not_found" } };
    }
    if (file.length() > MAX_IMAGE_BYTES) {
      return { ok: false, error: { code: "too_large" } };
    }
    var bytes = Files.readAllBytes(file.toPath());
    var mimeType = api.detectMimeType(bytes);
    if (!mimeType.length) {
      return { ok: false, error: { code: "not_an_image" } };
    }
    return { ok: true, mimeType: mimeType, data: String(java.util.Base64.getEncoder().encodeToString(bytes)) };
  };
})(C8O.assistantWorkspaceImage = C8O.assistantWorkspaceImage || {});
