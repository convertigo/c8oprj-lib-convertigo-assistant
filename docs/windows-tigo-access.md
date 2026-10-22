# TigoAccess credential installation on Windows

`local_installation_failed` occurs after TigoAccess returned a validated account,
key and quota. It is distinct from PSC validation and runtime installation.

The old installer called `File.setReadable(false, false)` before writing the key.
OpenJDK's Windows implementation returns `false` for disabling read access through
this API; it does not manage Windows ACLs. Consequently every fresh Windows offer
could fail before the key was written, even in a writable local workspace.

`js/tigo_access_files.js` now applies the filesystem's native security model:

- POSIX: directory 0700 and files 0600.
- Windows: an ACL granting access to the signed-in process user, including its
  domain. The credential directory passes this restriction to new children.
- Filesystems without supported private permissions: fail before storing a key.

The existing symlink checks, private temporary files and atomic replacement stay
in place. A configured manual key is still preserved by the bootstrap.

The response retains `code: local_installation_failed` and adds a safe diagnostic:

- `operation`: `prepare_directory`, `restrict_directory`, `write_key`,
  `write_metadata` or `cache_access`.
- `cause`: `access_denied`, `private_permissions_unavailable`,
  `atomic_move_not_supported` or `filesystem_error`.

AgentSetup carries the actual local error into its setup message. Logs and public
diagnostics do not contain the API key, PSC secret, exception message or absolute
filesystem path. A network workspace may still reject ACL changes or atomic
replacement; its diagnostic must guide troubleshooting rather than silently
weakening credential protection.

Retrying activation uses the existing offer and key. It does not add another
10 USD budget. If a valid manual key is already available through the customer's
normal credential provisioning, putting it in `agents/convertigo/llm-api-key`
under the **Engine workspace** bypasses offer provisioning. Do not put credentials
in a project repository or send them in support messages.

## Validation

`tests/tigo_access_files.test.cjs` covers Windows ACL construction, domain identity,
POSIX permissions, failure before secret writes, temporary-file cleanup and safe
diagnostics. The required Windows CI job also runs
`tests/java/TigoAccessFilesNativeTest.java` against real NTFS ACLs and atomic
replacement under Java 17. The canonical installation step ran successfully with the
official Studio 8.4.6 Rhino and real Java NIO on macOS, using a fake key and an
isolated temporary directory. These checks do not replace a native Windows test.

Reference: [OpenJDK Windows File permission implementation](https://github.com/openjdk/jdk/blob/master/src/java.base/windows/native/libjava/WinNTFileSystem_md.c).
