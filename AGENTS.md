# Convertigo Assistant Notes

This project is the user-facing AI agent assistant embedded in Convertigo
Studio/Web/NoCode. Keep this file current when workflow decisions, UI behavior,
or bridge contracts change, so another agent can resume the work without
rediscovering the same context.

## Convertigo Project Editing

- Do not hand-edit `_c8oProject/*.yaml` or `c8oProject.yaml`.
- Use the Convertigo MCP tools for every Convertigo object mutation, then verify
  the live tree with `databaseobject_tree_get` when needed.
- Direct edits are acceptable for plain source files such as `js/*.js`,
  `css/*.css`, documentation, and this `AGENTS.md`.
- After editing JavaScript helpers, run `node --check` on the touched files.
- Do not patch generated frontend output under `DisplayObjects`, `_private`,
  `dist`, or similar generated directories.

## Current Purpose

- The former "component assistant" UI is becoming a general "Agent IA" surface.
- The agent should act on the currently selected Convertigo project through the
  bridge and Convertigo MCP, not only generate component snippets.
- Existing Figma and LightRAG areas still exist; keep agent-specific changes
  scoped to the agent page/bridge path unless the user asks otherwise.
- User-facing prompts should instruct the LLM in English, but the agent must
  answer the user in the user's language.

## Current 1.2.0 Roadmap

- Rework the agent page toward the Codex Desktop interaction model while keeping
  it usable in a narrow Studio/C8Oforms drawer.
- Keep conversation management in a compact top cartouche or popover, not in a
  permanent left sidebar. Show provider, model, state, and creation time.
- Agent provider selection is a global setting exposed in the agent management
  panel/drawer, not in the prompt footer and not asked again for every new
  conversation. Model and reasoning remain lightweight prompt/runtime controls.
  Managed Convertigo skills remain invisible to the user: Studio uses
  `convertigo-generalist`, while C8Oforms/NoCode uses `convertigo-nocode`.
- Models and reasoning choices must come from the bridge/CLI capability contract,
  not from UI-only hardcoded lists.
- Keep start templates only on the new conversation screen.
- Preserve accumulated progress steps after completion and collapse them by
  default, similar to Codex Desktop.
- Build the style with light/dark theme variables now, then align it with
  C8Oforms in a second pass.

## Bridge Contract

- Main client file: `js/agent_bridge_client.js`.
- Bridge project: `c8oprj-convertigo-agent-bridge`.
- Codex is the priority provider; Vibe remains supported.
- The default Codex home scope sent by the Assistant is `user`.
- Managed Codex homes are visible directories under the Convertigo workspace,
  ending with `codex-home`, not `.codex-home`.
- Do not auto-start Vibe when no conversation exists; the user should be able to
  choose the agent/provider for a new conversation.
- Do not auto-resume the latest conversation on view startup. Startup should
  prepare settings and list conversations; the first prompt creates a new
  conversation unless an explicit conversation is resumed.

## UI Expectations

- The assistant is a product UI seen by customers. It must feel like talking to
  an agent that is working for the user.
- Progress should accumulate like Codex Desktop: meaningful steps remain visible,
  then collapse when the final answer arrives. Do not replace progress with the
  final answer or duplicate the final answer.
- Do not force scroll-to-bottom while the user is manually scrolling. Sticky
  bottom should resume only when the user returns to the bottom or presses the
  bottom control.
- Scroll controls should be discreet and must not block the conversation content.
- Diagnostic/setup UI should be integrated in the page, not implemented with
  blocking browser popups.
- Keep i18n keys translated before committing UI text changes.

## Runtime Notes

- No WebSocket dependency for now. Use the existing long-polling path for agent
  event reads.
- Keep polling reasonable; avoid noisy idle polling in Studio logs.
- Runtime surface must drive navigation and capabilities:
  - Admin Console / knowledge context shows only the How-To assistant.
  - Studio Java bridge context may show How-To, component assistant, Figma, and
    Agent IA.
  - C8Oforms / NoCode context should open Agent IA by default through the
    Assistant iframe with `assistantContext=nocode`, `agentProfile=nocode`,
    the authenticated `userId`, `projectContext=optional`, and `user` home
    scopes for Codex and Vibe. Do not force a working project from the iframe;
    conversations are user/agent/conversation scoped and projects are only
    metadata when explicitly selected or inferred from the conversation.
  - Server/NoCode Agent IA is allowed only when an explicit server/no-code
    capability flag is provided; never infer it from the remote host alone.
- In C8Oforms/NoCode, the MCP bearer token is created automatically from the
  authenticated C8Oforms session and stored behind an opaque server-memory
  handle. The Assistant may pass the handle to the bridge, but must never expose
  the raw token in URLs, UI state, prompts, logs, or conversation records.
- `agentBridge=1` is not enough to call the bridge. If the Assistant is served
  remotely inside Studio and no local bridge capability/local URL is provided,
  show an integrated local-agent activation message and do not call the remote
  beta/prod bridge.
- Conversation management must expose resume/delete/new conversation flows and
  show useful metadata such as provider, model, state, and creation time.
- Conversations are scoped by user and agent/conversation id. Projects are
  optional metadata (`projectNames`, `primaryProject`) and must not be inferred
  from an unrelated Studio or NoCode selection unless the caller explicitly asks
  for current/selected project context.
- Codex conversations must never use a conversation-local `codex-home`. If a
  legacy conversation record has `codexHome`, `agentHome`, or `vibeHome` under
  `/conversations/<id>/codex-home`, drop those values and clear
  `externalSessionId` so the next run starts from the user-scoped `CODEX_HOME`
  configured with MCP tools and the correct skill profile.
- Image attachment from files exists; clipboard image paste is a desired feature.

## Validation

- For client JavaScript changes, run `node --check js/agent_bridge_client.js`.
- For Convertigo UI/object changes, use MCP validation such as
  `mobile_builder_open` or the relevant requestable execution instead of manual
  edits to generated files.
- Before a demo, verify a fresh Codex conversation can list Convertigo projects
  through the Convertigo Generalist skill and MCP, without using a local
  hardcoded fast path.
