<p align="center">
  <img src="assets/tigo-head.png" alt="Tigo" width="220">
</p>

# Tigo, the Convertigo agent

Tigo brings a local AI agent into Convertigo Studio. It connects OpenAI Codex
or Mistral Vibe to the current workspace through Convertigo MCP and the
Convertigo Agent Bridge.

Tigo can inspect and modify Convertigo projects, run backend requests, open NGX
viewers, validate visible behavior, and reveal changes in Studio while the agent
works.

## Highlights

- Project-aware conversations in the Convertigo Assistant view.
- Workspace-managed OpenAI Codex and Mistral Vibe runtimes.
- Structured project discovery, editing, and validation through Convertigo MCP.
- Local conversation and process management through Convertigo Agent Bridge.
- Short-lived managed MCP credentials that never enter browser state or
  conversation history.
- Reveal mode for supported Studio, viewer, and No Code Studio operations.

## Requirements

- Convertigo Studio 8.4.4 or newer.
- Network access to the selected provider and package registries.
- Provider credentials for OpenAI Codex or Mistral Vibe.
- A `WEB_ADMIN` Studio session for automatic local MCP credentials.

## Installation

Open the **Convertigo Assistant** view. When the local Agent stack is missing,
Tigo offers to install `lib_ConvertigoAssistant`, `lib_ConvertigoMCP`, and
`lib_ConvertigoAgentBridge`, configure the local relative Assistant URL, and reload
the view.

The Tigo configuration page also compares installed project versions with the
published stack manifest and can update CAR-managed installations. The manifest
uses the configured Convertigo proxy and is cached for six hours. Local Git
checkouts are detected and are never overwritten automatically.

### Server installations (No Code Studio, C8Oforms, hosted Assistant)

When the Assistant runs on a Convertigo server instead of Studio, the same
**Update the stack** button installs or updates `lib_ConvertigoMCP`,
`lib_ConvertigoAgentBridge` and `lib_ConvertigoAssistant` on that server through
the engine project importer (`AgentStackStatus` and `AgentStackInstall`
sequences). Only the official GitHub release CARs listed in the published
manifest are accepted, whatever the browser sends. The Assistant is imported
last and the page reloads once it has been replaced.

Access is controlled by the global symbol `assistant.stack.selfupdate`:

| Value | Who can install or update the stack |
| --- | --- |
| `admin` (default) | Sessions holding the `WEB_ADMIN` or `PROJECTS_CONFIG` role, for example after signing in to the administration console in the same browser session. |
| `authenticated` | Administrators and any request whose Convertigo context has an authenticated user (C8Oforms sessions). |
| `true` | Anyone reaching the Assistant. Reserve this for private test servers. |
| `false` | Nobody; the button stays disabled. |

## Companion projects

- [Convertigo MCP](https://github.com/convertigo/c8oprj-lib-c8o-mcp)
- [Convertigo Agent Bridge](https://github.com/convertigo/c8oprj-lib-convertigo-agent-bridge)

## Development import

```text
lib_ConvertigoAssistant=https://github.com/convertigo/c8oprj-lib-convertigo-assistant.git:branch=master
```
