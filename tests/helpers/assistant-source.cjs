// Test the checked-in merge result, never a potentially stale Mobile Builder output.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, '_private/ionic/node_modules/typescript'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function formattedEntries(file) {
  const lines = read(file).split('\n'), blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^( *)→: \|\s*$/.exec(lines[i]);
    if (!match) continue;
    const line = i + 1;
    const context = lines.slice(Math.max(0, i - 6), i).join('\n');
    const indent = match[1].length, body = [];
    for (i++; i < lines.length; i++) {
      if (lines[i].trim() && lines[i].search(/\S/) <= indent) { i--; break; }
      body.push(lines[i].slice(indent + 2));
    }
    const raw = body.join('\n').trim();
    // The exporter uses both raw literals and quoted/escaped FormatedContent.
    blocks.push({ line, context, code: raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw });
  }
  return blocks;
}
const formattedBlocks = file => formattedEntries(file).map(entry => entry.code);
function blockWith(file, marker) {
  const blocks = formattedBlocks(file).filter(block => block.includes(marker));
  assert.equal(blocks.length, 1, marker);
  return blocks[0];
}
function pageClass() {
  const content = blockWith('_c8oProject/mobilePages/Page.yaml', '/*Begin_c8o_PageImport*/');
  return 'class Page {\n' + content.slice(content.indexOf('/*Begin_c8o_PageFunction*/')) + '\n}';
}
function backendParts(names, constants = []) {
  const ast = ts.createSourceFile('bridge.js', read('js/agent_bridge_client.js'), ts.ScriptTarget.Latest, true);
  const parts = [], found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
      parts.push(node.getText(ast)); found.push(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && constants.includes(node.name?.getText(ast))) {
      parts.unshift('var ' + node.getText(ast) + ';'); found.push(node.name.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(found.sort(), [...names, ...constants].sort());
  // The bootstrap references the two endpoint constants.
  return 'var FALLBACK_MCP_PATH = "/api/mcp", FALLBACK_FLOW_MCP_PATH = "/api/flow-mcp";\n' + parts.join('\n');
}
module.exports = { ts, read, formattedEntries, formattedBlocks, blockWith, pageClass, backendParts };
