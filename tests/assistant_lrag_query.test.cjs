// A knowledge query must never make a server relay to itself:
// with its own LightRAG it queries LightRAG, without it it relays once, and a relayed relay is refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sequence = fs.readFileSync(path.join(root, '_c8oProject/sequences/LRagQuery.yaml'), 'utf8');
const hosted = fs.readFileSync(path.join(root, '_c8oProject/connectors/HostedAssistant.yaml'), 'utf8');
const lightrag = fs.readFileSync(path.join(root, '_c8oProject/connectors/LightRAG.yaml'), 'utf8');
const lines = sequence.split('\n');
const indexOfLine = re => {
  const i = lines.findIndex(l => re.test(l));
  assert.ok(i >= 0, 'no line matching ' + re);
  return i;
};
const indent = line => line.length - line.replace(/^ +/, '').length;
// Every line of the step block starting at `from`, children included.
const block = from => {
  const level = indent(lines[from]);
  let to = from + 1;
  while (to < lines.length && (lines[to].trim() === '' || indent(lines[to]) > level)) to++;
  return lines.slice(from, to).join('\n');
};

const streamThen = block(indexOfLine(/↓jThen \[steps\.ThenStep-/));
const nonStream = block(indexOfLine(/↓jElse \[steps\.ElseStep-/));
const localThen = block(indexOfLine(/↓lThen \[steps\.ThenStep-/));
const localElse = block(indexOfLine(/↓lElse \[steps\.ElseStep-/));
const relayThen = block(indexOfLine(/↓gThen \[steps\.ThenStep-/));
const relayElse = block(indexOfLine(/↓gElse \[steps\.ElseStep-/));

test('streaming still needs both a local LightRAG and stream=true', () => {
  assert.match(sequence, /condition: '"\$\{assistant\.lrag\.host\.url=\}" != "" && stream == "true"'/);
  assert.match(streamThen, /\/query\/stream/);
});

test('the non-streaming branch calls LightRAG.query_text when the symbol is defined', () => {
  // The non-streaming branch splits on the symbol alone.
  assert.match(nonStream, /↓LocalLightRag \[steps\.IfThenElseStep-\d{13}\]: \n\s+condition: '"\$\{assistant\.lrag\.host\.url=\}" != ""'/);
  assert.match(localThen, /sourceTransaction: lib_ConvertigoAssistant\.LightRAG\.query_text/);
  assert.match(lightrag, /↓query_text \[transactions\.JsonHttpTransaction\]/);
  // and it posts the JSON message the branch already builds.
  const body = localThen.slice(localThen.indexOf('↓__body '));
  assert.match(body, /↑value: 1767113260210/);
  assert.match(body, /↑value: \.\/\*/);
  assert.match(nonStream, /↓Message \[steps\.JsonObjectStep-1767113260210\]/);
  for (const field of ['query', 'response_type', 'mode', 'include_references', 'stream', 'conversation_history']) {
    assert.match(nonStream, new RegExp('↓' + field + ' \\[steps\\.Json'), field);
  }
});

test('the LightRAG answer keeps the response/references shape consumers rely on', () => {
  const copy = localThen.slice(localThen.indexOf('↓Copy_LightRag '));
  assert.match(copy, /steps\.XMLCopyStep-\d{13}/);
  assert.match(copy, /↑value: \.\/document\/object$/m);
  // same <object> wrapper as the streaming branch and as the relayed answer
  assert.match(streamThen, /doc\.createElement\("object"\)/);
  assert.match(relayThen, /↑value: \.\/document\/object\/object$/m);
});

test('HostedAssistant is only reached when the symbol is empty', () => {
  assert.equal(/HostedAssistant/.test(streamThen), false);
  assert.equal(/HostedAssistant/.test(localThen), false);
  assert.match(relayThen, /sourceTransaction: lib_ConvertigoAssistant\.HostedAssistant\.LRagQuery/);
  assert.match(relayThen, /sourceTransaction: lib_ConvertigoAssistant\.HostedAssistantBuffer\.GetTokenBuffer/);
  // the only HostedAssistant calls of the sequence live in that guarded else branch
  const calls = sequence.match(/sourceTransaction: lib_ConvertigoAssistant\.HostedAssistant/g) || [];
  assert.equal(calls.length, (relayThen.match(/sourceTransaction: lib_ConvertigoAssistant\.HostedAssistant/g) || []).length);
  assert.ok(localElse.includes(relayThen));
});

test('a relayed query is never relayed again', () => {
  // the relay marks its own call...
  assert.match(hosted, /↓__header_x_c8o_assistant_relay \[variables\.RequestableHttpVariable-\d{13}\]/);
  assert.match(hosted, /httpName: x-c8o-assistant-relay/);
  assert.match(hosted, /httpName: x-c8o-assistant-relay\n\s+value: '1'/);
  // ...and refuses to relay a request that already carries it
  assert.match(localElse, /condition: '.*getHeader\("x-c8o-assistant-relay"\).*!= "1"'/);
  assert.match(localElse, /context\.httpServletRequest == null \? ""/);
  assert.match(relayElse, /relay loop detected/);
  // the refusal still answers with the usual shape instead of hanging
  assert.match(relayElse, /doc\.createElement\("object"\)/);
  assert.match(relayElse, /doc\.createElement\("response"\)/);
  assert.equal(/sourceTransaction:/.test(relayElse), false);
});

test('no bean property carries a global symbol without a default value', () => {
  for (const file of [sequence, hosted, lightrag]) {
    for (const symbol of file.match(/\$\{[^}]*\}/g) || []) {
      assert.match(symbol, /^\$\{[\w.]+=[^}]*\}$/, symbol);
    }
  }
});

test('Convertigo YAML keeps a space after a trailing colon (the project loader rejects a bare one)', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const dir = path2.resolve(__dirname, '../_c8oProject');
  const bad = [];
  (function walk(d) {
    for (const name of fs2.readdirSync(d)) {
      const full = path2.join(d, name);
      if (fs2.statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.yaml')) continue;
      fs2.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*↓.*\]:$/.test(line)) bad.push(path2.relative(dir, full) + ':' + (i + 1));
      });
    }
  })(dir);
  assert.deepEqual(bad, []);
});
