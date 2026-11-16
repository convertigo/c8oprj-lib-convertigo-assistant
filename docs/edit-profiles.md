# Edit profiles of a Tigo conversation

An edit profile says how the agent of one Studio conversation changes a project. It exists for the A/B measure of the
editing surfaces (Mistral Large 4 through Vibe): the same task run with the MCP edit tools, with the project's YAML files,
or with the generated NGX files imported back.

| Profile | The agent changes a project with | Guide served by the MCP |
| --- | --- | --- |
| `mcp` (default) | the MCP edit tools, as before: nothing changes | — |
| `yaml` | its file tools on `c8oProject.yaml`, `_c8oProject/**` and `js/**`, then `project-reload`; no MCP edit tool | `convertigo://resources/convertigo-yaml-editing` |
| `html` | the MCP tools, plus its file tools on the generated html, scss and ts of the NGX pages and shared components, imported back by `project-reload(fromIonic:true)` | `convertigo://resources/convertigo-ngx-html-roundtrip` |

`html` exists only on an engine of **8.5.0 or more** whose `com.twinsoft.convertigo.engine.util.NgxIonicRoundTripConverter`
has the static `importIntoLoadedProject(String, String)`, looked up by reflection (the class alone is not enough: an 8.4
Studio patched in September has it without that method). Elsewhere (every 8.4 engine, an 8.5 engine without the method)
the panel does not offer it (`AgentEditProfiles` answers `["yaml"]`), the server and the Bridge run an html conversation
as the default, and the MCP shows with the html header exactly what it shows without a header: no `fromIonic` /
`ionicTarget`, no `ionicFiles`, no round-trip guide, the `_private/ionic` prohibitions as before. `project-reload` answers
`status: "unsupported"` only to a stale client that still sends `fromIonic` there.

## Switching a conversation

In the Tigo panel of a Studio, in a Vibe conversation (the Tigo gateway or a Mistral account), type a local command:

- `/profil yaml`, `/profil html`, `/profil mcp` (also `/profile`, `/profilo`, `/perfil`);
- `/profil` alone shows the profile of the open conversation.
- The panel reads the profiles the engine offers once (`lib_ConvertigoAssistant.AgentEditProfiles`); the "/" menu shows
  `yaml | html | mcp` where html exists, `yaml | mcp` elsewhere, and `/profil html` is refused there.

The command never reaches the agent. A card confirms it. The panel then sends the profile with the next messages, until
the server answers that the conversation has it. For a new conversation, type the command before the first message.

The server keeps the profile in the conversation record (`conversation.json`, `editProfile`; `""` is the default), returns
it in the conversation state, and passes it at each Vibe start (`agent_vibe_start` `editProfile`). A profile asked for a
No Code conversation, or a conversation of another harness than Vibe (Codex, the provider runtime), is refused by the panel and ignored by the server.

A switch applies at the next message: the Bridge writes the conversation's Vibe home again and Vibe restarts on its
session, so the history stays.

## Where the profile goes

- **MCP**: the Bridge sets `X-Convertigo-Edit-Profile: yaml|html` on the conversation's MCP connection (its `config.toml`
  and its ACP session server). lib_ConvertigoMCP `js/edit_profile.js` reads it:
  - `yaml`: `tools/list` leaves out the tools that change a project (`databaseobject-tree-apply`, `-delete`, `-move`,
    `-rename`, `project-save`, `project-js-set`, `project-delete`, `upsert-crud`, `sql-transaction-create`,
    `business-sequence-create`, `ngx-page-create`, `ngx-theme-apply`, `marketplace-import`, `requestable-stub-set`,
    `scheduler-apply`); `tools/call` refuses them, and refuses them through `batch-call`, through `requestable-execute`
    (and any sequence of lib_ConvertigoAssistant or lib_ConvertigoAgentBridge), and a constructor `subagent-run`. Reading
    tools, `requestable-execute`, `project-lint`, `mobile-builder-build`, `mobile-builder-open`, `browser-verify` and
    `project-reload` stay.
  - `html` (8.5 engine with the method only, see above): every tool stays. `project-reload` takes `fromIonic` and `ionicTarget` and answers `ionicReport`;
    `mobile-builder-open` answers `ionicFiles`; a tree change of a page or shared component is refused while its
    generated files hold edits not imported yet. The import calls the engine's
    `com.twinsoft.convertigo.engine.util.NgxIonicRoundTripConverter.importIntoLoadedProject`.
  - Without the header, the tool list, the schemas, the resources and the answers are the ones before the profiles.
  The two guides are listed by `resources/list` in their profile only, and read by uri in any.
- **Vibe home** (lib_ConvertigoAgentBridge `syncVibeEditProfile`): `write_file` and `edit` get `permission = "never"`
  with an allowlist of the profile's paths (`yaml`: the project's `c8oProject.yaml`, `_c8oProject/` and `js/`; `html`:
  its `_private/ionic/src/app/`; both: the workspace's `.agent-tmp/`), and `AGENTS.md` a section "Conversation edit
  profile (A/B)". The profile is part of the home's tool policy, so a change rewrites the config and restarts the process.
- **Prompt**: each turn of a conversation with a profile carries one line naming it and its guide.

## Limits

- Vibe only, in a conversation with a home of its own (a Studio conversation with its viewer port). A home shared by
  conversations never takes a profile.
- The shell keeps the Studio's settings: only the instructions keep it from writing elsewhere.
- The `html` profile needs an 8.5 engine with `NgxIonicRoundTripConverter.importIntoLoadedProject`, whose generator writes
  the `.c8o-map.json` sidecars (today the `roundtrip-eval` engine branch); the 8.4 engines and origin/develop do not offer it.
- The Studio's "Lecture seule" wins over a profile: no file writer at all.
