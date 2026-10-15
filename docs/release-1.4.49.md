# Assistant 1.4.49: clearer LiteLLM access errors

When a model is allowed on a LiteLLM key but not on its user, Vibe can report
"Invalid API key" even though the key is valid. Tigo now explains that model
permissions must be checked on both the key and its LiteLLM user.

- An explicit HTTP 403 reports denied model access.
- An explicit HTTP 401 reports a rejected API key.
- When Vibe drops the HTTP status, Tigo gives neutral guidance to check key
  validity and model permissions, without claiming that the key is invalid.
- Messages are available in French and English. Other harnesses keep their
  existing error handling; raw diagnostic envelopes and credentials stay hidden.

The Studio bundle contains Assistant 1.4.49, Bridge 0.4.22 and MCP 0.2.23.
It remains compatible with Convertigo 8.4.6 and uses Gradle plugin 8.4.6.
Both manifest copies pin the same release archives.

Validation covers structured 401/403 errors, Vibe errors without HTTP details,
translations, unrelated errors, credential redaction and stack behavior. The
error helper also compiles and executes with the official Convertigo 8.4.6
Rhino runtime; the project loads with Gradle plugin 8.4.6. The user's real
"liste les projets" request succeeded after aligning LiteLLM user permissions.

This release publishes the CAR and bundle manifest without deploying to
backend-apps or assistant.convertigo.com.
