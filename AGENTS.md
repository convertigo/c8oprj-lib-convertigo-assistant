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

- The former "component assistant" UI is becoming Tigo, the general Convertigo
  agent surface.
- The agent should act on the currently selected Convertigo project through the
  bridge and Convertigo MCP, not only generate component snippets.
- Existing Figma and LightRAG areas still exist; keep agent-specific changes
  scoped to the agent page/bridge path unless the user asks otherwise.
- User-facing prompts should instruct the LLM in English, but the agent must
  answer the user in the user's language.

## Current 1.2.0 Roadmap

- Rework the Tigo agent page toward the Codex Desktop interaction model while keeping
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
- In the C8Oforms embedded surface, successful `nocode-form-create`,
  `nocode-form-edit`, `nocode-form-update`, and `nocode-form-get` results are
  returned as `state.formMutation`. Derive the subject ID only from the
  structured saved/fetched form, never from the previous host selection or
  narrative text. Reads use `changed: false`; a read of the same form after a
  mutation must retain the mutation signal.
  The Assistant then posts `ConvertigoAssistant.form-updated` to the validated
  `hostOrigin` on the first polling response containing the saved/fetched form,
  without waiting for run completion; C8Oforms checks access, selects the subject,
  and opens its editor if needed. On the current form, preserve the active
  page/selection when they still exist, and never replace local editor contents
  for a read-only focus. Keep Studio and collapsed progress/final UI unchanged.
- Deduplicate form notifications per run/resource/result, including the terminal
  polling response. Baserow auto-navigation is intentionally out of scope: the
  user does not want changes to the authenticated `/c8o/` gateway.
- Codex is the priority provider; Vibe remains supported.
- The agent configuration panel shows the managed CLI installed/latest version
  and exposes explicit install, update, and reinstall actions. Opening the panel
  may request a latest-version check cached for six hours under
  `<workspaceRoot>/agents`; normal prompts must not query the package registry
  or silently update the runtime. Startup uses the Bridge presence-only check
  and must not invoke either CLI.
- Refresh provider settings after a successful runtime update so model and
  reasoning choices come from the newly installed CLI. Existing agent processes
  may require a restart or a new conversation before using the new runtime.
- Settings and runtime discovery may use the visible user-scoped Codex home.
  Studio/generalist conversations that expose the managed JxBrowser viewer use
  a conversation-scoped Codex home so each resident Playwright MCP keeps its own
  stable CDP endpoint.
- Managed Codex homes are visible directories under the Convertigo workspace,
  ending with `codex-home`, not `.codex-home`.
- Do not auto-start Vibe when no conversation exists; the user should be able to
  choose the agent/provider for a new conversation.
- Do not auto-resume the latest conversation on view startup. Startup should
  prepare settings and list conversations; the first prompt creates a new
  conversation unless an explicit conversation is resumed.
- Forms conversations persist an allowlisted `nocodeContext` (form, page and
  element identity only). Never persist host URLs, tokens or form contents in
  this metadata. Older conversations without reliable context remain readable
  but require an explicit target selection; never infer a form id from prose.
- Forms welcome lists at most three recent conversations for the selected app;
  the full history supports title/context search and an application filter.
  Resuming restores messages, then validates resource access with the context
  catalog before posting a read-only (`changed:false`) focus event. Never replay
  a mutation. Missing elements/pages fall back to the application; inaccessible
  applications keep their history with a warning and block contextual sends.
- Within one app, host navigation may update the page/selection. Navigating to
  another app must not silently retarget an active conversation. Keep the bound
  context and offer return/new-conversation controls. Ignore stale catalog
  responses by comparing `requestedFormId` with the current intended resource.
- Run `node --test tests/nocode-*.test.cjs` after generation for startup, history,
  context persistence, scoped filtering, access fallback and Studio isolation.
- Embedded C8Oforms startup (`embedMode=c8oforms` and the `nocode` profile) must
  query server agent settings and conversations without waiting for Studio's
  local-stack capability flags. Keep the Studio capability checks unchanged.
  No Code settings checks are presence-only by default, bounded to 15 seconds,
  and settle into an explicit error/configuration state on failure. Never infer
  a working project from an unrelated Studio selection for these checks.
  No Code defaults to `lib_ConvertigoAgentBridge`; explicit bridge URLs take
  precedence, and Studio keeps its existing default endpoint. HTTP-200 engine
  error documents must be treated as failures in the No Code bridge path.
  Never infer NoCode from the selected `C8Oforms` project when the caller is
  Studio: `userId=studio` wins over stale profile metadata; an explicit
  Studio/generalist profile wins over the legacy project-name fallback.
  Preserve that identity when creating/restoring conversation state and
  filtering history. Keep the project-only fallback for older NoCode callers.
  `tests/nocode-studio-profile.test.cjs` covers routing, token isolation,
  history and Codex/Vibe state creation without launching agents or writing data.
  Request-fallback profile parameters must be verified through an HTTP call:
  MCP internal execution does not populate the original servlet parameters.
  Run `node --test tests/nocode-agent-startup.test.cjs` after Mobile Builder has
  installed its TypeScript dependency to check this separation and timeout paths.

## UI Expectations

- Forms-only UI uses `forms-integrated` on the page header/content/footer and
  `FormsIntegratedStyle`; leave the Studio layout unaffected. Context expansion
  and history navigation use SetLocal beans. Suggestions only prepare drafts.
- Pass dynamic MCP properties as `{mode, value}` objects. A `plain:` or `script:`
  prefix inside a plain value is literal text and breaks icons/actions.
- To validate the C8Oforms iframe, reload the saved Assistant project and run
  `npm run ionic:build:fast` in its generated `_private/ionic` directory, then
  reload the browser. Dev-viewer HMR alone does not refresh `DisplayObjects/mobile`.
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
  authenticated C8Oforms session. The raw token is persisted per user under the
  Convertigo workspace `agents/nocode/users/<userKey>/mcp-token.json`, then
  reloaded behind an opaque server-memory handle. The Assistant may pass the
  handle to the bridge, but must never expose the raw token in URLs, UI state,
  prompts, logs, or conversation records. Token labels must include the readable
  authenticated user, for example `Convertigo Agent Bridge - user@example.com`.
- New embedded NoCode conversations use an explicit resource context picker:
  users can choose any accessible C8Oforms form, optionally an exact element of
  that form, or a Baserow base/table. When the iframe is opened from a form
  editor, that form and the currently selected element are the defaults; the
  home screen leaves the choice open. Catalog reads must remain authenticated
  server-side, must respect C8Oforms ACLs, and must never expose the raw MCP
  bearer token to the browser.
- Context prompts must distinguish `nocode-form-get` (saved form contents) from
  `nocode-form-contract-get` (supported component contract). Audits/suggestions
  must stay read-only. Never suggest generic Studio tools or empty updates as a
  fallback when a no-code read fails.
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
- When a conversation starts without a selected project, infer its first
  `primaryProject` only from successful structured project/viewer tool events,
  such as an imported project or a `mobile-builder-open` result. Never infer it
  from narrative answer text. Persist the inferred project so resumed prompts
  use the created project as their structured context.
- Image attachment from files exists; clipboard image paste is a desired feature.

## Validation

- For client JavaScript changes, run `node --check js/agent_bridge_client.js`.
- For Convertigo UI/object changes, use MCP validation such as
  `mobile_builder_open` or the relevant requestable execution instead of manual
  edits to generated files.
- Before a demo, verify a fresh Codex conversation can list Convertigo projects
  through the Convertigo Generalist skill and MCP, without using a local
  hardcoded fast path.
