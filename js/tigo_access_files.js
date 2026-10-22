// Local credential files for TigoAccess. Java 8+ NIO; also used on Studio 8.4.6.
// File.setReadable(false, false) cannot restrict Windows access: use its ACL view.
var TigoAccessFiles = (function () {
  function unavailable() {
    var error = new Error("Private credential permissions are unavailable");
    error.tigoAccessCode = "private_permissions_unavailable";
    throw error;
  }

  function create(directory, safePath) {
    var Files = java.nio.file.Files;
    var attributes = java.nio.file.attribute;
    var noFollow = java.nio.file.LinkOption.NOFOLLOW_LINKS;

    function restrict(path) {
      safePath(path);
      var posix = Files.getFileAttributeView(path, attributes.PosixFileAttributeView, noFollow);
      if (posix !== null) {
        posix.setPermissions(attributes.PosixFilePermissions.fromString(
          Files.isDirectory(path, noFollow) ? "rwx------" : "rw-------"
        ));
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
      if (Files.isDirectory(path, noFollow)) {
        entry.setFlags(attributes.AclEntryFlag.FILE_INHERIT, attributes.AclEntryFlag.DIRECTORY_INHERIT);
      }
      var entries = new java.util.ArrayList();
      entries.add(entry.build());
      acl.setAcl(entries);
    }

    function writePrivate(path, text) {
      safePath(directory);
      safePath(path);
      var temporary = Files.createTempFile(directory, "tigo-", ".tmp");
      try {
        restrict(temporary);
        Files.write(temporary, new java.lang.String(String(text)).getBytes("UTF-8"));
        safePath(path);
        Files.move(temporary, path,
          java.nio.file.StandardCopyOption.ATOMIC_MOVE,
          java.nio.file.StandardCopyOption.REPLACE_EXISTING);
      } finally {
        Files.deleteIfExists(temporary);
      }
    }

    return { restrict: restrict, writePrivate: writePrivate };
  }

  function failure(error, operation) {
    var cause = "filesystem_error";
    if (error && error.tigoAccessCode === "private_permissions_unavailable") {
      cause = "private_permissions_unavailable";
    } else {
      var exception = error && (error.javaException || error);
      var name = "";
      try { name = String(exception.getClass().getSimpleName()); } catch (ignored) {}
      if (name === "AccessDeniedException" || name === "SecurityException") {
        cause = "access_denied";
      } else if (name === "AtomicMoveNotSupportedException") {
        cause = "atomic_move_not_supported";
      }
    }
    // Never return exception messages: they may contain credential data or private paths.
    return { operation: operation, cause: cause };
  }

  return { create: create, failure: failure };
})();
