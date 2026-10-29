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

## backend-apps deployment boundary

- For `assistant.convertigo.com`, deploy only `lib_ConvertigoAssistant` on
  `backend-apps.convertigo.net`. Neither `lib_ConvertigoAgentBridge` nor
  `lib_ConvertigoMCP` is required on this hosting server; do not deploy them there
  when publishing or updating the Studio bundle.
- The Studio bundle still contains all three projects. Install the Assistant,
  Bridge and MCP together in the developer's Studio, where the CLI agents, MCP
  tools, conversations and wrapper quotas run.
- A separate server/NoCode installation that actually executes agents has its
  own full-stack requirements. Do not apply those requirements to backend-apps
  merely because it hosts the public Assistant frontend. TigoAccess is a
  separate hosted service and is unaffected by this rule.
- Existing Figma and LightRAG areas still exist; keep agent-specific changes
  scoped to the agent page/bridge path unless the user asks otherwise.
- Built-in prompt titles and bodies must use the selected UI language (English
  and French). Do not append a French response instruction to an English body.
  Source comments and repository documentation remain in English.

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
- Tigo 1.5 favorites can insert prompts into the draft of new or existing
  conversations, without auto-send. Keep classic How-To suggestions separate.
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
- Non-resident setup returning `authentication_required` must preserve a
  structured `setup_required` response and its credential diagnostic, including
  after explicit installation. Do not start the agent or suggest reinstalling
  to repair missing credentials. Convertigo NoCode guidance refers to server
  administration; Studio retains its workspace instructions. Cover this with
  `node --test tests/assistant_setup_failure.test.cjs`.
- In the C8Oforms embedded surface, successful `nocode-form-create`,
  `nocode-app-create`, `nocode-form-edit`, `nocode-form-update`, and `nocode-form-get` results are
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
- The Bridge status of a session carries `sandbox` (`scope`, `policy`, `source`,
  `configured`, `confined`, `landlockAbi`; Bridge 0.4.28 and later): what the
  agent may do, as the Bridge applied it at start. `rememberSessionSandbox` keeps
  it on the conversation, `publicState` hands it to the page, which shows the
  sandbox badge in the side column (wide) and in the status dock (chip, tab and
  drawer, narrow), in Studio and C8Oforms alike. A Studio session reads
  "Unrestricted"; a No Code session on Codex or Claude reads "Full access" (only
  Vibe applies `agents.tool_policy`). Texts live in `agentSandboxText` (fr, en,
  it, es). Cover with `node --test tests/assistant_sandbox_badge.test.cjs`.
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
- Settings that show are always the settings page (`isAgentSettingsPageShown`), also
  while the chosen agent is not ready once the page was closed. A note under the agent
  cards says how to connect that agent (sign-in, install, check running) and offers the
  way back to a ready agent (`getAgentNotReadyText`, `useReadyAgentProvider`). Closing
  the settings on an agent that is not ready goes back to the agent in use when they
  opened, else the saved default, else the first ready one; a runtime install still
  running keeps its agent (`AgentRuntimeInstallProvider`). The No Code router reads
  only the agent in use: a card whose agent the panel has not read starts the settings
  check (`startAgentProviderCheck`), never shows a runtime to install. Cover with
  `node --test tests/nocode-agent-not-ready.test.cjs`.
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
- A reload of No Code Studio keeps the panel open and asks it, with `restoreConversation=1`,
  to open again the conversation of the tab (`sessionStorage`
  `lib_ConvertigoAssistant.FormsOpenConversation`). The quiet resume waits for the answer of
  the start of the page (`AgentStartupDone`, AgentCreateConversationRouter sets its own
  conversation) and for the history. Only a new conversation started by the user drops that
  conversation; an empty panel keeps it. The `Agent` entry page opens the agent at once for
  the No Code and server surfaces, never How-To. Cover with
  `node --test tests/nocode-restore-conversation*.test.cjs`.
- "Confirmer avant de modifier" (No Code, off by default): while a user has it on,
  lib_ConvertigoMCP holds each No Code write (create, edit, update, publish with
  confirm, app-create, schema-apply in apply mode) until the user answers a card of
  the conversation, whatever the provider. The choice is kept per user
  (`agents/nocode/users/<userKey>/write-confirm.json`) and published in the server
  store `lib_ConvertigoAssistant.writeConfirm` (`user:<owner>`, and `grant:<conversation>`
  for "Tout autoriser pour ce tour") by `js/agent_write_confirm.js`, at each switch and
  each message; the held change is a `write-confirm` request of
  `lib_ConvertigoAssistant.hostRequests` that readResponse hands to the page while it
  waits, and `AgentWriteConfirm` answers it (allow, allow_turn, refuse), or closes it at
  the end of the turn (the MCP refuses it). A message drops what the last turn left.
  Switching off answers no open card. The switch sits above the input bar, the setting
  after the feedback one, `/confirmer` and `/confirm` turn it on or off, and a message
  such as "ne modifie rien sans mon accord" while it is off offers it once per
  conversation. The prompt's No Code block says whether it is on. Texts in
  `agentConfirmText` (fr, en, it, es). Cover with `node --test tests/nocode-write-confirm.test.cjs`.
- Embedded C8Oforms startup (`embedMode=c8oforms` and the `nocode` profile) must
  query server agent settings and conversations without waiting for Studio's
  local-stack capability flags. Keep the Studio capability checks unchanged.
  No Code settings checks are presence-only by default, bounded to 15 seconds,
  and settle into an explicit error/configuration state on failure. The start of a
  No Code panel (AgentCreateConversationRouter) reads them presence-only too, and in
  full only when a model catalog is not cached yet; settings reads go to a Bridge
  context of their own (the shared one orders starts and prompts, and the check
  waited behind them); a panel that opens again the conversation of a reloaded No
  Code Studio (`restoreConversation`) prewarms no Vibe. Cover with
  `node --test tests/nocode-panel-start-cost.test.cjs`. Never infer
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

- Studio only (the Eclipse view and the Web Studio of a Studio engine, never No Code
  or a server engine), a card under the toolbar offers the reviewed stack of the update
  channel when it is newer than what is installed (`getAgentStackOfferView`). The
  channel (`getAgentStackChannel`, localStorage `lib_ConvertigoAssistant.AgentStackChannel`)
  is stable by default; "preview" also reads `GetPreviewManifest` and takes per project
  the higher version. Manifests are read a few seconds after the host context, at most
  once a day per channel (`...AgentStackStableCheck` / `...AgentStackPreviewCheck`); only
  manifests of their own channel with official release CARs count, and only the projects
  older than the offer are installed (the Eclipse host imports whatever it is sent).
  "Later" is remembered per offered release. Never while a turn runs; Git checkouts, `assistant.stack.selfupdate=false`
  and server session policies show why and offer no update. A Web Studio needs
  `AgentStackStatus.surface === "studio"`. Cover with
  `node --test tests/assistant_stack_update_offer.test.cjs`.
- The global symbol `assistant.stack.channel` (`stable` by default, also when empty
  or unknown, or `preview`) is the update channel of a whole server: `channelSetting`
  in `js/agent_stack_server.js`, returned by `AgentStackStatus`
  (`localAgentStackChannel`, `localAgentStackChannelSource`). On a server, No Code
  included (`isAgentStackChannelFixed`), `refreshAgentStackRelease` reads the
  manifests of that channel once the status is known (preview: per project the
  higher version; a preview read that fails leaves stable), and the stack settings
  show the channel read-only with the symbol (`getAgentStackChannelView().readOnly`);
  never a card. In a Studio the symbol is the default of `getAgentStackChannel`
  until the panel keeps a choice, and the settings follow the same channel; the
  Eclipse view reads it with the engine policy, once a page
  (`refreshAgentStackEngineStatus`). The channel never limits `AgentStackInstall`
  of an official CAR URL. Cover with
  `node --test tests/assistant_stack_channel.test.cjs tests/agent_stack_server.test.cjs`.
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
- Sending a message, creating a conversation and reading the settings write what
  each step takes to `agents/assistant/send-timings.ndjson` of the workspace (one
  JSON line per call, rotated at 512 KB); each Bridge call is a step named after
  its sequence. With the Bridge's `agents/vibe/startup-timings.ndjson` it tells
  where a cold start spends its time. Cover with
  `node --test tests/assistant_send_timings.test.cjs`.
- Before a Vibe message, `callAgentSetup` asks the Bridge for a presence check
  only (`startupPresenceOnly`, Bridge 0.4.28 and later): the full check ran
  `vibe-acp --version` twice, 7 to 10 s on every message. The setup screen and an
  installation keep the full check. Cover with
  `node --test tests/assistant_setup_presence.test.cjs`.
- Opening the No Code panel (createConversation without a conversation) prewarms
  the Vibe of the user's next conversation: `prewarmNoCodeConversation` posts
  agent_vibe_start with `prewarm` from a background thread (Bridge 0.4.28 and
  later) and keeps the conversation id in the HTTP session; the first message of
  a new conversation takes it (`takePrewarmedConversation`) and, once its prompt
  is sent, prewarms the next conversation's. Nothing is saved
  before that message; the Bridge stops the process after 3 min idle without a
  message and keeps one prewarm per user. Never in the Studio, nor for Codex or
  Claude. Cover with `node --test tests/assistant_prewarm.test.cjs`.
- AgentWorkspaceImage serves the thumbnails of the agent's image calls: the
  Studio (WEB_ADMIN) as before; a No Code session the images of its user's own
  attachments (agents/<provider>/users/<user>/conversations/<id>/attachments,
  agents/attachments/<user>/) and of its agent's working folder
  (agents/vibe/homes-<profile>/users/<user>/scratch/<conversation>/), the user
  taken from the session, so the images the Agent Bridge describes for a model
  that cannot see, and those the agent makes or opens, show as in the Studio.
  Cover with `node --test tests/assistant_workspace_image.test.cjs`.

## Validation

- After merges, run `node --test tests/assistant_*.test.js tests/assistant_merge.test.cjs tests/nocode-*.test.cjs`.
  NoCode tests read the checked-in YAML rather than stale generated app files;
  they require the installed TypeScript/Sass dependencies but no reload or agent
  process. These offline checks do not replace a Mobile Builder build or a live
  Studio/C8Oforms smoke test.
- For client JavaScript changes, run `node --check js/agent_bridge_client.js`.
- Convertigo gateway errors distinguish HTTP 401 (credential rejection) from
  HTTP 403 (access denied; check model permissions on both the key and its
  LiteLLM user). Vibe ACP may discard the HTTP status and report only
  `Invalid API key`; use neutral access guidance in that case instead of
  asserting that the key is invalid. Cover this with
  `node --test tests/assistant_error_text.test.cjs`.
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

## Provider browser sign-in (8.4.6)

- Convertigo request flags are strings: parse each login/loginStatus and provider
  alias with `boolValue` before combining them. A literal `"false"` must never
  mask a later true flag or route login polling through normal runtime setup.
- Keep the `agent.login` response envelope, including verification/manual URLs,
  until authentication completes. The UI opens a delayed URL once, polls without
  installing/updating a runtime, and refreshes provider settings after success.
- Display signing-in and updating as different action labels. Validate with
  `node --test tests/assistant_login.test.cjs` and a native Studio browser login;
  the tests cover string-valued flags for Codex, Claude and Vibe.

## Quota display (8.4.6)

- TigoAccess credential installation uses `js/tigo_access_files.js`: POSIX
  permissions on Unix, current-process-user ACLs on Windows. Java File permission
  toggles cannot make a Windows file private. Keep symlink rejection, private
  temporary files and atomic replacement. Run
  `node --test tests/tigo_access_files.test.cjs` after changing this path.
- A `local_installation_failed` response means the remote key was already
  obtained. Keep its sanitized operation/cause diagnostic and propagate the local
  error through AgentSetup; do not replace it with PSC troubleshooting or log
  credential values. Native Windows validation is still required after mocked
  ACL tests. See `docs/windows-tigo-access.md`.

- The native NGX `LightRagFooterComponent` quota arc reads the authenticated `AgentQuota`
  facade through a `CallSequenceAction` subscriber (`AgentQuotaRefresh`). Keep
  this visible when the prompt is disabled or agent settings are open.
- Convertigo uses `TigoAccessStatus` (HTTPS `getQuota(apiKey)`), never the Vibe
  harness's context usage. The portal link comes from the server-owned
  `assistant.tigo.portal_url` symbol, with the backend-apps TigoAccess portal as
  default; no PSC, key, email or session token belongs in the link.
- Codex/Claude/Vibe quotas come from the private native `agent_quota` sequence.
  Keep them out of public bridge diagnostics and event buffers. The server-only
  runtime handle is chosen after checking conversation ownership and provider.
  Codex and Claude expose reported account limit windows. ACP `usage_update`
  carries context tokens and optional cost, not a remaining account budget:
  display those separately and leave account quota unknown.
- Startup/settings, provider selection, explicit refresh and completed turns
  refresh quota. Active-turn polling may refresh it at most every 30 seconds,
  retaining the current snapshot. Never add idle polling or create a conversation to populate the arc. An explicit
  authenticated refresh may run the Bridge’s cached metadata-only CLI probe
  before the first prompt; it must never send a user message or model request.
  Discard late provider/conversation responses; failures release the pending
  flag so an explicit retry works. Do not show context from a prior conversation.
- `tests/assistant_quota.test.cjs` consumes a canonical Page tree exported through
  MCP, not project descriptors. Set `CONVERTIGO_QUOTA_UI_SNAPSHOT` to that JSON
  file and run `node tests/assistant_quota.test.cjs` after Mobile Builder has
  installed TypeScript. Native compilation and backend proof remain required.

## Compact quota popup

- Display ACP context as "Context before compaction" and show its session token
  cost separately as an estimate rounded to four decimals. Explain that actual
  charges depend on the account plan/provider billing; never imply that a CLI
  API key means pay-as-you-go. Unknown account quota keeps the arc neutral.
- Cost can be present without context counters. Missing/invalid costs stay
  hidden, while an explicitly reported zero remains visible. Translate both
  labels and the billing explanation in French/English.
- `Page.getAgentQuotaView()` derives the compact account usage and detail rows. Pick the highest known utilization window; use its actual duration before its primary/secondary id to label it. Unknown account quota stays neutral; Vibe context never fills the account arc.
- The shared footer uses the native `InlinePopover`, with a stable unique trigger id per component instance. Keep the trigger a button independent from prompt enablement. Ionic handles outside click, Escape and focus return. Refresh emits `QuotaRefresh` to the Page, which keeps the existing authenticated subscriber and API transport.
- `ensureAgentNativeContextBridge()` installs the Java receiver wrapper during host-context retries too: the native receiver can appear after Page initialization or be replaced on reload. Forward native context exactly once, retain the original delegate and restore it only when the wrapper is still current. Check `tests/assistant_native_context.test.cjs`.

- Release 1.4.46 pairs Bridge 0.4.21 with Mistral reasoning/cache corrections and the clarified usage popup. Both `stack-release.json` and the Page fallback must pin those exact CAR versions. CI builds and publishes without deployment. Hosted deployment is a separate manual workflow.

## Windows diagnostics and startup model restoration

- Assistant 1.4.47 pairs Bridge 0.4.22 with MCP 0.2.20. Update both manifest
  copies together, publishing dependency CARs before the public master manifest.
- Assistant 1.4.48 pairs Bridge 0.4.22 with MCP 0.2.23 (inline ping, setup
  sequences writing `X-Convertigo-No-Log`). Only the manifest copies changed.
- Assistant 1.4.49 keeps Bridge 0.4.22 and MCP 0.2.23. Convertigo/LiteLLM
  errors explain key and user model permissions, distinguish HTTP 401/403 when
  available, and keep neutral guidance when Vibe omits the HTTP status.
- Windows runtime warnings come from structured Bridge `diagnostics`. Distinguish
  disabled registry settings, failed long-path probes and inconclusive write
  checks. Show the Microsoft documentation through `openAgentExternalUrl`.
  PATH issue details include source/index/length/category only, never raw paths.
- A provider-less startup conversation response must not overwrite the model
  restored from confirmed preferences. A real resumed provider restores its model.
- Validate with `node --test tests/assistant_windows_diagnostics.test.cjs`.

## Tigo 1.5 resource library

- See `docs/tigo-library.md` for format, ownership and runtime contracts.
- Assistant 1.5.6 / Bridge 0.4.28 / MCP 0.2.28 is the stable bundle (the 1.5
  line with the opt-in feedback to Convertigo and the Studio update offer); the
  preview manifest points at the same bundle until the next checked pre-release set.
  `stack-release.json` must equal `stack-release-stable.json`; the Page default
  fallback pins stable too. Preview uses `stack-release-preview.json` explicitly.
- `js/tigo_resources.js` owns the portable resource core and its Java host. The
  authenticated `AgentResources` facade derives identity, checks conversation
  ownership and requires a session CSRF token for mutations. A Studio auth
  failure must remain an EngineException so the existing renewal interceptor
  can retry once. Never accept a client-selected filesystem path or user.
- Project resources live in `.tigo/`, protected by `.httpignore`; personal
  resources/preferences/selections/secrets live under `agents/tigo/users`.
  Built-ins are read-only, with Studio/NoCode surfaces and EN/FR translations.
- Page configuration uses native NGX accordions. Footer favorites remain
  available during a conversation, append to drafts and never auto-send. Their
  row folds once the conversation starts (the page's `hasConversationStarted`:
  the thread shows a message the user sent, from the send on, or a reopened
  conversation has one) and shows again for a new or empty conversation; the
  "Prompts" toggle of the composer opens it in between, and it folds again with
  the next message. The skills and MCP rows stay as the user left them. Cover
  with `node --test tests/assistant_hide_suggestions.test.cjs`.
- Skills are injected once per revision/provider session. Track the accepted
  submission only, and bind a newly returned session ID without reinjection.
  Disabling cannot erase model history. Missing selections must remain visible
  with a recovery action; changed active MCP declarations require reapproval.
- MCP activation uses an opaque private-memory handle and conversation homes;
  raw secrets never enter browser state, prompts, records or generated configs.
  Keep the managed Convertigo skill/MCP intact.
- `tigo-resources` in lib_ConvertigoMCP delegates project-only operations to this
  core and must independently require a full MCP bearer token. It cannot alter
  favorites, activation, personal resources or secrets.
- Run `node --test tests/tigo_resources*.test.cjs` plus the existing Assistant
  and NoCode checks. Quota tests require a current canonical Page snapshot
  with the current LightRagFooterComponent tree in `snapshot.footer`.
- The 8.4.6 release line must keep the module-based NGX legacy template, pinned
  to `8ca383ae844129df72bd3436a7869bfdc0a69d5c` (8.4.0.18). The floating
  `mobilebuilder_tpl_8_4_0_ngx` branch is now standalone and causes silent
  generation exceptions with the official 8.4.6 plugin. Validate log contents,
  not only Gradle's exit status.
- New/resumed conversations defer provider startup until the next authenticated
  send. Optional detached prewarm is disabled in 1.5 because it can race MCP
  selection and start the shared user home without conversation resources.

## Release policy

- See `docs/release-channels.md`. All newly tagged releases are pre-releases,
  never Latest automatically. Promote only after review and functional acceptance.
- Push/tag CI cannot deploy, regardless of commit message. Only the Assistant has
  a deployment workflow: it runs for production when a release becomes stable
  (`released` event: published as stable or promoted from pre-release), and by
  hand (`workflow_dispatch`) for development or a redeploy. It verifies and deploys
  a published CAR without rebuilding master. Production accepts only the reviewed
  stable tag; pre-releases never deploy on their own.
- Changing channels does not downgrade installed Studios. Preserve existing tags
  and CAR bytes. Never mix independently selected companion versions.

## Tigo 1.5 review refinements

- The composer exposes compact, mutually exclusive Prompts, Skills and MCP panels.
  Clicking the active panel closes it. Prompt insertion preserves the draft and
  never sends a message; resource activation remains owned by the authenticated
  Page facade and is disabled while a turn is running.
- Library list actions use accessible icon buttons with translated tooltips.
  Favorites can move up or down. Search/provenance filters are disabled for the
  initial small catalog; retain source labels on each resource.
- Native library inputs use the paired `--modern-surface` / `--modern-text`
  theme variables, including the actual input background. All four provider
  choices live in the same container to keep their widths identical.
- Opening agent settings or clicking Refresh models explicitly refreshes provider
  metadata via `refreshModelCatalog`; this must never install/update a runtime.
  Presence-only startup remains cached. Forward the flag through AgentSettings
  and its client, independently from package version checks.
- Keep Ionic standalone component imports out of shared actions in this 8.4.6
  module template. Its IonicModule already provides those components; importing
  both forms causes Angular NG0300 at runtime.
- Validate `tests/tigo_compact_resources.test.cjs` with the existing resource,
  host-theme, login and NoCode checks. Keep these changes in preview until review.

- Resource toggles belong beside attachments inside the composer control row.
  Keep captions optional in narrow drawers and accessible names/tooltips intact.
- Resource editor labels sit above fields, separate from their input background.
  Save/Cancel use full-size editor actions, never the 30px library card style.
  Switching accordion categories hides the editor and preserves its unsaved draft
  until the category is reopened; explicit Cancel or successful Save clears it.
- Skill MCP requirements are optional inline checkboxes, shown only when there
  are available connections. Never open an empty dependency selector.
- Reload library refreshes project/workspace resource files, not models or runtime.

- Page native messages must wait until `window.receiveFromJava` is a function.
  AppEvent.HandlePostMessage installs that receiver independently of initial Java
  detection, so late bridge injection is supported. Preserve bounded context
  retries and the original delegate; no placeholder receiver may swallow init,
  select, capture or authentication messages. Cover startup ordering and late
  injection in `tests/assistant_native_context.test.cjs`.
- Prompt configuration lists favorites first in personal order, then non-favorites
  alphabetically in the current language. Show up/down only for favorites, next
  to the star. All three resource categories use outlined `+ New` buttons.
- Skill editors show instructions only. Saving generates SKILL.md `name` from
  the stable resource id and `description` from its translated description (title
  fallback). Preserve other frontmatter keys and untranslated bodies. Accept
  pasted full SKILL.md documents without adding a second header.

## Tigo personal and team access

- TigoAccess chooses a personal or per-user/team credential after PSC validation.
  Preserve manual keys and never send credentials to the Page or quota DTO.
- Refresh managed access before each Studio Convertigo-agent turn. Quota can
  request PSC rebootstrap after membership changes; an exhausted team never
  silently falls back to personal credit.
- The quota popup distinguishes active scope, shared team budget, own member
  usage and preserved personal credit. Respect `member.budgetReported`; unknown
  budgets/spend must not become zero or an unlimited allowance.
- When the active scope changes, refresh model metadata without installing a
  runtime. Keep local file replacement private/atomic and roll back the key if
  its paired metadata replacement fails.
- Run `tests/tigo_access_refresh.test.cjs`, `tests/tigo_access_switch.test.cjs`
  and `tests/tigo_team_quota.test.cjs` with existing quota and setup checks.
