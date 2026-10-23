# Personal and team access

Tigo keeps a personal key and a distinct key per LiteLLM user/team pair. The personal key retains its one-time welcome budget and spend while team calls use the shared team budget. LiteLLM memberships and budgets are authoritative; FullSync stores the identity/key binding rather than a second team directory.

The Studio refreshes access using its authenticated PSC before every Convertigo-agent turn. Quota reads can request the same refresh when a key no longer matches membership. The key file is atomically replaced only when its fingerprint changes; the CLI bridge synchronizes changed file credentials at its next start. Manual keys remain untouched.

The usage popup labels the active access, team-wide spend, the user's own team spend and preserved personal credit. Missing member counters remain unavailable. An exhausted or blocked team never falls back to the personal gift.

Existing accounts with duplicate user budgets require explicit migration before team use; no budgets or spend are reset automatically. The pilot should verify first entry, repeated refresh, exhausted/expired access, removal and re-entry, including unchanged personal spend and per-member limits.

This work is local to the official Studio 8.4.6 environment. Production publication and deployment remain separate actions.
