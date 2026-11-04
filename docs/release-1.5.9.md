# Tigo 1.5.9

The matching stack is Assistant 1.5.9, Agent Bridge 0.4.31 and MCP 0.2.29, built with the Convertigo 8.4.6 plugin.

Local TigoAccess activation and quota reads now use the configured agents directory, matching the runtime reader. Studio identity is still read from the original engine workspace.

On Windows, new managed Vibe conversation homes use a compact layout with a full-UUID Base32 token derived from owner, provider profile and conversation. User credential homes and logical conversation IDs remain unchanged. The known journal pattern is estimated at 197 characters under `C:\Tigo`; diagnostics reserve 32 characters and advise on the selected root. Existing directories are retained. Stop active turns and validate with a new conversation.

Installation and reinstallation fetch fresh, validated manifests before importing any project. A unique HTTP query revision and no-cache request headers avoid reusing an intermediary response. Failed or malformed checks do not install the embedded fallback. Duplicate clicks are serialized, newer installed versions are not downgraded, and late background responses cannot overwrite a newer check. An unverified catalog no longer reports that the stack is up to date.

See [storage configuration](agents-directory.md). Native Windows installation remains an acceptance check on the target environment.
