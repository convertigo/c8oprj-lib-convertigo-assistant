// Local credential files for TigoAccess. Java 8+ NIO; also used on Studio 8.4.6.
// File.setReadable(false, false) cannot restrict Windows access: use its ACL view.
var TigoAccessFiles = (function () {
  // Windows refuses to replace a file while another handle holds it or the temporary file without sharing its
  // deletion (a second installation, an antivirus, an indexer, a sync client): AccessDenied, or a sharing violation
  // reported as a plain FileSystemException. Such holds last milliseconds; the move is tried again before failing.
  var MOVE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

  function unavailable() {
    var error = new Error("Private credential permissions are unavailable");
    error.tigoAccessCode = "private_permissions_unavailable";
    throw error;
  }

  function exceptionName(error) {
    var exception = error && (error.javaException || error);
    try { return String(exception.getClass().getSimpleName()); } catch (ignored) { return ""; }
  }

  function transientMoveFailure(error) {
    var name = exceptionName(error);
    return name === "AccessDeniedException" || name === "FileSystemException";
  }

  // One installation at a time per credential directory in this engine: the turns of two tabs refresh the access
  // together. include() evaluates this file again on every run, so the monitor is an interned string, as in
  // tigo_resources.js, and never Engine.theApp, which every requestable takes.
  function serialized(directory, fn) {
    var monitor = new java.lang.String("lib_ConvertigoAssistant.tigoAccess.install:" +
      String(directory.toAbsolutePath().normalize())).intern();
    return new Packages.org.mozilla.javascript.Synchronizer(function () {
      return fn();
    }, monitor)();
  }

  function create(directory, safePath) {
    var Files = java.nio.file.Files;
    var attributes = java.nio.file.attribute;
    var noFollow = java.nio.file.LinkOption.NOFOLLOW_LINKS;
    var moveAttempts = 0;

    // Applies private permissions, unless the path already has exactly them: a refresh writes nothing.
    function restrict(path) {
      safePath(path);
      var isDirectory = Files.isDirectory(path, noFollow);
      var posix = Files.getFileAttributeView(path, attributes.PosixFileAttributeView, noFollow);
      if (posix !== null) {
        var mode = isDirectory ? "rwx------" : "rw-------";
        var current = "";
        try { current = String(attributes.PosixFilePermissions.toString(posix.readAttributes().permissions())); } catch (ignored) {}
        if (current !== mode) {
          posix.setPermissions(attributes.PosixFilePermissions.fromString(mode));
        }
        return;
      }
      var acl = Files.getFileAttributeView(path, attributes.AclFileAttributeView, noFollow);
      if (acl === null) {
        unavailable();
      }
      // Resolve the current process user, rather than a possibly shared directory owner.
      var userName = String(java.lang.System.getProperty("user.name"));
      if (String(java.lang.System.getProperty("os.name")).toLowerCase().indexOf("windows") === 0) {
        var identity = new Packages.com.sun.security.auth.module.NTSystem();
        var domain = String(identity.getDomain());
        userName = (domain.length ? domain + "\\" : "") + String(identity.getName());
      }
      var principal = path.getFileSystem().getUserPrincipalLookupService()
        .lookupPrincipalByName(userName);
      var entry = attributes.AclEntry.newBuilder()
        .setType(attributes.AclEntryType.ALLOW)
        .setPrincipal(principal)
        .setPermissions(java.util.EnumSet.allOf(attributes.AclEntryPermission));
      if (isDirectory) {
        entry.setFlags(attributes.AclEntryFlag.FILE_INHERIT, attributes.AclEntryFlag.DIRECTORY_INHERIT);
      }
      var wanted = entry.build();
      try {
        var installed = acl.getAcl();
        if (installed.size() === 1 && wanted.equals(installed.get(0))) {
          return;
        }
      } catch (ignored) {}
      var entries = new java.util.ArrayList();
      entries.add(wanted);
      acl.setAcl(entries);
    }

    // Whether path already holds exactly these bytes; a file that cannot be read now is written as before.
    function holds(path, bytes) {
      try {
        if (!Files.isRegularFile(path, noFollow) || Number(Files.size(path)) !== Number(bytes.length)) {
          return false;
        }
        return java.util.Arrays.equals(Files.readAllBytes(path), bytes) === true;
      } catch (unreadable) {
        return false;
      }
    }

    // Moves temporary over path, again while another handle holds one of them. Returns whether it moved; false when
    // another installation (another Studio on this agents directory) wrote the same bytes meanwhile.
    // Keep this loop flag-driven, in a function of its own, without return in its try: the compiled mode of the
    // Rhino of Convertigo 8.5 skips a catch whose try returns inside a loop wrapped in try/finally.
    function moveReplacing(temporary, path, bytes) {
      var moved = null, failure = null;
      while (moved === null && failure === null) {
        safePath(path);
        moveAttempts++;
        try {
          Files.move(temporary, path,
            java.nio.file.StandardCopyOption.ATOMIC_MOVE,
            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
          moved = true;
        } catch (moveError) {
          if (moveAttempts > MOVE_RETRY_DELAYS_MS.length || !transientMoveFailure(moveError)) {
            failure = moveError;
          } else {
            java.lang.Thread.sleep(MOVE_RETRY_DELAYS_MS[moveAttempts - 1]);
            if (holds(path, bytes)) {
              moved = false;
            }
          }
        }
      }
      if (failure !== null) {
        throw failure;
      }
      return moved;
    }

    // Replaces path with text through a private temporary file and an atomic move. Returns false, without writing
    // anything, when path already holds exactly these bytes.
    function writePrivate(path, text) {
      moveAttempts = 0;
      safePath(directory);
      safePath(path);
      var bytes = new java.lang.String(String(text)).getBytes("UTF-8");
      if (holds(path, bytes)) {
        return false;
      }
      var temporary = Files.createTempFile(directory, "tigo-", ".tmp");
      try {
        restrict(temporary);
        Files.write(temporary, bytes);
        return moveReplacing(temporary, path, bytes);
      } finally {
        Files.deleteIfExists(temporary);
      }
    }

    return {
      restrict: restrict,
      writePrivate: writePrivate,
      // The moves the last writePrivate tried, for the diagnostic of its failure.
      attempts: function () { return moveAttempts; }
    };
  }

  function failure(error, operation, attempts) {
    var cause = "filesystem_error";
    var name = exceptionName(error);
    if (error && error.tigoAccessCode === "private_permissions_unavailable") {
      cause = "private_permissions_unavailable";
    } else if (name === "AccessDeniedException" || name === "SecurityException") {
      cause = "access_denied";
    } else if (name === "AtomicMoveNotSupportedException") {
      cause = "atomic_move_not_supported";
    }
    // Never return exception messages: they may contain credential data or private paths. A class name does not.
    var diagnostic = { operation: operation, cause: cause };
    if (/^[A-Za-z][A-Za-z0-9_$]{0,80}$/.test(name)) {
      diagnostic.exception = name;
    }
    if (Number(attempts) > 1) {
      diagnostic.attempts = Number(attempts);
    }
    return diagnostic;
  }

  // The engine log line of a failed installation; keyInPlace: the key and metadata in place are the selected ones.
  function logLine(diagnostic, keyInPlace) {
    var line = "TigoAccess local credential installation failed (" + diagnostic.operation + ", " + diagnostic.cause + ")";
    var details = [];
    if (diagnostic.exception) {
      details.push(diagnostic.exception);
    }
    if (diagnostic.attempts) {
      details.push(diagnostic.attempts + " move attempts");
    }
    if (details.length) {
      line += ": " + details.join(", ");
    }
    if (keyInPlace) {
      line += "; the key in place is already the selected one, Tigo stays ready";
    }
    return line;
  }

  return { create: create, failure: failure, serialized: serialized, logLine: logLine };
})();
