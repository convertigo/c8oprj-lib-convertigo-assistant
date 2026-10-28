// nocode-form-preview-capture asks the No Code Studio page for an image of a form's preview. The MCP leaves the request
// in context.server; the Tigo panel takes it while it reads the turn (readResponse) and the page's PNG comes back
// through AgentHostRequestResult, which writes it in the conversation's attachments and marks the request done.
// node --test tests/assistant_host_requests.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/agent_host_requests.js'), 'utf8');

class FakeMap {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  put(k, v) { this.m.set(k, v); }
  replace(k, before, after) { if (this.m.get(k) !== before) return false; this.m.set(k, after); return true; }
  keySet() { const keys = [...this.m.keys()]; return { toArray: () => keys }; }
}

// a 3 x 2 PNG: signature, then the IHDR chunk with its width and height
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]), Buffer.alloc(40)]);

function world() {
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  const requests = new FakeMap();
  const conversations = new FakeMap();
  conversations.put('agent-1', requests);
  const store = new Map([['lib_ConvertigoAssistant.hostRequests', conversations]]);
  const clock = { now: 1793000001000 };
  const written = [];
  const host = {
    server: () => ({ get: k => store.has(k) ? store.get(k) : null }),
    now: () => clock.now,
    decodeBase64: text => Buffer.from(text, 'base64'),
    write: (name, bytes) => { written.push({ name, bytes }); return '/workspace/agents/vibe/users/g/conversations/agent-1/attachments/' + name; }
  };
  const leave = changes => requests.put('cap-1', JSON.stringify(Object.assign({ id: 'cap-1', kind: 'preview-capture', conversationId: 'agent-1',
    user: 'gregoryv@convertigo.com', formId: '1792769924346', formName: 'Congés', page: '2', device: 'mobile', createdAt: 1793000000000,
    expiresAt: 1793000060000, status: 'pending', takenAt: 0, note: '', result: null, error: null }, changes)));
  const request = () => JSON.parse(requests.get('cap-1'));
  return { api: sandbox.C8O.assistantHostRequests, host, clock, written, leave, request };
}

test('the panel takes the pending requests of its conversation and user once, without the user', () => {
  const w = world();
  w.leave({});
  assert.equal(w.api.take('agent-2', 'gregoryv@convertigo.com', w.host).length, 0, 'another conversation');
  assert.equal(w.api.take('agent-1', 'damienn@convertigo.com', w.host).length, 0, 'another user');
  const taken = w.api.take('agent-1', 'GregoryV@convertigo.com', w.host);
  assert.deepEqual(JSON.parse(JSON.stringify(taken)), [{ requestId: 'cap-1', kind: 'preview-capture', formId: '1792769924346', formName: 'Congés', page: '2', device: 'mobile' }]);
  assert.deepEqual([w.request().status, w.request().takenAt], ['taken', 1793000001000]);
  assert.equal(w.api.take('agent-1', 'gregoryv@convertigo.com', w.host).length, 0, 'once');
  const late = world();
  late.leave({});
  late.clock.now = 1793000060001;
  assert.equal(late.api.take('agent-1', 'gregoryv@convertigo.com', late.host).length, 0, 'expired: the MCP answers no_page');
  assert.equal(world().api.take('', 'gregoryv@convertigo.com', world().host).length, 0);
});

test('the page\'s PNG is written in the attachments and the request is done, with the size read in the image', () => {
  const w = world();
  w.leave({ status: 'taken', takenAt: 1793000000500 });
  const answer = w.api.result({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'cap-1', status: 'done', image: 'data:image/png;base64,' + png.toString('base64') }, w.host);
  assert.equal(answer.ok, true);
  assert.equal(w.written[0].name, 'preview-1792769924346-2-mobile-1793000001000.png');
  assert.equal(Buffer.compare(Buffer.from(w.written[0].bytes), png), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(w.request().result)), {
    path: '/workspace/agents/vibe/users/g/conversations/agent-1/attachments/preview-1792769924346-2-mobile-1793000001000.png',
    absolutePath: '/workspace/agents/vibe/users/g/conversations/agent-1/attachments/preview-1792769924346-2-mobile-1793000001000.png',
    width: 3, height: 2
  });
  assert.equal(w.request().status, 'done');
});

test('a refusal or a failure of the page fails the request with its reason; an unknown reason is capture_failed', () => {
  for (const [reason, kept] of [['declined', 'declined'], ['unsupported_browser', 'unsupported_browser'], ['unknown_page', 'unknown_page'], ['<script>', 'capture_failed']]) {
    const w = world();
    w.leave({ status: 'taken', takenAt: 1793000000500 });
    assert.equal(w.api.result({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'cap-1', status: 'failed', reason }, w.host).ok, true);
    assert.deepEqual([w.request().status, w.request().error.reason], ['failed', kept]);
  }
});

test('while the user is asked to allow the preview, the request stays taken with the note sharing_off', () => {
  const w = world();
  w.leave({ status: 'taken', takenAt: 1793000000500 });
  assert.equal(w.api.result({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'cap-1', status: 'waiting_sharing' }, w.host).status, 'waiting');
  assert.deepEqual([w.request().status, w.request().note, w.request().takenAt], ['taken', 'sharing_off', 1793000000500]);
});

test('nothing is written for another user, another conversation, a request not taken or an image that is no PNG', () => {
  const image = png.toString('base64');
  const cases = [
    [{ status: 'taken' }, { userId: 'damienn@convertigo.com' }, 'unknown_request'],
    [{ status: 'taken' }, { conversationId: 'agent-2' }, 'unknown_request'],
    [{ status: 'pending' }, {}, 'not_waiting'],
    [{ status: 'done' }, {}, 'not_waiting'],
    [{ status: 'taken' }, { image: Buffer.from('GIF89a' + 'x'.repeat(40)).toString('base64') }, 'invalid_image'],
    [{ status: 'taken' }, { image: 'A'.repeat(7 * 1024 * 1024) }, 'invalid_image']
  ];
  for (const [state, params, code] of cases) {
    const w = world();
    w.leave(state);
    const answer = w.api.result(Object.assign({ conversationId: 'agent-1', userId: 'gregoryv@convertigo.com', requestId: 'cap-1', status: 'done', image }, params), w.host);
    assert.equal(answer.error.code, code, JSON.stringify(params));
    assert.equal(w.written.length, 0);
  }
});

test('readResponse hands the requests to the panel and AgentHostRequestResult writes in the conversation attachments', () => {
  const client = fs.readFileSync(path.join(root, 'js/agent_bridge_client.js'), 'utf8');
  assert.match(client, /options = withCallerUserId\(options\);\n\s+var response = readResponseOf\(options\);[\s\S]{0,400}hostRequestsModule\(\)\.take\(threadid, options\.userId, hostRequestsHost\(\)\)/);
  assert.match(client, /C8O\.assistantAgentBridge\.hostRequestResult = function \(options\) \{\n\s+var refused = bridgeCallerRefusal\(\);[\s\S]{0,200}options = withCallerUserId\(options\);/);
  assert.match(client, /attachmentTargetDirectory\(\{ threadid: threadid, userId: options\.userId \}\)/, 'never a folder the page names');
  const sequence = fs.readFileSync(path.join(root, '_c8oProject/sequences/AgentHostRequestResult.yaml'), 'utf8');
  assert.match(sequence, /^accessibility: Hidden$/m);
  assert.match(sequence, /result = C8O\.assistantAgentBridge\.hostRequestResult\(\{/);
  assert.doesNotMatch(sequence, /^ *(comment|description): [^'|].*: /m, 'a value holding ": " is quoted');
  assert.match(fs.readFileSync(path.join(root, 'c8oProject.yaml'), 'utf8'), /↓AgentHostRequestResult \[sequences\.GenericSequence\]: 🗏 sequences\/AgentHostRequestResult\.yaml/);
});
