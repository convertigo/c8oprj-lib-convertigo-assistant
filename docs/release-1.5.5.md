# Tigo 1.5.5

Stable Studio bundle: Assistant **1.5.5**, Agent Bridge **0.4.27** and MCP
**0.2.27**, compatible with Convertigo **8.4.6**.

## Personal and shared team access

The Studio refreshes managed TigoAccess credentials before every Convertigo-agent
turn. A membership change switches between the user's preserved personal key and
the key for that user and team. Manual keys remain untouched, credential writes
remain private and atomic, and a failed metadata replacement restores the old key.

The quota popup distinguishes active access, the shared team budget, the user's
own team usage and preserved personal credit. Exhausted team access does not
silently spend personal credit. Model metadata is refreshed after a scope change
without reinstalling a runtime. TigoAccess is deployed separately; legacy users
with duplicate aggregate restrictions require a reviewed migration.

## NoCode integration

This release includes the NoCode work from `fix/nocode-server-tigo` in all three
projects: authenticated server conversation ownership, serialized and verified
NoCode token creation, token invalidation after rejection, feedback consent per
NoCode user, and refreshing resident agents when the Convertigo MCP tool catalog
changes. Newly created NoCode applications open in the editor.

The MCP adds application creation from a business specification and explicit
form publication. Baserow generation handles business labels, Boolean choices,
requested columns, filters and the user's own workspace. Failed tool answers
report the actionable error before partial actions.

## Claude authentication

The Bridge uses canonical CLI/home paths for authentication caching and
invalidates the cached verdict after a successful login, including the persisted
cache. Completed-login polling does not repeatedly discard the new verdict.

## Distribution

The stable manifest, compatibility alias, embedded fallback and preview manifest
select the same three published CARs. Only lib_ConvertigoAssistant is deployed to
backend-apps for assistant.convertigo.com. Bridge and MCP are installed locally
in Studio, or on a separately configured NoCode execution server.

Validation includes the Assistant and NoCode regressions, Bridge cache/runtime
checks, MCP NoCode compiler/publishing checks, official Studio 8.4.6 production
compilation, native Windows credential CI and published archive checksum checks.
The PSC pilot verified both membership directions without modifying the personal
key's budget or spending.
