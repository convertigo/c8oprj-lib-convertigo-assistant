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
- Uses short-lived managed MCP credentials that remain server-side behind
  opaque handles instead of entering browser state or conversation history.
- Provides Reveal mode so supported MCP operations can select changed objects
  and open the relevant Studio or viewer surface.
- Keeps conversations and managed agent homes inside the Convertigo workspace.

## Requirements

- Convertigo Studio 8.4.4 or newer for the local Agent onboarding flow.
- Network access to the selected agent provider and package registries. Studio
  proxy settings are propagated to managed runtime downloads and processes.
- Provider credentials for OpenAI Codex or Mistral Vibe.
- A `WEB_ADMIN` Studio session for the automatic local MCP credential flow.

## Installation

The hosted Assistant opens How-To by default. Component and Figma assistants
remain available in Studio; local Agent onboarding is currently early access.
On Studio 8.4.4 or newer, set the Assistant URL to
`https://assistant.convertigo.com/#early-access-agent` and reopen the view.
Tigo then offers to install the three required projects when the stack is missing:

1. `lib_ConvertigoAssistant`
2. `lib_ConvertigoMCP`
3. `lib_ConvertigoAgentBridge`

The one-click flow imports the release packages, switches the Assistant view to
the local relative URL, and reloads it. Tigo then guides the user through agent
selection and workspace-local CLI setup. The saved local URL has no fragment:
once the view uses the local Assistant and the stack is available, Tigo opens
without an early access flag, subject to the minimum Studio version. To return
to classic assistants, configure the hosted URL without the fragment and reopen
the view. Conversations and installed runtimes are retained. Merely having the
projects installed does not unlock Tigo in the hosted Assistant.

The fragment enables a preview interface; it is not an authentication token.
Studio Web server integrations and C8Oforms keep their existing capability and
authentication requirements.

The companion projects are maintained separately:

- [Convertigo MCP](https://github.com/convertigo/c8oprj-lib-c8o-mcp)
- [Convertigo Agent Bridge](https://github.com/convertigo/c8oprj-lib-convertigo-agent-bridge)

## Updating

Agent CLI versions are checked from the Tigo configuration page and cached for
six hours. The same page compares the installed Assistant, MCP, and Agent Bridge
versions with the published `stack-release.json` manifest. When an update is
available, Tigo can import the three selected `.car` packages and reload the
Assistant view. The manifest is fetched through a Convertigo HTTP connector, so
the configured Convertigo proxy is used and the response is cached for six hours.

Projects imported from local Git checkouts are detected as source-managed and
are never overwritten by this operation.

## C8Oforms integration

In the embedded NoCode surface, Tigo uses the authenticated C8Oforms user and
the NoCode tool profile. Conversations retain their form/page/element context;
resuming a conversation validates access before selecting the saved subject.
Successful form creation and updates can focus the form as soon as the saved
result is available. Studio keeps its own session, routing and capabilities.
The Baserow gateway is unchanged.

## Development

The `HandlePostMessage` application initialization action owns
`agentReleasePolicy`: `publiclyAvailable` defaults to `false`, and
`minimumStudioVersion` is `8.4.4`. To announce general availability, change the
first setting to `true` through MCP and publish the hosted Assistant. Raise the
minimum version if required; the preview fragment never bypasses this minimum.
Run `node tests/assistant_early_access.test.js` after changing this policy or
its routing integration.

Import the active development branch with:

```text
lib_ConvertigoAssistant=https://github.com/convertigo/c8oprj-lib-convertigo-assistant.git:branch=master
```

Convertigo project objects must be edited through Convertigo Studio or the
Convertigo MCP tools. Generated mobile sources under `_private` and
`DisplayObjects` are build outputs.
