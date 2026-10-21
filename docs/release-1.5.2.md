# Tigo 1.5.2

Tigo 1.5.2 is the new stable bundle: Assistant **1.5.2**, Bridge **0.4.25** and
MCP **0.2.25**, compatible with Convertigo **8.4.6**. It promotes the 1.5 line
(prompt, skill and MCP library) after the supervised Tigo build campaign of
October 2026. The default manifest, its stable copy and the page fallback all
select this bundle; the preview manifest points at the same one.

## Conversation view

- A turn reads as a work log: the agent's comments, consecutive tool calls grouped
  in one expandable row, a live banner, a side column (plan, context, usage) on
  wide panels and a status dock on narrow ones.
- The agent's reasoning, when the runtime streams it, is folded above the step it
  led to (comment, tool call or final answer) and shown as it streams in the status
  dock. A long block keeps its start and end.
- Screenshots the agent takes or reads, and images it analyses, show in the
  thread; a closed tool group shows them as small thumbnails.
- Sub-agents (browser verifier, constructor) each get their own block with their
  task, steps, report and cost.
- The whole of a long turn stays visible, live and when the conversation is
  reopened; a stopped turn is reported as stopped, and a plan task it left open
  as interrupted.
- The conversation list of the Studio is reworked, and new conversations get a
  title of up to 140 characters.

## Agent commands and usage

- A "/" menu offers the agent's own commands (from the first prompt on) and the
  local `/metrics` command; slash commands are sent as typed.
- The context gauge, compaction options and the plan stay visible; a refused
  compaction is reported.
- The usage panel shows every model of the session with its cost source, the
  real cached tokens when the runtime reports them, the session measures and the
  vision calls.

## Bridge 0.4.25

- Vibe 3: Mistral Large 4 declares its output cap, so Vibe 3 no longer asks the
  gateway for more completion tokens than it accepts.
- Browser-verify and constructor sub-agents, with their usage per profile and model.
- Vibe session measures and costs per model from the session journal.
- Plans and context usage for the resident providers; call arguments are sent with
  their results; anonymous callers are refused.

## MCP 0.2.25

- `business-sequence-create`: reads, writes, read variables, business refusals and
  session login, with clearer refusals.
- `ngx-page-create`: entry page, form fields, row actions and selection.
- `databaseobject-tree-apply` refuses values the engine cannot take; QNames of
  shared components resolve.
- `project-lint` reviews component texts; the guides cover SMTP, HSQLDB and the
  Playwright pitfalls found during the campaign.
- `scripts/yaml_mcp_delta_apply.py` syncs edited project YAML into the Studio, with
  its lint.

## Validation

Automated tests pass: Assistant 169 of 170 (the quota test needs a Page
snapshot), Bridge 15 suites, MCP 24 of 26 validation scripts (one needs the
C8oForms checkout, one runs under Rhino only) and the delta script suite. Two
Assistant tests were brought up to date with the code. Each project loads with
`gradlew load`. Supervised Tigo runs built the reference application
end to end on GLM 5.3 and checked Vibe 3.0.1 on a 20-minute run.

Installed Studios propose the update from the stable manifest. Publishing these
artifacts does not deploy a server: backend-apps hosts only the Assistant
frontend, deployed by its manual workflow.
