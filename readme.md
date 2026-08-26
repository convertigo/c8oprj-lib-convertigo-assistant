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

- Works from the Convertigo Assistant view with project-aware conversations.
- Supports OpenAI Codex and Mistral Vibe with workspace-managed CLI runtimes.
- Uses Convertigo MCP for structured project discovery, editing, and validation.
- Uses the Agent Bridge for local conversations, credentials, runtime setup, and
  long-running agent processes.
- Provides Reveal mode so supported MCP operations can select changed objects
  and open the relevant Studio or viewer surface.
- Keeps conversations and managed agent homes inside the Convertigo workspace.

## Requirements

- Convertigo Studio 8.4.4 or newer for the local Agent onboarding flow.
- Network access to the selected agent provider and package registries. Studio
  proxy settings are propagated to managed runtime downloads and processes.
- Provider credentials for OpenAI Codex or Mistral Vibe.

## Installation

Open the **Convertigo Assistant** view in Convertigo Studio. When the local Agent
stack is missing, Tigo offers to install the three required projects:

1. `ConvertigoAssistant`
2. `ConvertigoMCP`
3. `ConvertigoAgentBridge`

The one-click flow imports the release packages, switches the Assistant view to
the local relative URL, and reloads it. Tigo then guides the user through agent
selection and workspace-local CLI setup.

The companion projects are maintained separately:

- [Convertigo MCP](https://github.com/convertigo/c8oprj-c8o-mcp)
- [Convertigo Agent Bridge](https://github.com/convertigo/c8oprj-convertigo-agent-bridge)

## Updating

Agent CLI versions are checked from the Tigo configuration page and cached for
six hours. Updating the three Convertigo projects is a separate stack operation:
the installed project versions must be compared with the selected release
channel before importing newer `.car` packages.

## Development

Import the active development branch with:

```text
ConvertigoAssistant=https://github.com/convertigo/c8oprj-convertigo-assistant.git:branch=codex/assistant-agent-bridge
```

Convertigo project objects must be edited through Convertigo Studio or the
Convertigo MCP tools. Generated mobile sources under `_private` and
`DisplayObjects` are build outputs.
