# Tigo 1.5: prompts, skills and MCP connections

This library is part of the 1.5.3 stable bundle. See
[release channels](release-channels.md).

The configuration panel has five categories: **Agent and model**, **Runtime and
stack**, **Prompts**, **Skills**, and **MCP connections**. The library combines
built-in resources, your personal workspace, and all loaded Studio projects.
Each row retains its source label. Search and provenance filters are hidden for the initial small catalog.

## Prompts and favorites

Built-in prompts ship in English and French and are read-only. Both titles and
prompt bodies use the selected language; French bodies are written in French. Duplicate one to
customize it, or create a prompt and choose **Personal workspace** or a named
**Shared project**. Editing one translation preserves the others. The requested
language falls back to the resource's `defaultLanguage`.

Favorites and their order belong to the current user. Configuration lists them
first in that same order, followed by non-favorites alphabetically in the selected
language. Reorder arrows appear only beside the stars of favorite rows. Star icons toggle favorites; up/down arrows reorder them. View/edit, duplicate and insert actions use labeled icon buttons. They never modify shared
project files. They appear below the composer, including during an existing
conversation. Three compact, mutually exclusive **Prompts**, **Skills** and **MCP**
buttons sit beside the attachment button inside the composer. They switch the
panel below the composer; clicking the active button closes it. In narrow drawers,
the buttons show icons with translated accessible labels and tooltips. The options icon opens the matching library category. Clicking a favorite or
**Insert into draft** appends its text to the draft; it never sends a message.
Studio and NoCode have separate built-in suggestions, selected by `surfaces`.

## Resource editor

Outlined **+ New** buttons create resources. Labels sit above the fields. Choose a personal workspace or a shared project,
fill the title and contents, then use the editor's **Save** button. **Use these
settings and continue** closes configuration; it is not a resource save action.
The editor's **Cancel** button closes the draft. Switching accordion categories
hides an unsaved editor and retains its draft until that category is reopened.

**Reload library** rereads resource files from the workspace and loaded projects,
including edits made through MCP or Git. It appears only in library categories
and does not update models, install a runtime or send a prompt.

## Skills and conversation state

Skills use `SKILL.md`, with YAML frontmatter containing `name` and `description`.
The editor shows only the instructions. On save, Tigo generates the technical
`name` from the stable resource id and the `description` from the translated
description field (or title if empty). Other existing frontmatter metadata is
preserved. Pasting a complete SKILL.md also works without duplicating its header.
There is no need to enter the same description twice.
A standard skill folder works without a Tigo manifest. Optional `skill.json`
adds translated titles/content and MCP dependencies. The optional requirements
are listed as inline checkboxes only when MCP connections exist. A requirement
means that the corresponding connection must also be enabled for the conversation;
a skill with no external tools needs no connection. Supporting files remain in
`references/`, `scripts/`, and `assets/`; duplicating a skill copies those files.

Enable a skill for the current conversation, or before its first message.
Tigo supplies its instructions on the next turn, once per content revision and
provider session. The supplied text identifies the skill directory so the agent
can read references when needed. Changes to support files also change its
revision. Reloading the same provider session keeps the injection state;
switching to a new provider session supplies the selected skills again.

Disabling a skill stops future injection and does not erase earlier instructions
from the model's history. Start a new conversation for a fresh context. Missing
resources or missing required MCP connections block the next send with guidance;
the library can remove unavailable selections. Changes wait until the current
turn is finished.

The managed Convertigo skill pack remains mandatory and is not replaced by the
custom skill library.

## MCP connections and private credentials

A declaration describes an HTTPS MCP endpoint (or loopback HTTP) or a stdio
command. It contains environment-variable references rather than credentials.
Review its URL or executable, arguments, requested environment names and header
references before enabling it. Enabling is explicit and scoped to a conversation.
Studio WEB_ADMIN is required for activation and secret management.

Enter each referenced credential under **Personal secrets**. The catalog returns
only secret names. Values remain in the user's private workspace and are sent to
the selected process through a short-lived server-memory broker. They are absent
from project declarations, browser responses, prompts and saved conversation
metadata. Codex and Claude configuration files contain environment references;
Vibe receives its additional MCP configuration through its private ACP session.
A configured MCP process receives the credentials it needs, so enable only
connections you trust. Filesystem administrators retain access to private local
files; this is not encryption at rest.

Tigo configures Codex, Claude and Vibe, including the Convertigo Vibe mode.
Additional connections use conversation-scoped homes. Configuration changes may
restart the harness and resume its previous session. Opening history does not start a provider; the next authenticated message
resolves the approved configuration before starting or resuming it. A changed active declaration
must be reviewed and explicitly re-enabled before another prompt; editing a
shared file cannot silently approve a new command or endpoint.

## On-disk format, version 1

Project resources live under `<project>/.tigo/` and are intended for Git:

```text
.tigo/
  prompts/explain-data/
    prompt.json
    prompt.en.md
    prompt.fr.md
  skills/company-data/
    skill.json          # optional for a standard SKILL.md folder
    SKILL.md            # default language
    SKILL.fr.md         # optional translation
    references/catalog.md
    scripts/...
    assets/...
  mcp.json
  .trash/...json        # recoverable metadata of removed resources
```

All project writes through the library add `/.tigo/**` to `.httpignore` before
writing resources. This blocks direct HTTP downloads; it does not remove files
from CAR archives or Git. Do not place credentials in project resources.
Existing manually created folders must receive the same `.httpignore` rule
before a project is hosted. Keep `.tigo/.trash/` out of commits when its contents
are not meant to be shared.

Personal resources use the same layout under
`<workspace>/agents/tigo/users/<userKey>/`. Studio uses `studio`; server users use
a SHA-256 identifier derived from their authenticated user. This directory also
contains `preferences.json`, `conversations/<id>.json`, and private `secrets.json`.
Identity and storage paths are derived server-side. They cannot be chosen in a
browser request. Personal files are not part of a project's CAR or Git history.

`prompt.json` contains metadata; the Markdown files contain the prompt bodies:

```json
{
  "schemaVersion": 1,
  "id": "explain-data",
  "defaultLanguage": "en",
  "surfaces": ["studio", "nocode"],
  "translations": {
    "en": {"title": "Explain the data", "description": "Read-only overview"},
    "fr": {"title": "Expliquer les données", "description": "Vue d’ensemble en lecture seule"}
  }
}
```

`skill.json` uses the same metadata and may add:

```json
{"requiresMcp": ["project:MyProject:mcp:company-data"]}
```

The identifier uses lowercase letters, digits and hyphens, begins with a letter,
and is at most 64 characters. Qualified resource keys are stable across machines:
`builtin::prompt:explain-project`, `workspace::skill:company-data`, or
`project:MyProject:mcp:company-data`. Two resources with the same short identifier
in different projects remain distinct.

`mcp.json` groups connections; each server uses the same localized metadata:

```json
{
  "schemaVersion": 1,
  "servers": [{
    "schemaVersion": 1,
    "id": "company-data",
    "defaultLanguage": "en",
    "translations": {"en": {"title": "Company data", "description": "Internal catalog"}},
    "connection": {
      "transport": "http",
      "url": "https://data.example.com/mcp",
      "env": [],
      "headers": {"Authorization": {"env": "COMPANY_API_KEY", "prefix": "Bearer "}}
    }
  }]
}
```

A stdio connection instead uses
`{"transport":"stdio","command":"node","args":["/path/to/server.js"],"env":["COMPANY_API_KEY"]}`.
Use a command available on each recipient's machine. Environment references must
be uppercase names. Provider credentials and process-wide system/proxy variables
are reserved; use dedicated MCP credential names. Literal auth headers,
credential-bearing URLs, and recognized credential command arguments are rejected.

## Editing through Convertigo MCP

The `tigo-resources` tool requires a full authenticated Convertigo MCP token.
It operates only on a named project's resources; the NoCode catalog does not
expose it. It cannot change personal favorites, activation or credentials, edit
built-in resources, or commit/push Git changes.

Supported actions: `list`, `get`, `save`, `duplicate`, `delete`, `readFile`, and
`writeFile`. Read before updating: the returned `revision` is required for edits,
removals and overwriting a support file. Conflicts fail rather than overwrite a
colleague's changes. New resources use an empty revision. `save.input` includes
Markdown bodies inside `translations.<language>.body`; storage splits them into
the files described above. `duplicate.input` is `{"id":"new-id"}`. Support-file
operations use `{"path":"references/catalog.md","content":"..."}` and are
limited to bounded UTF-8 files under the skill's three support directories.
Binary assets can be added through normal project asset/file tooling and are
preserved by skill duplication.

The Assistant's `AgentResources` facade serves the UI. It requires Studio
WEB_ADMIN or the authenticated server user, checks conversation ownership, and
protects writes with a session CSRF token. UI operations do not accept an
arbitrary user or filesystem path. The MCP tool independently validates the
full bearer token rather than relying on sequence visibility.

## Version and hosting

The 1.5.3 stable stack pairs Assistant **1.5.3**, Bridge **0.4.26**, and MCP **0.2.26**.
It uses the 8.4.6 build plugin and existing 8.4.6 NGX components and Java APIs.
The Assistant and MCP NGX references are pinned to the module-based 8.4.0.18 legacy template
(commit `8ca383ae844129df72bd3436a7869bfdc0a69d5c`); the floating 8.4 branch
now uses standalone generation and is unsuitable for the 8.4.6 generator.
Publishing a bundle and deploying a hosted frontend are separate operations.
Only the Assistant frontend belongs on backend-apps for assistant.convertigo.com;
the Bridge and MCP execute locally in Studio. TigoAccess is a separate service.
