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
  Managed Convertigo skills remain invisible to the user. On the private Flow
  integration branch, the `studio` user has one history and one Codex home with
  both `convertigo-generalist` and the Flow skill pack; the routing profile is
  only a hint. C8Oforms/NoCode uses a different authenticated user and only
  `convertigo-nocode`. Do not expose Flow from the 8.4.4 release branch yet.
- Treat Flow as an alpha capability. The Assistant may expose or mention it only
  when the running Convertigo version is at least 8.5.0 and both
  `lib_flow_engine` and `lib_flow_mcp` are loaded. Normalize stale conversation
  profiles back to the standard Studio profile when that gate is closed.
- Models and reasoning choices must come from the bridge/CLI capability contract,
  not from UI-only hardcoded lists.
- Keep start templates only on the new conversation screen.
- Preserve accumulated progress steps after completion and collapse them by
  default, similar to Codex Desktop.
- Build the style with light/dark theme variables now, then align it with
  C8Oforms in a second pass.

## Bridge Contract

- Main client file: `js/agent_bridge_client.js`.
- Bridge project: `c8oprj-lib-convertigo-agent-bridge`.
- Codex is the priority provider; Vibe remains supported. Claude Code is the
  third provider: it follows the Codex resident path (`agent_claude_start` /
  `agent_claude_prompt`), keeps its session id in `externalSessionId`, and stores
  its managed home in `claudeHome`. Provider-specific sequence names come from
  `providerSequence(provider, action)` and resident behaviour from
  `isResidentProvider(provider)` in `js/agent_bridge_client.js`; do not add new
  `provider === "codex"` forks for behaviour Claude shares.
- Claude authentication has no in-app sign-in flow: the bridge copies local
  Claude credentials, and the UI asks the user to run `claude auth login`.
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
- Run `node --test tests/nocode-*.test.cjs` with TypeScript installed for startup, history,
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
  Studio/generalist profile never overrides the authenticated identity.
  Preserve that identity when creating/restoring conversation state and
  filtering history. Missing identities retain the standard Studio profile;
  non-Studio users use NoCode regardless of stale project/profile hints.
  `tests/nocode-studio-profile.test.cjs` covers routing, token isolation,
  history and Codex/Vibe/Claude state creation without launching agents or writing data.
  Server/NoCode startup also checks the published stack and `AgentStackStatus`
  independently of Bridge settings: the repair panel can open automatically
  when the Bridge is absent. Keep this read-only, deduplicated, and out of the
  Studio startup path. A cached manifest must not skip the server status check.
  Distinguish unchecked/loading/failed diagnostics from actual permission denial,
  and missing projects from unknown versions. Status checks time out after 15
  seconds, discard stale authorization, ignore late results, and retry on an
  explicit settings reopen. Cover this with `node --test tests/assistant_stack_ui.test.cjs`.
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
- Vibe emits each agent narration through the same ACP message event. When a
  narration is followed by a tool call, move it into progress and clear the
  answer buffer; only the narration remaining at turn end is the final answer.
- Do not force scroll-to-bottom while the user is manually scrolling. Sticky
  bottom should resume only when the user returns to the bottom or presses the
  bottom control.
- Scroll controls should be discreet and must not block the conversation content.
- Diagnostic/setup UI should be integrated in the page, not implemented with
  blocking browser popups.
- Keep i18n keys translated before committing UI text changes.

## Runtime Notes

- Eclipse Studio Agent onboarding is early access. `AppEvent.HandlePostMessage`
  owns `agentReleasePolicy` (`publiclyAvailable: false`,
  `minimumStudioVersion: '8.4.4'`). The exact `#early-access-agent` fragment
  opts in, subject to the Studio version requirement. Capture it before initial
  routing and preserve it across hosted navigation. Both activation URL fields
  sent to Eclipse must use the local root URL without a fragment. When the host
  reports `assistantRuntime: 'local'` and `localAgentStackAvailable: true`, Tigo
  is enabled without the fragment, still subject to the minimum Studio version.
  Installed projects alone must not unlock a remotely hosted Assistant. Do not
  persist the opt-in in localStorage. A fresh hosted view without the configured
  fragment must return to classic assistants.
- Use the shared `global.isAssistantAgentReleaseEnabled()` for automatic agent
  routing, menu visibility, direct route checks and onboarding actions. Keep
  explicit Studio Web server and NoCode integrations working. The fragment is
  a release flag, never an authentication bypass. Validate with
  `node tests/assistant_early_access.test.js`.

- Studio Web keeps the Assistant iframe URL stable. Project/profile/theme changes
  arrive through `lib_ConvertigoAssistant.context` and `select`, not iframe
  navigation. `GetTheme.applyAssistantHostTheme` applies Studio theme updates
  without persisting them and replays context received before initialization.
  Keep the NoCode light-theme policy unchanged. Run
  `node tests/assistant_host_theme.test.js` when changing this contract.

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
- In Studio generalist or Flow mode, the Assistant creates one short-lived
  managed token
  through `lib_ConvertigoMCP.McpManagedTokenCreate` using the current
  `WEB_ADMIN` session. Only an opaque server-memory handle crosses into the
  Bridge; renew the token before expiry and never expose it to browser state,
  prompts, logs, or conversation files. The same token authenticates both the
  Legacy and Flow MCP endpoints.
- Eclipse can renew the local Assistant's admin session without navigating the
  view. `AuthenticateStudioSession` owns a single-flight, timeout-bounded
  `renewStudioSession` exchange via `lib_ConvertigoAssistant.authenticate.request`
  and `.response`. Java authorizes only the main frame at the local Assistant
  URL. The one-use Studio token is exchanged immediately, never persisted or
  logged. Only a missing WEB_ADMIN check may trigger one retry; generic network
  or operation failures must not be replayed. Web/NoCode keeps its own login flow.
- Page's `installAgentSessionRecovery` checks protected call responses before
  generated success actions run. A failed resume preserves conversation state
  and shows an inline error. Clear old messages/polling only when applying a
  successful history response. Test with `node tests/assistant_session_recovery.test.js`.
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
- Never filter the `studio` conversation list by Legacy/Flow routing profile.
  Keep that profile on each record for diagnostics and future badges. NoCode
  history remains naturally isolated by its non-Studio user identity.
- Keep `surface`, `authoringPolicy`, installed `capabilities`, and
  `projectContext` independent. Consume the capability descriptor returned by
  AgentBridge settings. Flow tool names and recipes belong to `lib_flow_mcp`;
  do not duplicate them in Assistant prompts.
- `assistantSurface=studio` identifies the host UI only. It must not select the
  Legacy profile; the managed `convertigo-studio` skill routes each task from
  explicit intent and the target project's model.
- When a conversation starts without a selected project, infer its first
  `primaryProject` only from successful structured project/viewer tool events,
  such as an imported project or a `mobile-builder-open` result. Never infer it
  from narrative answer text. Persist the inferred project so resumed prompts
  use the created project as their structured context.
- Image attachment from files exists; clipboard image paste is a desired feature.

## Validation

- After merges, run `node --test tests/assistant_*.test.js tests/assistant_merge.test.cjs tests/nocode-*.test.cjs`.
  NoCode tests read the checked-in YAML rather than stale generated app files;
  they require the installed TypeScript/Sass dependencies but no reload or agent
  process. These offline checks do not replace a Mobile Builder build or a live
  Studio/C8Oforms smoke test.
- For client JavaScript changes, run `node --check js/agent_bridge_client.js`.
- For Convertigo UI/object changes, use MCP validation such as
  `mobile_builder_open` or the relevant requestable execution instead of manual
  edits to generated files.
- Before a demo, verify a fresh Codex conversation can list Convertigo projects
  through the Convertigo Generalist skill and MCP, without using a local
  hardcoded fast path.

## Viewer automation for Claude and Vibe

- `agentStartPayload`, `agentSetupPayload`, and the Claude prompt payload carry
  the Studio viewer endpoints (`browserDebugUrl`, `playwrightCdpEndpoint`, ...)
  for every provider. `providerHomeScopeForRun` switches Claude and Vibe to a
  conversation-scoped home as soon as a viewer endpoint is known, mirroring
  `codexHomeScopeForRun`.
- `codexViewerSessionNeedsFreshThread` also covers Claude: a session recorded in
  a user-scoped `claude-home` cannot be resumed from the viewer-scoped home.
- The Claude sequence prompt names the `mcp__convertigo__*` and
  `mcp__playwright__browser_*` tool routes explicitly.

## Prompt attachments

- The prompt footer sends files through `UploadFilesRouter`. With
  `agentBridgeOperational=true` the uploaded temporary files are copied under
  `<conversationDir>/attachments/` by `storeAttachments` and returned as `file`
  entries with a local `path`; the legacy `UploadFiles` (OpenAI Files API) is
  only used by the hosted assistant. The router never rejects the send chain:
  errors are reported in `result.errors`.
- `AgentSendMessage` receives the entries as `AIFiles`; the sequence prompt
  lists `name=`/`path=` lines so Codex, Vibe, and Claude read the files locally.
