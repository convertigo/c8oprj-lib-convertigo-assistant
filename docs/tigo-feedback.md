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
chooses), `off`, `ask` or `auto`. Feedback needs the Convertigo provider's Tigo key, so it is available in the Studio
only.

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
| `tool_error` | a Convertigo MCP tool that fails or answers an error | tool, error template |
| `runtime_error` | a turn that fails (agent process, gateway, protocol) | provider, error template |
| `user_report` | `/signaler <comment>` (`/report <comment>`) on the last turn | comment, the turn's tools and their status |

Each report carries the versions (Assistant, Bridge, MCP, Studio), the provider and model, the channel, a count and
its first and last dates. The channel is `dev` when the Assistant runs from a git clone on a branch (a developer's
checkout, or a project reference that follows a branch) and `release` otherwise (a CAR install, or a clone checked out
at a tag): Convertigo reads its colleagues' reports apart from its customers'. Reports with the same fingerprint (kind, subject or tool, error template) are counted, not repeated.

Never sent: project files, prompts, agent answers, tool arguments or results, credentials, the account email.

## Masking

Every text is masked before it is stored and again before it is sent: emails, URLs, IP addresses, absolute paths,
keys and tokens, long hexadecimal or base64 values, and the names of the projects open in the Studio (libraries
aside). Error templates also replace quoted values and numbers. Texts are cut (summary 500, template 300, comment
1,000 characters).

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
  "stack": { "assistant": "", "bridge": "", "mcp": "", "studio": "", "provider": "", "model": "", "channel": "dev|release" }
}
```

`turn` and `comment` are only set for `user_report`; `template` for `tool_error` and `runtime_error`.

## Sending

`POST https://<assistant.tigo.access.host>/convertigo/projects/TigoAccess/.json?__sequence=submitFeedback` with the
form fields `apiKey` (the local Tigo key, never shown) and `reports` (a JSON array, 50 reports and 256 KB at most).
TigoAccess checks the key as `getQuota` does, validates every report and stores the batch under the account's
pseudonymous id (a hash, never the email). It answers `{ "status": "ok", "accepted": [ids], "rejected": [{ id, reason }] }`;
accepted reports leave the outbox. A refusal or an unreachable service keeps them for the next attempt; a report
sent again after a lost answer is counted once by TigoAccess (same account, same report id). A loopback host
(`localhost`, `127.0.0.1`, `*.localhost`) is reached in plain HTTP, to test against a local TigoAccess.

Convertigo reads them with the admin sequence `AdminFeedback` of TigoAccess, one list per channel (`release`, `dev`,
and `unknown` for reports without a channel), grouped by fingerprint (count, accounts, versions, last date, a sample).
