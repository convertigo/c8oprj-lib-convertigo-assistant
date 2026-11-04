# Tigo 1.5.8

This stable candidate is based on Assistant 1.5.7, Bridge 0.4.29 and MCP 0.2.28.
It does not include other pending preview changes.

The optional global symbol `assistant.agents.directory` selects a dedicated,
absolute storage directory across all three projects. It can shorten Windows
runtime paths in managed environments without moving the Eclipse workspace.
The default location remains unchanged when the symbol is empty or absent.

Install the coherent stack: Assistant 1.5.8, Bridge 0.4.30, MCP 0.2.29. See
[configuration and migration](agents-directory.md) before changing an existing
installation. Runtimes and account data are not moved automatically.

Validation includes offline path and isolation tests, native JVM file access,
and project loading with the Convertigo 8.4.6 build plugin. Windows/Citrix
installation is the target acceptance check and is not replaced by macOS tests.

Publishing this Studio bundle does not authorize deployment to backend-apps.
