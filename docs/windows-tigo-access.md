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

- `operation`: `prepare_directory`, `restrict_directory`, `read_installed`,
  `write_key` or `write_metadata`.
- `cause`: `access_denied`, `private_permissions_unavailable`,
  `atomic_move_not_supported` or `filesystem_error`.
- `exception`: the Java exception class only (a Windows sharing violation is a
  plain `FileSystemException`), and `attempts` when the move was tried again.

The engine log keeps the same facts, never a path or a key:
`TigoAccess local credential installation failed (write_metadata, access_denied): AccessDeniedException, 6 move attempts`.

## Refreshes and held files

Every Studio turn calls `TigoAccessBootstrap` with `refresh=true`. Until
1.6.0-beta.47 each call replaced `tigo-access.json` (its `updatedAt` and quota
always differed) and set the directory ACL again. On Windows a replacement fails
with `AccessDenied` or a sharing violation while another handle holds the target
or the temporary file without sharing its deletion: the bootstrap of a second
tab, an antivirus, an indexer or a sync client. The turn then failed although the
key had not changed (customer report of 2026-11-23, Studio 8.4.7, 1.6.0-beta.39).

Since then:

- nothing identical is written: the key only when it changes, the metadata only
  when what names the key changes (`version`, `source`, `subject`, `email`,
  `keyHash`; no reader takes `updatedAt`, `account` or `quota` from the file),
  any file whose bytes are already the same, and permissions already private;
- one installation at a time per credential directory in the engine
  (`TigoAccessFiles.serialized`, an interned-string monitor);
- a move refused as `AccessDeniedException` or `FileSystemException` is tried
  six times in about 1.5 s (50, 100, 200, 400, 800 ms) and stops early when the
  target already holds the same bytes;
- a failure still answers `ok` when the selected key and the metadata naming it
  are in place (unchanged, or written meanwhile by another tab), and the log line
  ends with `the key in place is already the selected one, Tigo stays ready`.

Another Studio sharing the same `assistant.agents.directory` is not under the
engine monitor; the retries and the identical-bytes check cover it.

Keep the retry loop in `moveReplacing` flag-driven, in a function of its own,
without `return` inside its `try`: in compiled mode, the Rhino of Convertigo
8.4.8 and 8.5 skips a `catch` whose `try` returns inside a loop wrapped in
`try/finally`. The native test runs interpreted and compiled for that reason.

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
POSIX permissions, failure before secret writes, temporary-file cleanup, safe
diagnostics, identical writes skipped, held files retried and the engine monitor.
`tests/tigo_access_switch.test.cjs` runs the canonical `InstallLocalAccess` step:
no write on a plain refresh, `ok` with the selected key in place despite a held
file, rollback of a failed key switch. The required Windows CI job also runs
`tests/java/TigoAccessFilesNativeTest.java` against real NTFS ACLs and atomic
replacement under Java 17, with a file held by `java.io` (released after 300 ms,
then for good) and four concurrent installers beside a reader; on macOS the
immutable flag stands in for the held file. The canonical installation step ran successfully with the
official Studio 8.4.6 Rhino and real Java NIO on macOS, using a fake key and an
isolated temporary directory. These checks do not replace a native Windows test.

Reference: [OpenJDK Windows File permission implementation](https://github.com/openjdk/jdk/blob/master/src/java.base/windows/native/libjava/WinNTFileSystem_md.c).
