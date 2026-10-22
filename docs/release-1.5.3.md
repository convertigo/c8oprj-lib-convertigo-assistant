# Tigo 1.5.3

Tigo 1.5.3 is the new stable bundle: Assistant **1.5.3**, Bridge **0.4.26** and
MCP **0.2.26**, compatible with Convertigo **8.4.6**. It adds the opt-in feedback
to Convertigo: users who agree send the frictions and errors Tigo meets, masked,
so that they get fixed in the next releases. The default manifest, its stable copy
and the page fallback all select this bundle; the preview manifest points at the
same one. Previous stable: 1.5.2 (Bridge 0.4.25, MCP 0.2.25).

## Feedback to Convertigo

- Consent: off by default. `ask` keeps the reports in the Studio until the user
  reviews and sends them, `auto` sends them at the end of each turn. An
  administrator can impose a mode with the global symbol `assistant.feedback.policy`.
- Collected with consent: Convertigo tool errors (an error template, never the
  arguments or the result), failed turns, and the frictions the agent files with
  the MCP tool `report-create`. `/signaler` (`/report`) prepares a report on the
  last turn with the user's comment, even when collection is off.
- Never sent: project files, prompts, answers, tool arguments or results,
  credentials, the account email. Emails, URLs, IP addresses, paths, keys, tokens,
  encoded values and the names of the open projects are masked before a report is
  stored and again before it is sent. The same report is counted, not repeated.
- Each report says its stack (versions, provider, model) and its channel:
  `release`, or `dev` for an Assistant run from a git clone on a branch.
- The thread puts it forward: an invitation after a finished turn while no mode
  was chosen (it stays until answered, or comes back a week after "Not now"), a
  nudge after a turn with tool errors when the user chose `off`, a reminder of the
  reports waiting in `ask` mode with Send, Review and "always share", an offer of
  automatic mode after a manual send, a "Report a problem" link on the last
  finished turn, and a "Feedback to Convertigo" setting.
- `/retours` (`/feedback`) shows the waiting reports and the exact JSON sent, with
  Send and Clear.
- Reports go to TigoAccess (`submitFeedback`, deployed 2026-10-22) with the local
  Tigo key, stored under a pseudonymous account reference. Convertigo reads them in
  the TigoAccess administration, tab "Tigo feedback".

Contract: [tigo-feedback.md](tigo-feedback.md).

## Assistant

- The Assistant's own connectors (OpenAI, LightRAG, HostedAssistant, TigoAccess)
  are Private: reached only from the Assistant's sequences.

## Bridge 0.4.26

- Claude Code names the model that answered with the context usage, so the model
  of a turn is known when the conversation runs on the CLI's default.

## MCP 0.2.26

- `report-create` opens with the Tigo feedback consent and queues the agent's
  friction for the Assistant, which masks, counts and sends it.

## Validation

Automated tests pass: Assistant 193 of 194 (the quota test needs a Page
snapshot), Bridge 15 suites, MCP 24 of 26 validation scripts (one needs the
C8oForms checkout, one runs under Rhino only), the deployment policy tests and the
TigoAccess feedback tests. Each project loads with `gradlew load` on 8.4.6. The
feedback was exercised end to end: collection on a real GLM and Claude Code turn,
the cards in the Studio, sending to a local TigoAccess, then to the production
TigoAccess.

Installed Studios propose the update from the stable manifest. Promoting the
Assistant release to stable deploys its frontend to production.
