// The turn that follows the creation of a data application (by Flash or not) spent half its time finding where the data
// is: the turn context named no table, the guidance asked for a form read before any edit, and the agent searched the
// whole catalog page by page. The Assistant now names, in the context of each No Code turn, the tables the open
// application is bound to (from the forms_config of its Baserow sources, read once per form revision), and the
// guidance sends a data request straight to those ids.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, backendParts } = require('./helpers/assistant-source.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const config = (path, id) => ({ str: JSON.stringify({ table_id: path, table_id_int: id, editor: 'someone@example.invalid' }), html: false });
const DOC = {
  _id: 'app-1', _rev: '3-abc', name: 'Suivi des actions clients',
  formulaire: [
    { type: 'grid', sources: { 'lib_BaseRow.formssource_GetTableData': { vars: { forms_config: config('Team~>Suivi des actions clients~>Actions', 5721) } } } },
    { type: 'select', sources: { 'lib_BaseRow.formssource_GetTableData': { vars: { forms_config: config('Team~>Suivi des actions clients~>Clients', 5722) } } } }
  ],
  flows: [{ elements: [{ type: 'submit', actions: [{ vars: { forms_config: config('Team~>Suivi des actions clients~>Actions', 5721) } }] }] }]
};

function context(docs) {
  const reads = [];
  const ctx = {
    trim: value => String(value ?? '').trim(),
    firstOptionValue: (options, names) => { for (const n of names) { const v = String(options[n] ?? '').trim(); if (v.length) return v; } return ''; },
    callLocalSequence: (project, sequence, vars) => { reads.push(`${project}.${sequence}:${vars.id}`); return { doc: docs[vars.id] || null }; },
    sequencePayload: response => response,
    findNoCodeFormDocument: (payload, id) => payload.doc
  };
  vm.runInNewContext(backendParts(['noCodeFormBaserowTables', 'noCodeBoundTables']), ctx);
  return { ctx, reads };
}

test('the tables of an application come from the forms_config of its sources and saves, each once', () => {
  const { ctx } = context({});
  assert.deepEqual(plain(ctx.noCodeFormBaserowTables(DOC)), [
    { id: '5721', name: 'Actions', base: 'Suivi des actions clients' },
    { id: '5722', name: 'Clients', base: 'Suivi des actions clients' }
  ]);
  assert.deepEqual(plain(ctx.noCodeFormBaserowTables({ name: 'A questionnaire', formulaire: [{ type: 'text' }] })), []);
  // a forms_config written as an object, or holding only the id
  assert.deepEqual(plain(ctx.noCodeFormBaserowTables({ f: [{ forms_config: { table_id: '42' } }] })), [{ id: '42', name: '', base: '' }]);
});

test('the open application is read once per revision', () => {
  const { ctx, reads } = context({ 'app-1': DOC });
  const state = {};
  const first = ctx.noCodeBoundTables(state, { currentFormId: 'app-1', currentFormRevision: '3-abc' });
  assert.equal(first.length, 2);
  ctx.noCodeBoundTables(state, { currentFormId: 'app-1', currentFormRevision: '3-abc' });
  assert.deepEqual(reads, ['C8Oforms.APIV2_getDocument:app-1'], 'the same revision is not read again');
  ctx.noCodeBoundTables(state, { currentFormId: 'app-1', currentFormRevision: '4-def' });
  assert.equal(reads.length, 2, 'a new revision is');
  assert.deepEqual(plain(ctx.noCodeBoundTables(state, {})), [], 'no application open');
  assert.deepEqual(plain(context({}).ctx.noCodeBoundTables({}, { currentFormId: 'gone' })), [], 'an application that cannot be read');
});

test('the turn context names those tables, and a data request needs no form read nor catalog search', () => {
  const source = read('js/agent_bridge_client.js');
  assert.match(source, /if \(normalizeSkillProfile\(state\) === "nocode" && trim\(options\.currentFormId \|\| options\.nocodeCurrentFormId \|\| options\.formId \|\| options\.applicationId \|\| options\.currentApplicationId\)\.length\) \{\n\s*options\.nocodeBoundTables = noCodeBoundTables\(state, options\);\n\s*\}\n\s*\/\/ Known here, never from the page/);
  assert.match(source, /lines\.push\("- No Code database tables of the current application \(its Baserow bindings\): "/);
  assert.match(source, /editing it\. Reading or writing its data \(rows\) needs no form read\./);
  assert.match(source, /or the tables of the current application are listed above, treat them as the exact default data target and use their ids: no catalog search\./);
  assert.match(source, /its answer lists the rows it wrote, which is the proof: no read afterwards\./);
});
