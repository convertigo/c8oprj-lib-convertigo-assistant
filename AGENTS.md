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
- New conversations must ask for agent provider, model, and reasoning level.
  The Convertigo Generalist skill remains forced and invisible to the user.
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
- Conversation management must expose resume/delete/new conversation flows and
  show useful metadata such as provider, model, state, and creation time.
- Image attachment from files exists; clipboard image paste is a desired feature.

## Validation

- For client JavaScript changes, run `node --check js/agent_bridge_client.js`.
- For Convertigo UI/object changes, use MCP validation such as
  `mobile_builder_open` or the relevant requestable execution instead of manual
  edits to generated files.
- Before a demo, verify a fresh Codex conversation can list Convertigo projects
  through the Convertigo Generalist skill and MCP, without using a local
  hardcoded fast path.
