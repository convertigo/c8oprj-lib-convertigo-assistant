# Assistant 1.4.48 / MCP 0.2.23

The Studio bundle moves from MCP 0.2.20 to MCP 0.2.23 and keeps Bridge 0.4.22.
The Assistant itself is unchanged apart from the two manifest copies.

- MCP answers the JSON-RPC `ping` inline in `mcp_endpoint`, without a
  sub-sequence: about half the latency and half the engine log lines per ping.
- `_setupClaude`, `_setupCodex` and `_setupVibe` write `X-Convertigo-No-Log: true`
  on the `convertigo` MCP server, with the Bridge's rule (`mcpNoLog`, then the
  `agentbridge.mcp.nolog` global symbol, then true). From Convertigo 8.4.6 the
  engine then writes no log for the MCP requests of those clients.
- MCP 0.2.21 (canonical JWT signatures only) and the No Code contract updates
  made since 0.2.20 come with it.

Publishing this bundle does not deploy projects to backend-apps.
