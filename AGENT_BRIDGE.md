# Convertigo AgentBridge prototype

This branch keeps the existing OpenAI Assistant flow unchanged and adds a
parallel backend path for a local CLI agent managed by the
`ConvertigoAgentBridge` project.

## Added sequences

- `AgentCreateConversation`: creates or resumes an agent conversation state and
  returns a `threadid`. Without `threadid` and without `forceNew=true`, it
  resumes the latest durable conversation for the user/project when one exists.
- `AgentSendMessage`: starts/configures the local Vibe ACP process through
  `ConvertigoAgentBridge`, wraps the user prompt with Studio/project
  instructions, sends it to the agent, and stores the run cursor.
- `AgentReadResponse`: polls bridge events, converts streamed `answer/chunk`
  events to the existing assistant-like `AIData` response, and converts
  `reasoning/chunk` plus `tool/*` events to user-facing progress lines.
- `AgentCloseConversation`: closes the bridge handle and removes only the
  runtime state. The durable conversation record stays on disk.
- `AgentListConversations`: lists durable conversations for a Studio/NoCode
  user, optionally filtered by project.
- `AgentResumeConversation`: reloads a durable conversation into runtime state.
- `AgentDeleteConversation`: closes the bridge handle, removes runtime state,
  and deletes the durable conversation folder.

## Current defaults

- Bridge endpoint: `http://localhost:18082/convertigo/projects/ConvertigoAgentBridge/.json`
- MCP endpoint: `http://localhost:18082/convertigo/api/mcp`
- Provider: `vibe`
- Per-conversation home: `<workspaceRoot>/agents/vibe/users/<userKey>/conversations/<conversationId>/vibe-home`
- Codex managed home: `<workspaceRoot>/agents/codex/homes/users/<userKey>/codex-home`
- Default Studio user key: `studio`
- NoCode user key: `u-<sha256-16>` computed from `userId`, so raw logins/emails
  are not written in folder names.
- Credentials: only `MISTRAL_API_KEY` is read from `~/.vibe/.env` and injected
  into the local Vibe process environment.

## Durable conversation layout

```text
<workspaceRoot>/agents/vibe/users/<userKey>/conversations/<conversationId>/
  conversation.json
  transcript.ndjson
  summary.md
  vibe-home/
```

Codex conversations use the same durable record shape under
`<workspaceRoot>/agents/codex/users/<userKey>/conversations/<conversationId>/`,
but the default Codex home is user-scoped instead of conversation-scoped. The
conversation record stores `externalSessionId`, which is the Codex app-server
thread id used when the bridge resumes a resident Codex server.

`conversation.json` stores metadata only: provider, user key, primary project,
project list, working directory, VIBE_HOME, last cursor/run id, status, and the
external Vibe ACP session id when available. Secrets are not copied there.

`transcript.ndjson` stores the user and assistant turns observed by the wrapper.
`AgentCreateConversation` and `AgentResumeConversation` convert it back to
`AIData.messages`, so the component assistant can show the previous visible chat
history when a durable conversation is resumed. Vibe keeps its native state
under `vibe-home/`.

## Progress and state

The conversation state is written both to the current HTTP session and to the
engine shared storage (`context.server` when available). The session remains the
fast path for a browser or JxBrowser client, while the shared storage lets
polling calls recover the same agent handle when the caller uses another
request context.

If the state is missing but the UI still provides a `threadid`,
`AgentReadResponse` rebuilds a minimal state from the durable record and resumes
event polling. This is a recovery path, not the normal path.

The assistant buffer now receives cumulative, user-facing progress text. Tool
failures reported by `tool/update` are treated as warnings while the ACP turn is
still running; only terminal ACP errors or repeated read failures mark the run as
`failed`. A later `turn/end` wins and returns `completed`.

The component assistant page is currently switched to this path. The Figma and
LightRAG parts are not changed.

On page load, the component assistant calls `AgentCreateConversation` without
`forceNew`, so Studio restarts resume the latest conversation for the selected
project. The toolbar reset button calls the same sequence with `forceNew=true`,
so the user can intentionally start a fresh conversation.
Both paths also store `result.conversations` in `local.AgentConversations`, so
the page has the current backend conversation list ready for the visible
conversation controls.

The page now shows a compact conversation state strip in the "Get started" card.
It displays whether the conversation was resumed or newly started, a shortened
conversation id, and the current conversation count. The toolbar action uses a
plus icon to indicate a new conversation rather than a generic refresh.

When several durable conversations exist, the same card also shows a compact
conversation list. The active conversation is marked, older conversations can be
resumed, and non-active conversations can be deleted. Resuming a conversation
also reloads the visible user/assistant transcript. `AgentDeleteConversation`
returns the updated conversation list so the UI can refresh without a second
parallel backend call.

For Codex conversations, `AgentResumeConversation` and resumed
`AgentCreateConversation` calls also prewarm the resident `codex app-server` by
calling `ConvertigoAgentBridge.agent_codex_start` in a daemon thread. This is
best-effort and does not block the UI response: the returned payload includes
`prewarming=true` when a warmup was started or an already-running handle was
confirmed. The first prompt still has the normal start fallback if the warmup has
not finished yet.

The prewarm guard is process-aware. A recent `codexPrewarmStartedAt` value only
suppresses another warmup when `agent_status` confirms that the bridge handle is
still alive; if the process was closed or lost from the bridge registry, resume
starts it again.

The component assistant page sends the selected Studio project as
`targetProject`. The older `projectName` variable is kept as a compatibility
fallback, but `targetProject` avoids conflicts with Convertigo's current project
name in server-side calls.

`AgentSendMessage` adds English operational instructions before the user's
message:

- the selected Studio project is the working scope;
- the agent should use Convertigo MCP/tools for Convertigo inspection and
  mutations;
- generated folders such as `_private/ionic`, `DisplayObjects`, `dist`, and
  build outputs are off limits;
- advice-only questions should not mutate the project;
- user-facing replies must be in the same language as the user's message.

The next UI step is to improve the conversation list labels with richer
previews and dates, now that resume/history behavior is functional.
