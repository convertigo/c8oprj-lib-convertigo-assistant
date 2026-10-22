# Tigo 1.5.4

Stable Studio bundle: Assistant **1.5.4**, Agent Bridge **0.4.26** and MCP
**0.2.26**, compatible with Convertigo **8.4.6**.

## Windows Tigo offer activation

Fresh Windows installations could receive their Tigo offer successfully but fail
to save its key in the Studio workspace. The previous permission API could not
restrict Windows read access and stopped installation before the key was written.

- Use native Windows ACLs for the signed-in domain user. POSIX directory 0700 and
  file 0600 permissions are retained.
- Keep private temporary files, atomic replacement, symlink checks and existing
  manually configured keys.
- Report the actual local installation error, with a sanitized operation/cause
  diagnostic, instead of asking the user to check an already validated PSC.
- Retrying retrieves the existing offer and key; it does not grant another 10 USD.

No runtime reinstallation or new PSC is needed for this fix. Update the Assistant
project through the stable stack update, reopen the Assistant view, then retry
Convertigo mode activation. If activation still fails, include its
`tigoAccess.diagnostic` in the support report, without credentials.

## Validation and distribution

The build uses the official Convertigo Gradle plugin **8.4.6**. Regression checks
cover ACL construction and domain identity, POSIX permissions, failure before
credential writes, temporary-file cleanup and safe diagnostics. A required CI job
also exercises real NTFS ACLs and atomic replacement on Windows with Java 17.
The canonical installation and setup steps were checked with the official
Studio 8.4.6 Rhino and native Java NIO on macOS using a fake key.

The stable manifest, compatibility alias and embedded fallback select this
bundle. The preview manifest also receives the fix. Bridge and MCP use their
existing published archives.

This release is distributed to Studio users without deploying to backend-apps.
The hosted Assistant and TigoAccess are not changed by this publication.

<!-- [skip deploy] -->
