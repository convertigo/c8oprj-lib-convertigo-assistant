# Tigo feedback: frictions and bugs sent to Convertigo

Customers who agree can send Convertigo the frictions and bugs Tigo meets, so they are fixed in the next
releases. Nothing is sent without consent, nothing of the project is sent, and the user can read every report
before it leaves the Studio.

## Consent

| Mode | What happens |
| --- | --- |
| `off` (default) | Nothing is collected; `/signaler` still prepares a report the user sends by hand. |
| `ask` | Reports wait in the Studio; the user reads them with `/retours` and sends them with `/retours envoyer`. |
| `auto` | Reports are sent after each turn. |

The user chooses with `/retours demander`, `/retours auto` or `/retours off` (`/feedback ask|auto|off` in English),
or with the setting "Retours à Convertigo" of Tigo's settings (Agent and model).
An administrator can impose a mode with the global symbol `assistant.feedback.policy`: `user` (default, the user
chooses), `off`, `ask` or `auto`. In the Studio, feedback needs the Convertigo provider's Tigo key. On a server (No Code
Studio), it needs the server's feedback key (see "On a server") and each signed-in user chooses for themselves.

## Putting it forward

- **Invitation.** After a finished turn, while nobody chose a mode and nothing is imposed, the thread shows a card that
  asks the user to share. It cites the tool calls of the turn that failed, if any. It stays at the end of the thread
  until it is answered: the next turn moves it below the new answer, and a reopened conversation shows it again after
  its last finished turn. Its buttons: "Activer avec relecture" (`ask`), "Toujours partager" (`auto`), "Pas
  maintenant" (asked again in seven days). Any choice of a mode, `off` included, ends the invitation.
- **Nudge.** In `off` mode chosen by the user, a turn with tool errors shows a card that asks again: "Activer avec
  relecture" turns `ask` on and collects the errors of that turn at once (from its saved events), "Signaler ce tour"
  puts `/signaler ` in the draft, "Pas maintenant" puts it aside for seven days.
- **Reminder.** In `ask` mode, when the reports waiting grow after a turn, a card says how many wait, with "Envoyer",
  "Relire" (the `/retours` card) and "Toujours partager" (`auto`); a reopened conversation shows it again while reports
  wait. The thread keeps one open feedback card.
- **Imposed automatic mode.** When the administrator imposes `auto`, each user sees once a card saying that Tigo's
  errors are shared with Convertigo, masked, with "Compris" (`seen`).
- **Automatic mode.** After a send made by hand in `ask` mode, the card offers "Passer en automatique" or "Garder la
  relecture" (asked again in thirty days).
- **Report a problem.** The last finished turn carries a "Signaler un problème" link that puts `/signaler ` in the
  draft (`/report ` in the other languages). Hidden when an administrator imposes `off`.
- **Setting.** "Retours à Convertigo", with the three modes and the number of reports waiting; read-only when the mode
  is imposed.

## What is collected

| Kind | Source | Content |
| --- | --- | --- |
| `agent_friction` | the agent, with the MCP tool `report-create` (listed only with consent) | area, subject, severity, summary, suggestion |
| `agent_friction` (`missing-capability:*`) | Tigo, after a completed No Code turn whose answer or comments tell the user a capability is missing, when the agent filed no friction itself | the capability (subject) and the product's fixed sentences for it |
| `tool_error` | a Convertigo MCP tool that fails or answers an error | tool, error template; for a call the agent runtime could not complete, its code, whether it retries it, the duration of the call and what the code means |
| `runtime_error` | a turn that fails (agent process, gateway, protocol) | provider, error template |
| `user_report` | `/signaler <comment>` (`/report <comment>`) on the last turn | comment, the turn's tools and their status |

Each report carries the versions (Assistant, Bridge, MCP, Studio), the provider and model, the channel, the surface
(`studio` or `nocode`), a count and its first and last dates; on a server, the user's pseudonym. The channel is `dev` when the Assistant runs from a git clone on a branch (a developer's
checkout, or a project reference that follows a branch) and `release` otherwise (a CAR install, or a clone checked out
at a tag): Convertigo reads its colleagues' reports apart from its customers'. Reports with the same fingerprint (kind, subject or tool, error template) are counted, not repeated.

Never sent: project files, forms and their data, prompts, agent answers, tool arguments or results, credentials, the
account email, the name of a server user.

## Masking

Every text is masked before it is stored and again before it is sent: emails, URLs, host names (public services such
as `llm.convertigo.com` aside), IP addresses, absolute paths, keys and tokens, UUIDs, long hexadecimal or base64 values,
the names of the projects open in the Studio (libraries aside) and, on the No Code surface, the names the user's turns
showed: form, page, component and Baserow workspace, database, table and field names, from the context the page sends
and from the results of the `nocode-*` tools (the contract aside). They become `<name>`, whatever their case (in an error template, a one-word name only as written: "position" in a
message is not the column "Position"); generic words (component types, common business words such as "Clients" or
"Test", the vocabulary of the product's messages) stay readable. These names are kept with the user's reports
(`names.json`, 500 at most) only while feedback can be sent. Error templates also replace quoted values and numbers. Texts are cut (summary 500, template 300, comment
1,000 characters).

## On a server

Tigo in the No Code Studio of a server (C8Oforms) offers the same feedback to each signed-in user.

- **Server key.** Convertigo ops install the server's feedback key, issued by TigoAccess (`AdminFeedbackClient`): the
  environment variable `TIGO_FEEDBACK_KEY` (a Kubernetes Secret), or the file `<workspace>/agents/feedback/server-key`.
  It only sends reports: no inference, no budget. Without it, nothing shows (no invitation, no link, no setting,
  `nocode-report-create` not listed) and `AgentFeedback` answers `unavailable`.
- **One user, one store.** The user is the authenticated one (`context.getAuthenticatedUser()`), never a name the page
  sends: the email of a C8Oforms OAuth user, the whole name otherwise. Their consent and reports live in
  `<workspace>/agents/feedback/users/<userKey>/` (same files as the Studio's, plus `names.json`), with the key of their
  conversations. A session without a user name has no feedback.
- **Pseudonym.** Each report carries `reporter`, an HMAC of the user key with a secret created once on the server
  (`agents/feedback/reporter-salt`, never sent): Convertigo counts the users behind a report without knowing who they
  are. Reports say their surface: `stack.surface` = `nocode`.
- **Limits.** 50 waiting reports per user. In automatic mode a user's reports leave at most every ten minutes, so that
  the server key stays under TigoAccess's hourly limit (600 batches per server key); a refused or limited send keeps
  them.
- **Agent frictions.** With the user's consent, the MCP lists `nocode-report-create` to the No Code token of that user
  only; its reports land in the user's `incoming/`. A resident agent reads its tool list once: when the user turns
  feedback on or off, the next turn restarts it on the same session (Bridge `mcpCatalogKey`, Vibe). While the tool is
  listed, the turn's prompt reminds the agent to file a capability it lacked or a workaround, not only a failing tool.
- **Missing capabilities.** An agent that tells the user it cannot do something (see the saved form in a browser, read
  the rows of a Baserow table) and works around it rarely files the friction. After a completed No Code turn in which the
  agent filed none, Tigo looks for such a statement in its answer and comments (French or English: a lack, its object,
  and the agent or its tools as subject; limits by design such as server logs or the user's rights are left out) and
  files an `agent_friction` per capability, two at most: `missing-capability:form-preview`,
  `missing-capability:table-rows`, or alone `missing-capability:<no-code tool>` / `missing-capability:other`. The report
  holds only the product's fixed summary and suggestion for that subject, never the agent's words; it is counted like
  the others by its fingerprint and follows the user's mode (reviewed in `ask`, sent after the turn in `auto`).

## Storage in the Studio

`<engine workspace>/agents/feedback/`:

- `settings.json`: `{ "mode": "off|ask|auto", "updatedAt": ms, "decidedAt": ms, "snoozedUntil": ms, "nudgeUntil": ms,
  "autoOfferUntil": ms }` (`decidedAt` when the user chose a mode; the three others after "Pas maintenant" on the
  invitation or the nudge, or "Garder la relecture")
- `outbox/<reportId>.json`: reports waiting to be sent (100 at most, the oldest dropped first)
- `sent.json`: the 50 last reports sent (id, kind, subject, date), for `/retours`

## Report format (`tigo-feedback/1`)

```json
{
  "schemaVersion": "tigo-feedback/1",
  "reportId": "uuid",
  "kind": "agent_friction | tool_error | runtime_error | user_report",
  "fingerprint": "sha256 hex",
  "count": 1,
  "firstAt": "ISO date",
  "lastAt": "ISO date",
  "finding": { "area": "", "subject": "", "severity": "low|medium|high", "summary": "", "suggestion": "", "template": "" },
  "turn": { "steps": 0, "tools": [{ "name": "", "calls": 0, "failures": 0 }] },
  "comment": "",
  "stack": { "assistant": "", "bridge": "", "mcp": "", "studio": "", "provider": "", "model": "", "channel": "dev|release", "surface": "studio|nocode" },
  "reporter": "hmac-sha256 hex (server only)"
}
```

`turn` and `comment` are only set for `user_report`; `template` for `tool_error` and `runtime_error`.

Vibe answers every tool call it could not complete with "The provided tool call failed": the cause is its error code
(`mcp_transport_failed`, `mcp_timeout`, `mcp_authorization_required`...), which the Bridge passes with the tool update
(`failure`: code, retryable, details, duration). The template of such a `tool_error` ends with the code in brackets, so
each cause has its own fingerprint, and its `summary` says the code, whether Vibe retries it, the duration of the call
and what the code means (`mcp_transport_failed, not retryable, after 0.4 s: the MCP client failed on the call or on its
answer: ...`). Runtime codes are words of the product: they are never masked.

## Sending

`POST https://<assistant.tigo.access.host>/convertigo/projects/TigoAccess/.json?__sequence=submitFeedback` with the
form fields `apiKey` (the local Tigo key, or the server's feedback key, never shown) and `reports` (a JSON array, 50 reports and 256 KB at most).
TigoAccess checks the key as `getQuota` does, validates every report and stores the batch under the account's
pseudonymous id (a hash, never the email). It answers `{ "status": "ok", "accepted": [ids], "rejected": [{ id, reason }] }`;
accepted reports leave the outbox. A refusal, a rate limit (`rate_limited`, 60 batches per hour for a Studio key, 600
for a server key) or an unreachable service keeps them for the next attempt; a report
sent again after a lost answer is counted once by TigoAccess (same account, same report id). A loopback host
(`localhost`, `127.0.0.1`, `*.localhost`) is reached in plain HTTP, to test against a local TigoAccess.

Convertigo reads them with the admin sequence `AdminFeedback` of TigoAccess, one list per channel (`release`, `dev`,
and `unknown` for reports without a channel), grouped by fingerprint (count, accounts, versions, last date, a sample).
