const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const { ts, pageClass } = require("./helpers/assistant-source.cjs");
const ast = ts.createSourceFile(
  "page.ts",
  pageClass(),
  ts.ScriptTarget.Latest,
  true,
);
const names = [
  "tigoText",
  "requestTigoResources",
  "applyTigoResources",
  "filterTigoResources",
  "getTigoFavoriteSuggestions",
  "openTigoLibrary",
  "toggleTigoFavorite",
  "moveTigoFavorite",
  "toggleTigoResource",
  "useTigoPrompt",
  "editTigoResource",
  "loadTigoEditorLanguage",
  "saveTigoResource",
  "removeTigoResource",
  "saveTigoSecret",
  "onTigoResourcesAccordionChange",
];
const methods = ast.statements[0].members.filter(
  (m) => m.name && names.includes(m.name.getText(ast)),
);
assert.equal(methods.length, names.length);
const code = ts.transpileModule(
  "class Page { " +
    methods.map((m) => m.getText(ast)).join("\n") +
    " };this.Page=Page;",
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;
function fixture() {
  const s = { setTimeout() {} };
  vm.runInNewContext(code, s);
  const page = new s.Page(),
    events = [];
  Object.assign(page, {
    local: {},
    translate: { currentLang: "fr" },
    tick() {},
    isAgentBridgeMode: () => true,
    getAgentContextUserId: () => "studio",
    getEffectiveProjectName: () => "Demo",
    getDefaultFooterSuggestions: () => [],
    openAgentSettingsPage() {},
    closeAgentSettingsPage() {
      page.closed = true;
    },
    events: { publish: (topic, payload) => events.push({ topic, payload }) },
  });
  return { page, events };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const item = {
  key: "builtin::prompt:explain-project",
  id: "explain-project",
  kind: "prompt",
  scope: "builtin",
  readOnly: true,
  revision: "r1",
  title: "Expliquer",
  description: "Description",
  body: "Explique ce projet.",
  favorite: true,
  data: {
    schemaVersion: 1,
    id: "explain-project",
    defaultLanguage: "en",
    translations: {
      en: { title: "Explain", description: "Original", body: "English body" },
      fr: {
        title: "Expliquer",
        description: "Description",
        body: "Explique ce projet.",
      },
    },
  },
};
test("catalog responses honor identity/conversation, expose ordered favorites and filter provenance", () => {
  const f = fixture();
  f.page.requestTigoResources();
  const request = f.events[0].payload;
  f.page.applyTigoResources(
    {
      response: {
        ok: true,
        items: [item],
        favorites: [item.key],
        projects: ["Demo"],
        selection: { skills: [], mcp: [] },
      },
    },
    request,
  );
  assert.equal(f.page.local.ResourcePromptItems.length, 1);
  assert.equal(f.page.getTigoFavoriteSuggestions()[0].question, item.body);
  f.page.local.ResourceScopeFilter = "workspace";
  f.page.filterTigoResources();
  assert.equal(f.page.local.ResourcePromptItems.length, 0);
  f.page.local.Conversation = "other";
  f.page.applyTigoResources({ response: { ok: true, items: [] } }, request);
  assert.equal(
    f.events.length,
    2,
    "stale result causes a fresh conversation-scoped read",
  );
});
test("duplicating built-ins keeps the original translations and produces an editable personal resource", () => {
  const f = fixture();
  f.page.local.ResourceProjectOptions = ["Demo"];
  f.page.editTigoResource(item, "prompt", true);
  assert.equal(f.page.local.ResourceEditorReadonly, false);
  assert.equal(f.page.local.ResourceEditScope, "workspace");
  assert.notEqual(f.page.local.ResourceEditor.id, item.id);
  f.page.local.ResourceEditBody = "French edited";
  f.page.saveTigoResource();
  const payload = f.events[0].payload.request;
  assert.equal(payload.action, "save");
  assert.equal(payload.input.translations.en.body, "English body");
  assert.equal(payload.input.translations.fr.body, "French edited");
  assert.equal(item.data.translations.fr.body, "Explique ce projet.");
});
test("using a prompt only publishes draft insertion and never sends an agent request", () => {
  const f = fixture();
  f.page.useTigoPrompt(item);
  assert.deepEqual(plain(f.events), [
    { topic: "TigoPromptInsert", payload: { text: item.body } },
  ]);
  assert.equal(f.page.closed, true);
});
test("failure clears pending state and secret input is cleared immediately", () => {
  const f = fixture();
  f.page.requestTigoResources();
  const req = f.events[0].payload;
  f.page.applyTigoResources(
    { response: { ok: false, error: { code: "revision_conflict" } } },
    req,
  );
  assert.equal(f.page.local.ResourceLoading, false);
  assert.match(f.page.local.ResourceError, /modifiée/);
  f.page.local.ResourceSecretName = "COMPANY_KEY";
  f.page.local.ResourceSecretValue = "PRIVATE";
  f.page.saveTigoSecret();
  assert.equal(f.page.local.ResourceSecretValue, "");
  assert.equal(f.events[1].payload.request.input.name, "COMPANY_KEY");
});
test("mutations carry the session CSRF token and changed MCP declarations are re-approved explicitly", () => {
  const f = fixture();
  f.page.local.ResourceCatalog = {
    csrf: "session-token",
    selection: { skills: [], mcp: ["workspace::mcp:server"] },
  };
  f.page.toggleTigoResource({
    key: "workspace::mcp:server",
    kind: "mcp",
    requiresReview: true,
  });
  const request = f.events[0].payload.request;
  assert.equal(request.csrf, "session-token");
  assert.equal(request.input.reviewKey, "workspace::mcp:server");
  assert.deepEqual(plain(request.input.mcp), ["workspace::mcp:server"]);
});

test("nested Ionic selection changes keep the configuration category open", () => {
  const {page}=fixture();page.local.ResourceAccordion='agent';
  page.onTigoResourcesAccordionChange({target:{tagName:'ION-SELECT'},detail:{value:'claude'}});
  assert.equal(page.local.ResourceAccordion,'agent');
  page.onTigoResourcesAccordionChange({target:{tagName:'ION-ACCORDION-GROUP'},detail:{value:'skills'}});
  assert.equal(page.local.ResourceAccordion,'skills');
});
test("favorites follow the current language immediately, including the inserted prompt body", () => {
  const {page}=fixture();page.local.ResourceCatalog={items:[item],favorites:[item.key]};
  assert.equal(page.getTigoFavoriteSuggestions()[0].question,'Explique ce projet.');
  page.translate.currentLang='en-US';const en=page.getTigoFavoriteSuggestions()[0];assert.equal(en.label,'Explain');assert.equal(en.question,'English body');
  page.translate.currentLang='es';assert.equal(page.getTigoFavoriteSuggestions()[0].question,'English body');
});

test("library rows and search use the selected translation without modifying the catalog", () => {
  const {page} = fixture();
  page.local.ResourceCatalog = {items:[item], projects:[], favorites:[item.key]};
  page.filterTigoResources();
  assert.equal(page.local.ResourcePromptItems[0].title, "Expliquer");
  page.translate.currentLang = "en";
  page.local.ResourceSearch = "Original";
  page.filterTigoResources();
  assert.equal(page.local.ResourcePromptItems.length, 1);
  assert.equal(page.local.ResourcePromptItems[0].title, "Explain");
  assert.equal(page.local.ResourcePromptItems[0].body, "English body");
  assert.equal(item.title, "Expliquer");
});
