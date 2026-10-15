# Assistant 1.4.47 / Bridge 0.4.22

The Studio bundle keeps MCP 0.2.20 and remains compatible with Convertigo 8.4.6.

- Windows runtime discovery tolerates quoted/invalid PATH entries and stops as
  soon as a usable executable is found. Full settings checks can warn about
  disabled long paths or a failing >260-character filesystem probe. The runtime
  settings provide recovery instructions and a Microsoft documentation link.
- Browser login polling parses Convertigo's string-valued flags independently;
  `login=false` no longer masks `loginStatus=true`. A delayed CLI verification or
  fallback URL opens once, and the button distinguishes signing in from updating.
- Opening Assistant preserves the selected Claude model when an empty startup
  response contains a fallback model from a different harness.

Tests cover registry states, cleanup after filesystem failures, hidden diagnostics
on other platforms, translated warning text, browser login polling and preference
restoration. The production frontend is compiled through the hotfix MCP; both
projects are loaded/exported with the official 8.4.6 plugin.

Windows warning layout is checked in the native hotfix Assistant with temporary
simulated diagnostic data on macOS. This verifies the UI, not an actual Windows
installation. The simulation is removed before release. Native acceptance remains
necessary on the affected Windows PCs.

Publishing this bundle does not deploy projects to backend-apps. That host needs
only Assistant for its public frontend; Bridge and MCP execute in the local
Studio. Existing manually configured LiteLLM keys are retained.
