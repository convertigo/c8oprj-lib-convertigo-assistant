# Tigo 1.5.6

Stable Studio bundle: Assistant **1.5.6**, Agent Bridge **0.4.28** and MCP
**0.2.28**, compatible with Convertigo **8.4.6**.

## Stack updates in Studio

The Assistant panel of a Studio offers the reviewed stack of its update channel
when it is newer than the installed projects: a card names the versions
concerned, with "Update" and "Later". Only the projects older than the offer are
installed, never while a turn runs; Git checkouts and
`assistant.stack.selfupdate=false` show why no update is offered. The stack
settings choose the channel, Stable by default or Pre-releases, which adds the
pre-releases listed by the preview manifest. On a server, the global symbol
`assistant.stack.channel` sets the channel for every user and the settings show it
read-only; servers are never offered the card.

Studios still on 1.5.5 have no card: they find this release in the stack settings
of the panel ("Update the stack").

## No Code agent

- Sessions run in a sandbox applied by the Bridge: no shell, file or web tool,
  the engine's `agents.tool_policy`, a working folder per user, and Landlock
  confinement on Linux wherever the engine allows it (static helpers for
  linux-amd64 and linux-arm64, moves across directories on Landlock ABI 1). The
  panel shows a badge saying what the conversation's agent may do.
- Faster starts: opening the No Code panel prewarms the Vibe of the next
  conversation, a message only checks that the agent is present before it is
  sent, and Vibe processes are swept every minute and limited per user. Each
  step of a send and of a Vibe start is timed in the workspace.
- One turn at a time in a conversation: a message sent while its turn runs is
  refused.
- Images are described for a model that cannot see and shown as thumbnails in
  the turn, from the user's own attachments and the agent's working folder.
- `nocode-form-preview-capture` lets the agent see the saved form as the user's
  browser renders it, through the No Code Studio page.
- The Tigo conversation opens again after each reload of No Code Studio.
- Baserow: `nocode-baserow-rows-list` reads the rows of a table with the user's
  own Baserow rights; grids page, filter and sort on the server; schema plans
  show the tables to create and look a base up in the workspace they name.
- Forms: `nocode-form-edit` finds pages, flows and parents by id or name and
  types every relation as the id it names; a select written into a link column
  writes the linked row id; validation warns about state kept in the browser,
  computations over grid rows and debug fields; expressions with unpaired marks
  are refused with their position.
- Feedback: a No Code turn files the capability its agent said it lacked, and a
  failed tool call keeps its whole error, code and duration.

## Studio, MCP and Bridge

- Tigo panel: compaction on a second click, a copy button per message, a steady
  context gauge and a composer that fits the panel.
- Each MCP run orders its own call variables, so parallel calls no longer race
  on a shared step variable. A token record being rewritten no longer refuses a
  valid bearer token, and refusals are logged.
- `palette-list`, `palette-describe` and `databaseobject-schema` hide the
  engine's experimental features unless the endpoint is called with
  `showExperimental=true`.

## Distribution

The stable manifest, compatibility alias, embedded fallback and preview manifest
select the same three published CARs. Only lib_ConvertigoAssistant is deployed to
backend-apps for assistant.convertigo.com. Bridge and MCP are installed locally
in Studio, or on a separately configured NoCode execution server.

The bundle was released from Assistant 1.5.6-beta.20, Bridge 0.4.28-beta.16 and
MCP 0.2.28-beta.15, checked together in a Studio on the published Convertigo
8.4.6 engine and on the No Code test server: the live MCP contract and pitfall
checks, 2 × 9,984 parallel MCP calls without error, low-code Vibe turns, a 1.5.6
pre-release Assistant next to the stable Bridge and MCP, and five reloads of No
Code Studio keeping the conversation. Local regressions: Assistant, Bridge and
MCP suites.

Known limits: under heavy parallel load the MCP answers about 15% fewer calls
per second than 0.2.27; `upsert-crud` does not yet name the database field it
expects, and `requestable-execute` does not accept the Studio's prefixed names.
