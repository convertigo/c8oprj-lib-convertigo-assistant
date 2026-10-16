# Tigo 1.5.1 preview

This preview refines the prompt, skill and MCP library and restores reliable
Studio Java context initialization. The reviewed customer stable bundle remains
Assistant **1.4.49**, Bridge **0.4.22**, and MCP **0.2.23**.

The preview bundle contains Assistant **1.5.1**, Bridge **0.4.24**, and MCP
**0.2.24**, compatible with Convertigo **8.4.6**.

- Compact Prompts, Skills and MCP toggles sit beside attachments; favorite prompts
  append to the existing draft without sending a message. The options button is
  aligned with the prompt chips.
- Library favorites appear first in personal order, with up/down actions beside
  the star. Other prompts follow alphabetically in the selected language.
- Resource fields have separate labels, visible Save/Cancel actions and light/dark
  theme support. Switching categories hides the editor while retaining its draft.
  Optional skill MCP requirements use inline choices and stay hidden when empty.
- Built-in French prompt bodies are written in French. Skill editors show only
  instructions and generate the SKILL.md name and description on save, preserving
  additional metadata. Full SKILL.md pastes are supported.
- Native Studio context requests wait for their JavaScript receiver, including
  late Java injection. Provider choices have consistent widths.
- Explicit model refresh reloads the gateway catalog without reinstalling the
  runtime. Bridge 0.4.24 declares ML4 image capability, sends ACP image blocks and
  refreshes stale resident model catalogs; GLM remains text-only.

Validation includes the native hotfix Studio view on port 18082, five reloads
without console errors, resource-save and reorder checks, automated Assistant
and Bridge tests, and official 8.4.6 generation/build checks. ML4 image transport
is checked with a synthetic ACP payload; this publication does not claim a new
end-to-end vision inference test.

The bundle ZIP is a download container: extract it and import the three CARs
together in Studio. Its preview manifest identifies the exact companion versions.
The default manifest still selects stable 1.4.49; installing this preview is
explicit. See [release channels](release-channels.md).

Publishing these artifacts does not deploy a server. Backend-apps hosts only the
Assistant frontend; Bridge and MCP belong to the local Studio stack.
