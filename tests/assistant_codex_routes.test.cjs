const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The front CRUD generator upsert-ngx-crud-kit is retired from what agents see (13/11): pages are built one by one with
// ngx-page-create. The routes the Assistant names to Codex for the standard Convertigo path follow.
test('the Codex routes of the standard path name ngx-page-create, never the retired CRUD kit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'agent_bridge_client.js'), 'utf8');
  const line = source.split('\n').find(l => l.includes('Codex callable routes for the standard Convertigo path'));
  assert.ok(line);
  assert.match(line, /`tools\.mcp__convertigo__upsert_crud`, `tools\.mcp__convertigo__crud_proof`, `tools\.mcp__convertigo__ngx_page_create`/);
  assert.doesNotMatch(source, /upsert_ngx_crud_kit|upsert-ngx-crud-kit/);
});
