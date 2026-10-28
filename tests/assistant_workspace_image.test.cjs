// The Studio Assistant shows the images its agent looked at; a No Code user saw none: AgentWorkspaceImage served
// WEB_ADMIN sessions only. A No Code session now gets the images of its user's own attachments, the ones the Agent
// Bridge describes for a model that cannot see, and of its agent's working folder, and nothing else of the server.
// node --test tests/assistant_workspace_image.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const files = new Set();

class FakePath {
  constructor(p) { this.p = p; }
  startsWith(other) { return this.p === other.p || this.p.startsWith(other.p + '/'); }
  relativize(other) { return path.relative(this.p, other.p); }
  toString() { return this.p; }
}
class FakeFile {
  constructor(parent, child) { this.p = child === undefined ? String(parent) : path.join(String(parent.p || parent), String(child)); }
  getCanonicalFile() { return new FakeFile(path.resolve(this.p)); }
  isAbsolute() { return path.isAbsolute(this.p); }
  isFile() { return files.has(path.resolve(this.p)); }
  length() { return PNG.length; }
  toPath() { return new FakePath(path.resolve(this.p)); }
}
const digest = { getInstance: () => ({ digest: bytes => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest(), b => (b > 127 ? b - 256 : b)) }) };
class JString { constructor(t) { this.t = String(t); } getBytes() { return Array.from(Buffer.from(this.t, 'utf8')); } }

function load({ admin = false, user = '' } = {}) {
  const sandbox = {
    Packages: { com: { twinsoft: { convertigo: { engine: {
      Engine: { USER_WORKSPACE_PATH: '/ws', PROJECTS_PATH: '/projects', authenticatedSessionManager: { hasRole: () => admin } },
      AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN' } }
    } } } } },
    java: { io: { File: FakeFile }, nio: { file: { Files: { readAllBytes: () => PNG } } }, util: { Base64: { getEncoder: () => ({ encodeToString: b => Buffer.from(b).toString('base64') }) } },
      security: { MessageDigest: digest }, lang: { String: JString } }
  };
  vm.runInNewContext(read('js/agent_workspace_image.js'), sandbox);
  const api = sandbox.C8O.assistantWorkspaceImage;
  const ctx = { httpSession: {}, getAuthenticatedUser: () => user };
  return { api, get: p => api.read(ctx, { path: p }) };
}

const user = 'charlesg@convertigo.com';
function assistantSlug(value) {
  const sandbox = { trim: v => String(v ?? '').trim(), MessageDigest: digest, java: { lang: { String: JString } }, StandardCharsets: { UTF_8: 'utf8' } };
  vm.runInNewContext(backendParts(['userPathSlug', 'safePathPart', 'hashShort']), sandbox);
  return sandbox.userPathSlug(value);
}

test('the user folder name is the Assistant\'s', () => {
  const { api } = load();
  for (const value of [user, 'google:1087:Someone.Else@Example.com', 'testuser@convertigo_yopmail.com']) {
    assert.equal(api.userPathSlug(value), assistantSlug(value), value);
  }
  assert.equal(api.userPathSlug(user), 'charlesg_convertigo.com--6f44028bedca0f0f', 'the folder of test-nocode');
});

test('a No Code session reads its own attachments and its agent\'s working files only', () => {
  const slug = assistantSlug(user);
  const own = ['/ws/agents/attachments/' + slug + '/shared/form.png', '/ws/agents/convertigo/users/' + slug + '/conversations/agent-1/attachments/scan.png',
    '/ws/agents/vibe/homes-convertigo/users/' + slug + '/scratch/conversation-1/chart.png'];
  const others = ['/ws/agents/attachments/other--0000000000000000/shared/x.png', '/ws/agents/convertigo/users/' + slug + '/conversations/agent-1/transcript.png',
    '/ws/agents/vibe/homes-convertigo/users/' + slug + '/x.png', '/ws/agents/vibe/homes-convertigo/users/' + slug + '/.vibe-home/logs/x.png',
    '/ws/agents/vibe/homes-convertigo/users/other--0000000000000000/scratch/conversation-1/x.png',
    '/projects/C8Oforms/x.png', '/ws/agents/attachments/' + slug + '/shared/../../other/shared/x.png'];
  [...own, ...others].forEach(p => files.add(path.resolve(p)));
  const nocode = load({ user: 'google:108792390496318778325:' + user });
  for (const p of own) {
    const r = nocode.get(p);
    assert.equal(r.ok, true, p + ' ' + JSON.stringify(r));
    assert.equal(r.mimeType, 'image/png');
  }
  for (const p of others) {
    assert.deepEqual(JSON.parse(JSON.stringify(nocode.get(p))), { ok: false, error: { code: 'not_found' } }, p);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(load({ user: '' }).get(own[0]))), { ok: false, error: { code: 'authentication_required' } });
  assert.equal(load({ admin: true }).get('/projects/C8Oforms/x.png').ok, true, 'the Studio as before');
});
