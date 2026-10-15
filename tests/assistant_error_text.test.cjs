// An agent failure must read as a sentence, never as the bridge JSON envelope.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { backendParts } = require('./helpers/assistant-source.cjs');
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

const errors = {
  trim: value => String(value == null ? '' : value).trim(),
  normalizeProvider: value => String(value || '').toLowerCase()
};
vm.runInNewContext(backendParts([
  'lang', 'extractAgentErrorText', 'condenseLlmBackendError',
  'agentHttpErrorStatus', 'userFacingAgentError'
], ['TRANSLATIONS']), errors);
const show = (data, language = 'fr', provider = 'convertigo') =>
  errors.userFacingAgentError({ provider, language, model: 'mistral-large-4' }, data);

test('Convertigo model denials explain both key and user permissions without leaking the envelope', () => {
  const denied = { response: { error: {
    code: -31002, message: 'Invalid API key. Please check your API key and try again.',
    data: { httpStatus: 403, model: 'mistral/mistral-large-4', authorization: 'NEVER-EXPOSE-THIS' }
  } } };
  assert.match(show(denied), /mistral-large-4.*HTTP 403/);
  assert.match(show(denied), /sur la clé et sur son utilisateur LiteLLM/);
  assert.doesNotMatch(show(denied), /Invalid API key|NEVER-EXPOSE|jsonrpc/);
  assert.match(show(denied, 'en'), /both the key and its LiteLLM user/);
  assert.match(show({ error: { data: { reason: 'http_forbidden' } } }), /HTTP 403/);
  assert.match(show('user not allowed to access model. Tried to access mistral/mistral-large-4'), /HTTP 403/);
});

test('a Vibe error without HTTP details stays neutral about key validity', () => {
  // Current Vibe ACP maps the 403 to ConfigurationError and discards its details.
  const acp = { response: { error: { code: -31002,
    message: 'Invalid API key. Please check your API key and try again.' } } };
  const shown = show(acp);
  assert.match(shown, /validité de la clé.*sur la clé et sur son utilisateur/);
  assert.doesNotMatch(shown, /HTTP 401|HTTP 403|Invalid API key/);
  assert.equal(show(acp, 'fr', 'vibe'), acp.response.error.message);
  assert.equal(show(acp, 'en', 'codex'), acp.response.error.message);
});

test('a real 401 remains a credential rejection and unrelated errors keep their cause', () => {
  assert.match(show({ error: { message: 'Invalid API key', data: { httpStatus: 401 } } }), /clé d'API.*HTTP 401/);
  assert.doesNotMatch(show({ httpStatus: 401, message: 'Invalid API key' }), /modèles autorisés/);
  assert.equal(show({ message: 'Parent context stopped' }), 'Parent context stopped');
  assert.match(show(backend), /^reasoning_effort 'medium' is not supported/);
  assert.equal(errors.agentHttpErrorStatus(JSON.stringify({ error: { code: '403' } }), 0), 403);
});
