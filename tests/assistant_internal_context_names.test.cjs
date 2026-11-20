// An internal call names its Convertigo context. A name built from the clock is shared by two calls made in the same
// millisecond in one HTTP session: the second waits on the first's context lock (the No Code token and the user's
// gateway key are asked that way, while the panel sends several requests at once). Every internal context name is
// unique, or a deliberate shared name (a key, a session), never the time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function files(dir, pattern) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(rel, pattern);
    return pattern.test(entry.name) ? [rel] : [];
  });
}

test('no internal context is named after the clock', () => {
  const offenders = [];
  for (const file of files('js', /\.js$/).concat(files('_c8oProject', /\.yaml$/))) {
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      if (/__context/.test(line) && /now\(\)|currentTimeMillis|nanoTime|new Date|Date\.now/.test(line)) {
        offenders.push(file + ':' + (index + 1) + ': ' + line.trim());
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('callLocalSequence names each call with a UUID', () => {
  const source = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  assert.match(source, /params\.put\("__context", "agentToken_" \+ String\(UUID\.randomUUID\(\)\)\);/);
});
