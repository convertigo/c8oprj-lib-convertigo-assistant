// A file the user attaches that is not an image (a spreadsheet, a CSV, a PDF, a Word file) reaches the agent by its
// name, with the MCP tool that reads it: nocode-attachment-read in the No Code Studio, attachment-read in a Studio
// (lib_ConvertigoMCP js/attachment_read.js). Only the images go to the Agent Bridge, and a No Code agent cannot open
// the attachments folder (test-nocode 16/11: "permission denied" on an attached xlsx), so its line gives no path.
// node --test tests/assistant_attachment_read.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const javaProxy = new Proxy(function () {}, {
  get(_target, property) { return property === Symbol.toPrimitive ? () => '' : javaProxy; },
  apply() { return javaProxy; },
  construct() { return javaProxy; }
});

function serverApi() {
  const sandbox = { Packages: javaProxy, context: javaProxy, request: javaProxy, log: javaProxy, C8O: {}, java: javaProxy };
  let source = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  source = source.replace(/\}\(\)\);\s*$/, 'C8O.assistantAgentBridge._attachmentTest = { buildSequencePrompt, attachedImagePaths, probe: function (f) { attachmentReadProbe = f; } };}());');
  vm.runInNewContext(source, sandbox, { filename: 'agent_bridge_client.js' });
  return sandbox.C8O.assistantAgentBridge._attachmentTest;
}

const api = serverApi();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const files = [
  { filename: 'liste_directions.xlsx', path: '/workspace/agents/attachments/person_example.invalid--0123456789abcdef/shared/liste_directions.xlsx', type: XLSX, bytes: 9114, object: 'file' },
  { filename: 'maquette.png', path: '/workspace/agents/attachments/person_example.invalid--0123456789abcdef/shared/maquette.png', type: 'image/png', bytes: 1200, object: 'file' }
];
const noCode = extra => Object.assign({ rawUserQuestion: 'x', userId: 'person@example.invalid', provider: 'vibe', AIFiles: JSON.stringify(files) }, extra || {});
const studio = extra => Object.assign({ rawUserQuestion: 'x', userId: 'studio', provider: 'vibe', threadid: 'agent-1', AIFiles: JSON.stringify(files) }, extra || {});
const attachmentLines = prompt => prompt.split('\n').filter(line => /^- attachment \d/.test(line));

test('No Code: a spreadsheet is read by its name with nocode-attachment-read, never by its path; an image keeps its line', () => {
  const asked = [];
  api.probe(sequence => { asked.push(sequence); return true; });
  const prompt = api.buildSequencePrompt('Crée le formulaire', noCode());
  assert.deepEqual(asked, ['tools_nocode_attachment_read']);
  assert.deepEqual(attachmentLines(prompt), [
    '- attachment 1; name=liste_directions.xlsx; type=' + XLSX + '; size=9114; read it with `nocode-attachment-read` {"name": "liste_directions.xlsx"}',
    '- attachment 2; name=maquette.png; path=/workspace/agents/attachments/person_example.invalid--0123456789abcdef/shared/maquette.png; type=image/png; size=1200'
  ]);
  assert.match(prompt, /Read every other attached file \(spreadsheet, CSV, PDF, Word, text\) with the `nocode-attachment-read` MCP tool by its name/);
  assert.match(prompt, /Your sandbox cannot open the attachments folder: never try their path with a shell, a file tool or code\./);
  assert.equal(prompt.includes('/shared/liste_directions.xlsx'), false);
  // the Bridge still gets the image only
  assert.deepEqual(JSON.parse(JSON.stringify(api.attachedImagePaths(JSON.stringify(files)))), [files[1].path]);
});

test('Studio: attachment-read is named next to the path the agent can open', () => {
  api.probe(sequence => sequence === 'tools_attachment_read');
  const lines = attachmentLines(api.buildSequencePrompt('Importe ce fichier', studio()));
  assert.equal(lines[0], '- attachment 1; name=liste_directions.xlsx; path=' + files[0].path + '; type=' + XLSX + '; size=9114; read it with `attachment-read` {"name": "liste_directions.xlsx"}');
  assert.doesNotMatch(api.buildSequencePrompt('x', studio()), /Your sandbox cannot open/);
});

test('an MCP without the tool, or images only: the lines are the former ones', () => {
  api.probe(() => false);
  const prompt = api.buildSequencePrompt('x', noCode());
  assert.equal(attachmentLines(prompt)[0], '- attachment 1; name=liste_directions.xlsx; path=' + files[0].path + '; type=' + XLSX + '; size=9114');
  assert.doesNotMatch(prompt, /Read every other attached file/);
  let asked = 0;
  api.probe(() => { asked++; return true; });
  const imagesOnly = api.buildSequencePrompt('x', noCode({ AIFiles: JSON.stringify([files[1]]) }));
  assert.equal(asked, 0, 'no MCP lookup without another file');
  assert.doesNotMatch(imagesOnly, /attachment-read/);
});
