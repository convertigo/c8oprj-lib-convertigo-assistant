// An agent failure must read as a sentence, never as the bridge JSON envelope.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../js/agent_bridge_client.js'), 'utf8');
function grab(name) {
  const start = src.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1);
  }
}
const api = new Function('function trim(v){return String(v==null?"":v).replace(/^\\s+|\\s+$/g,"");}' +
  grab('extractAgentErrorText') + grab('condenseLlmBackendError') + 'return { extractAgentErrorText, condenseLlmBackendError };')();
const text = data => api.condenseLlmBackendError(api.extractAgentErrorText(data, 0));
const backend = "API error from convertigo (model: mistral/zai-glm-5-3): LLM backend error [convertigo]\n status: 400 Bad Request\n reason: Bad Request\n request_id: N/A\n endpoint: https://llm.convertigo.com/v1/chat/completions\n provider_message: litellm.BadRequestError: MistralException - {\"object\":\"error\",\"message\":\"reasoning_effort 'medium' is not supported for this model; supported values: ['low', 'high', 'max']\",\"type\":\"invalid_request_invalid_args\",\"param\":null,\"code\":\"3051\"}\n body_excerpt: {\"error\":{}}\n payload_summary: {\"model\":\"mistral/zai-glm-5-3\"}";

test('acp/response_error envelopes are unwrapped instead of being shown as JSON', () => {
  const shown = text({ id: 3, method: 'session/prompt', response: { jsonrpc: '2.0', id: 3, error: { code: -32603, message: backend } } });
  assert.doesNotMatch(shown, /jsonrpc|"method"|body_excerpt|payload_summary/);
  assert.match(shown, /^reasoning_effort 'medium' is not supported for this model; supported values: \['low', 'high', 'max'\]/);
  assert.match(shown, /\[mistral\/zai-glm-5-3, 400 Bad Request\]$/);
  assert.equal(text({ acpError: { code: -32000, message: 'Session closed' } }), 'Session closed');
});

test('other errors are left as they are, long backend dumps are shortened', () => {
  assert.equal(text({ message: 'Parent context stopped' }), 'Parent context stopped');
  assert.equal(text({ error: { message: 'Invalid API key' } }), 'Invalid API key');
  const generic = text('API error from convertigo (model: x): LLM backend error [convertigo]\n status: 503 Service Unavailable\n reason: upstream down\n endpoint: https://x\n body_excerpt: ' + 'y'.repeat(2000));
  assert.match(generic, /503 Service Unavailable/);
  assert.ok(generic.length < 450 && !/body_excerpt/.test(generic));
});
