// Run: node --test tests/nocode-acp-tool-result.test.cjs
// ACP runtimes (Vibe) relay the MCP tool result inside the raw session update
// (rawOutput / content blocks), not in a bridge-normalized `result` field.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../js/agent_bridge_client.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  const end = source.indexOf('\n  }\n', start);
  return source.slice(start, end + 4);
}
const sandbox = {};
vm.runInNewContext(extract('noCodeFormToolResult') + '\nthis.noCodeFormToolResult = noCodeFormToolResult;', sandbox);
const saved = { status: 'ok', saved: true, form: { _id: '1789572167318', name: 'Gestion des congés' } };

test('a bridge-normalized result is still detected', () => {
  assert.equal(sandbox.noCodeFormToolResult({ structuredContent: saved }, 0).form._id, '1789572167318');
});

test('an ACP update with content blocks is detected', () => {
  const update = { sessionUpdate: 'tool_call_update', status: 'completed', title: 'Convertigo_nocode-form-create',
    content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(saved) } }] };
  assert.equal(sandbox.noCodeFormToolResult(update, 0).form._id, '1789572167318');
});

test('an ACP update with rawOutput is detected, errors are not', () => {
  assert.equal(sandbox.noCodeFormToolResult({ update: { rawOutput: { structuredContent: saved } } }, 0).form._id, '1789572167318');
  assert.equal(sandbox.noCodeFormToolResult({ update: { rawOutput: { isError: true, content: [{ type: 'text', text: JSON.stringify(saved) }] } } }, 0), null);
  assert.equal(sandbox.noCodeFormToolResult({ update: { status: 'completed', content: [] } }, 0), null);
});

test('the real Vibe MCPToolResult envelope is detected', () => {
  // vibe/core/tools/remote.py: {ok, server, tool, text, structured}; Vibe renames
  // the MCP structuredContent to structured, so reading only structuredContent
  // silently missed every no-code tool call made through Vibe.
  const envelope = { ok: true, server: 'https://test-nocode.convertigo.net/convertigo/api/mcp', tool: 'nocode-form-create', text: null, structured: saved };
  assert.equal(sandbox.noCodeFormToolResult(envelope, 0).form._id, '1789572167318');
  assert.equal(sandbox.noCodeFormToolResult({ update: { rawOutput: envelope } }, 0).form._id, '1789572167318');
});

test('the mutation detector and the preview read the ACP update', () => {
  assert.match(source, /noCodeFormToolResult\(data\.update, 0\)/);
  assert.match(source, /data\.update && data\.update\.content/);
});
