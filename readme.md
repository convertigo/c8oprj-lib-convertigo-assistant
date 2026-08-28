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

1. `lib_ConvertigoAssistant`
2. `lib_ConvertigoMCP`
3. `lib_ConvertigoAgentBridge`

The one-click flow imports the release packages, switches the Assistant view to
the local relative URL, and reloads it. Tigo then guides the user through agent
selection and workspace-local CLI setup.

The companion projects are maintained separately:

- [Convertigo MCP](https://github.com/convertigo/c8oprj-c8o-mcp)
- [Convertigo Agent Bridge](https://github.com/convertigo/c8oprj-convertigo-agent-bridge)

## Updating

Agent CLI versions are checked from the Tigo configuration page and cached for
six hours. The same page compares the installed Assistant, MCP, and Agent Bridge
versions with the published `stack-release.json` manifest. When an update is
available, Tigo can import the three selected `.car` packages and reload the
Assistant view. The manifest is fetched through a Convertigo HTTP connector, so
the configured Convertigo proxy is used and the response is cached for six hours.

Projects imported from local Git checkouts are detected as source-managed and
are never overwritten by this operation.

## Development

Import the active development branch with:

```text
lib_ConvertigoAssistant=https://github.com/convertigo/c8oprj-convertigo-assistant.git:branch=master
```

Convertigo project objects must be edited through Convertigo Studio or the
Convertigo MCP tools. Generated mobile sources under `_private` and
`DisplayObjects` are build outputs.
