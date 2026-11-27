const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const source = fs.readFileSync(
  path.join(__dirname, "../js/tigo_resources.js"),
  "utf8",
);
const sandbox = {};
vm.runInNewContext(source, sandbox);
const lib = sandbox.C8O.tigoResources;
const plain = (v) => JSON.parse(JSON.stringify(v));
function fixture(admin = true, user = "studio", files = new Map()) {
  const host = {
    identity: () => ({ admin, user, key: user, owner: lib.conversationOwner(user) }),
    personal: (k) => "users/" + k,
    builtins: () => "builtin",
    projects: () => ({ Demo: "project/Demo" }),
    hash: (v) => crypto.createHash("sha256").update(v).digest("hex"),
    now: () => 1,
    read: (base, rel) => files.get(base + "/" + rel) ?? null,
    write: (base, rel, v) => files.set(base + "/" + rel, v),
    remove: (base, rel) => files.delete(base + "/" + rel),
    list: (base, rel) => [
      ...new Set(
        [...files.keys()]
          .filter((k) => k.startsWith(base + "/" + rel + "/"))
          .map((k) => k.slice((base + "/" + rel + "/").length).split("/")[0]),
      ),
    ],
    files: (base, rel) => {
      const prefix = base + "/" + rel + "/";
      return [...files.keys()].filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((name) => /^(references|scripts|assets)\//.test(name)).sort();
    },
    lock: (_base, f) => f(),
    protectProject: (p) => files.set("protected/" + p, "true"),
    secretNames: (base) =>
      Object.keys(JSON.parse(files.get(base + "/secrets.json") || "{}")),
    readSecrets: (base) =>
      JSON.parse(files.get(base + "/secrets.json") || "{}"),
    secret: (base, k, v) => {
      const s = host.readSecrets(base);
      s[k] = v;
      host.write(base, "secrets.json", JSON.stringify(s));
    },
  };
  return { api: lib.create(host), files, host };
}
function data(id = "example", kind = "prompt") {
  return {
    schemaVersion: 1,
    id,
    defaultLanguage: "en",
    translations: {
      en: {
        title: "Example",
        description: "Description",
        body:
          kind === "skill"
            ? "---\nname: example\ndescription: Example skill\n---\nRead references/data.md."
            : "English prompt",
      },
      fr: {
        title: "Exemple",
        description: "Description française",
        body:
          kind === "skill"
            ? "---\nname: example\ndescription: Méthode\n---\nLire references/data.md."
            : "Prompt français",
      },
    },
  };
}
function save(f, kind, value, scope = "workspace", revision = "") {
  return f.api.execute({
    action: "save",
    kind,
    scope,
    project: "Demo",
    revision,
    input: value,
  }).item;
}
test("project and workspace prompts retain translations and use optimistic revisions", () => {
  const f = fixture();
  let p = save(f, "prompt", data(), "project");
  assert.equal(f.files.get("protected/Demo"), "true");
  assert.equal(
    f.api.execute({ action: "list", language: "fr-CA" }).items[0].body,
    "Prompt français",
  );
  const updated = data();
  updated.translations.fr.body = "Révisé";
  const next = save(f, "prompt", updated, "project", p.revision);
  assert.notEqual(next.revision, p.revision);
  assert.throws(
    () => save(f, "prompt", data(), "project", p.revision),
    /revision_conflict/,
  );
  assert.throws(
    () => save(f, "prompt", data(), "project"),
    /revision_conflict/,
  );
});
test("built-ins cannot be edited or removed but can be duplicated", () => {
  const f = fixture();
  const d = data();
  f.files.set("builtin/prompts/example/prompt.json", JSON.stringify(d));
  f.files.set("builtin/prompts/example/prompt.en.md", "Built-in");
  f.files.set("builtin/prompts/example/prompt.fr.md", "Livré");
  const list = f.api.execute({ action: "list", language: "fr" });
  assert.equal(list.items[0].readOnly, true);
  assert.deepEqual(plain(list.favorites), ["builtin::prompt:example"]);
  assert.throws(
    () =>
      f.api.execute({
        action: "delete",
        key: list.items[0].key,
        revision: list.items[0].revision,
      }),
    /builtin_read_only/,
  );
  const copy = f.api.execute({
    action: "duplicate",
    key: list.items[0].key,
    scope: "workspace",
    input: { id: "my-copy" },
  }).item;
  assert.equal(copy.readOnly, false);
  assert.equal(copy.data.translations.fr.body, "Livré");
});
test("favorites are ordered per user and do not rewrite shared resource files", () => {
  const f = fixture();
  const p = save(f, "prompt", data(), "project"),
    q = save(f, "prompt", data("other"), "project");
  const before = f.files.get("project/Demo/prompts/example/prompt.json");
  f.api.execute({ action: "favorites", input: { favorites: [q.key, p.key] } });
  assert.deepEqual(plain(f.api.execute({ action: "list" }).favorites), [
    q.key,
    p.key,
  ]);
  assert.equal(f.files.get("project/Demo/prompts/example/prompt.json"), before);
  const another = fixture(true, "another", f.files);
  assert.deepEqual(
    plain(another.api.execute({ action: "list" }).favorites),
    [],
  );
});
test("skill contents are injected once per revision and session, disabled skills leave history untouched", () => {
  const f = fixture();
  let s = save(f, "skill", data("example", "skill"));
  f.api.execute({
    action: "select",
    threadid: "conversation",
    input: { skills: [s.key], mcp: [] },
  });
  const state = {
    threadid: "conversation",
    provider: "codex",
    externalSessionId: "s1",
    language: "fr",
  };
  let turn = f.api.prepare(state);
  assert.match(turn.text, /Lire references/);
  state.resourceSkillVersions = turn.versions;
  state.resourceContextEpoch = "codex:s1";
  assert.equal(f.api.prepare(state).text, "");
  state.externalSessionId = "s2";
  assert.match(f.api.prepare(state).text, /Custom skill/);
  state.resourceContextEpoch = "codex:s2";
  const changed = data("example", "skill");
  changed.translations.fr.body += "\nUpdated";
  s = save(f, "skill", changed, "workspace", s.revision);
  assert.match(f.api.prepare(state).text, /Updated/);
  f.api.execute({
    action: "select",
    threadid: "conversation",
    input: { skills: [], mcp: [], off: [s.key] },
  });
  assert.equal(f.api.prepare(state).text, "");
  assert.ok(state.resourceSkillVersions);
});
test("standard SKILL.md folders are discovered without a Tigo manifest", () => {
  const f = fixture();
  f.files.set(
    "project/Demo/skills/example/SKILL.md",
    data("example", "skill").translations.en.body,
  );
  const item = f.api.execute({ action: "list" }).items[0];
  assert.equal(item.kind, "skill");
  assert.equal(item.data.defaultLanguage, "en");
});
test("MCP secrets never enter project manifests or public catalog, and missing secrets fail closed", () => {
  const f = fixture();
  const d = data("data-api");
  d.connection = {
    transport: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: { env: "COMPANY_API_KEY", prefix: "Bearer " } },
  };
  let m = save(f, "mcp", d, "project");
  f.api.execute({
    action: "select",
    threadid: "conversation",
    input: { skills: [], mcp: [m.key] },
  });
  const state = {
    threadid: "conversation",
    provider: "claude",
    externalSessionId: "s1",
  };
  assert.throws(() => f.api.prepare(state), /mcp_secret_missing/);
  f.api.execute({
    action: "secret",
    input: { name: "COMPANY_API_KEY", value: "private-value" },
  });
  const turn = f.api.prepare(state);
  assert.equal(turn.connections[0].envValues.COMPANY_API_KEY, "private-value");
  assert.doesNotMatch(
    JSON.stringify(f.api.execute({ action: "list" })),
    /private-value/,
  );
  assert.doesNotMatch(f.files.get("project/Demo/mcp.json"), /private-value/);
});
test("skills requiring an unselected MCP fail before prompting", () => {
  const f = fixture(),
    d = data("example", "skill");
  d.requiresMcp = ["project:Demo:mcp:data-api"];
  const s = save(f, "skill", d);
  f.api.execute({ action: "select", input: { skills: [s.key], mcp: [] } });
  assert.throws(
    () => f.api.prepare({ threadid: "new", provider: "codex" }),
    /skill_mcp_dependency_missing/,
  );
});
test("untrusted identities cannot enumerate projects, activate MCP or read another user selection", () => {
  const f = fixture(false, "alice");
  assert.deepEqual(plain(f.api.execute({ action: "list" }).projects), []);
  assert.throws(
    () => save(f, "prompt", data(), "project"),
    /project_access_denied/,
  );
  assert.throws(
    () =>
      f.api.execute({ action: "secret", input: { name: "KEY", value: "x" } }),
    /secret_admin_required/,
  );
  assert.throws(
    () => f.api.prepare({ threadid: "x", userId: "bob" }),
    /conversation_access_denied/,
  );
});
test("a server user owns the conversations keyed by the email C8Oforms gives the page", () => {
  assert.equal(
    lib.conversationOwner("google:108792390496318778325:alice@example.com"),
    "alice@example.com",
  );
  assert.equal(lib.conversationOwner("alice@example.com"), "alice@example.com");
  assert.equal(lib.conversationOwner("c8o:admin"), "c8o:admin");
  assert.equal(lib.conversationOwner("a:b:not-an-email"), "a:b:not-an-email");
  const f = fixture(false, "google:108792390496318778325:alice@example.com");
  assert.equal(
    f.api.prepare({ threadid: "x", userId: "alice@example.com" }).text,
    "",
  );
  assert.throws(
    () => f.api.prepare({ threadid: "x", userId: "bob@example.com" }),
    /conversation_access_denied/,
  );
  assert.throws(
    () =>
      f.api.prepare({
        threadid: "x",
        userId: "google:108792390496318778325:alice@example.com",
      }),
    /conversation_access_denied/,
  );
});
test("invalid ids, schema, secrets in declarations and unsafe URLs are rejected", () => {
  for (const bad of ["../other", "A", "x/y", "__proto__"]) {
    assert.throws(() => lib.normalize("prompt", data(bad)), /invalid_id/);
  }
  const d = data();
  d.schemaVersion = 2;
  assert.throws(() => lib.normalize("prompt", d), /unsupported_schema/);
  const m = data("data-api");
  m.connection = {
    transport: "http",
    url: "https://user:password@example.com/mcp",
  };
  assert.throws(
    () => lib.normalize("mcp", m),
    /mcp_https_or_loopback_required/,
  );
  m.connection.url = "https://example.com/mcp?api_key=secret";
  assert.throws(() => lib.normalize("mcp", m), /mcp_url_credentials_forbidden/);
  m.connection = {
    transport: "stdio",
    command: "node",
    args: ["--token", "literal"],
  };
  assert.throws(
    () => lib.normalize("mcp", m),
    /mcp_arguments_credentials_forbidden/,
  );
  m.connection = {
    transport: "http",
    url: "http://127.0.0.1:8080/mcp",
    headers: { Authorization: "Bearer literal" },
  };
  assert.throws(() => lib.normalize("mcp", m), /invalid_object/);
});
test("deletion preserves a recoverable copy and removes standard skill discovery", () => {
  const f = fixture(),
    s = save(f, "skill", data("example", "skill"));
  f.api.execute({ action: "delete", key: s.key, revision: s.revision });
  assert.equal(f.api.execute({ action: "list" }).items.length, 0);
  assert.ok([...f.files.keys()].some((k) => k.includes("/.trash/")));
});
test("changed active MCP declarations require explicit review before the next turn", () => {
  const f = fixture(),
    d = data("server");
  d.connection = { transport: "stdio", command: "node", args: ["server.js"] };
  let item = save(f, "mcp", d);
  f.api.execute({
    action: "select",
    threadid: "review",
    input: { skills: [], mcp: [item.key] },
  });
  const state = { threadid: "review", provider: "codex" };
  assert.equal(f.api.prepare(state).connections.length, 1);
  d.connection.args = ["changed.js"];
  item = save(f, "mcp", d, "workspace", item.revision);
  assert.equal(
    f.api.execute({ action: "list", threadid: "review" }).items[0]
      .requiresReview,
    true,
  );
  assert.throws(() => f.api.prepare(state), /mcp_changed_requires_review/);
  f.api.execute({
    action: "select",
    threadid: "review",
    input: { skills: [], mcp: [item.key] },
  });
  assert.throws(
    () => f.api.prepare(state),
    /mcp_changed_requires_review/,
    "unrelated selection saves do not approve changed declarations",
  );
  f.api.execute({
    action: "select",
    threadid: "review",
    input: { skills: [], mcp: [item.key], reviewKey: item.key },
  });
  assert.equal(f.api.prepare(state).connections[0].args[0], "changed.js");
});
test("deleted favorites are omitted and unavailable active selections can be removed", () => {
  const f = fixture(),
    p = save(f, "prompt", data()),
    s = save(f, "skill", data("method", "skill"));
  f.api.execute({ action: "favorites", input: { favorites: [p.key] } });
  f.api.execute({ action: "select", input: { skills: [s.key], mcp: [] } });
  for (const item of [p, s])
    f.api.execute({ action: "delete", key: item.key, revision: item.revision });
  const catalog = f.api.execute({ action: "list" });
  assert.deepEqual(plain(catalog.favorites), []);
  assert.deepEqual(plain(catalog.missingSelections), [s.key]);
  f.api.execute({ action: "favorites", input: { favorites: [] } });
  f.api.execute({ action: "select", input: { skills: [], mcp: [] } });
  assert.deepEqual(
    plain(f.api.execute({ action: "list" }).missingSelections),
    [],
  );
});
test("skill support files affect revisions and are copied byte-for-byte with duplicated metadata", () => {
  const f = fixture();
  f.host.files = (base, rel) =>
    [...f.files.keys()]
      .filter((k) => k.startsWith(base + "/" + rel + "/references/"))
      .map((k) => k.slice((base + "/" + rel + "/").length));
  f.host.fileHash = (base, rel) =>
    crypto
      .createHash("sha256")
      .update(f.files.get(base + "/" + rel))
      .digest("hex");
  f.host.copy = (base, rel, dest, target) =>
    f.files.set(dest + "/" + target, f.files.get(base + "/" + rel));
  let skill = save(f, "skill", data("method", "skill"));
  const bytes = Buffer.from([0xff, 0x00, 0x80, 0x23]);
  f.files.set("users/studio/skills/method/references/file.bin", bytes);
  const changed = f.api.execute({ action: "get", key: skill.key }).item;
  assert.notEqual(changed.revision, skill.revision);
  const value = plain(changed.data);
  value.id = "method-copy";
  const copied = f.api.execute({
    action: "save",
    kind: "skill",
    scope: "workspace",
    input: value,
    copyFromKey: skill.key,
    copyFromRevision: changed.revision,
  }).item;
  assert.deepEqual(
    f.files.get("users/studio/skills/method-copy/references/file.bin"),
    bytes,
  );
  assert.notEqual(copied.key, changed.key);
  assert.throws(
    () =>
      f.api.execute({
        action: "save",
        kind: "skill",
        scope: "workspace",
        input: { ...value, id: "stale-copy" },
        copyFromKey: skill.key,
        copyFromRevision: skill.revision,
      }),
    /revision_conflict/,
  );
});
test("Studio and NoCode built-ins are scoped to their surface with language fallback", () => {
  const f = fixture(),
    d = data();
  d.surfaces = ["nocode"];
  f.files.set("builtin/prompts/example/prompt.json", JSON.stringify(d));
  f.files.set("builtin/prompts/example/prompt.en.md", "NoCode prompt");
  assert.equal(f.api.execute({ action: "list" }).items.length, 0);
  f.host.identity = () => ({
    admin: false,
    user: "form-user",
    owner: "form-user",
    key: "form-user",
    surface: "nocode",
  });
  const api = lib.create(f.host),
    catalog = api.execute({ action: "list", language: "es" });
  assert.equal(catalog.items[0].body, "NoCode prompt");
  assert.equal(catalog.favorites.length, 1);
});

function studioProposalFixture() {
  const f = fixture();
  f.host.identity = () => ({admin:true,studio:true,surface:'studio',user:'studio',owner:'studio',key:'studio'});
  f.api = lib.create(f.host);
  return f;
}
function connectionData(id='connection') {
  return {...data(id),connection:{transport:'http',url:'https://example.invalid/mcp',env:['COMPANY_TOKEN'],headers:{}}};
}
function proposeConnection(f,scope='workspace') {
  f.host.agentInitiated=true;
  return f.api.execute({action:'save',kind:'mcp',scope,project:'Demo',input:connectionData()});
}
test('agent MCP saves only propose; human approval adds without enabling',()=>{
  const f=studioProposalFixture(),p=proposeConnection(f);
  assert.equal(p.approvalRequired,true);
  assert.equal(f.files.has('users/studio/mcp.json'),false);
  const before=f.api.execute({action:'list'});assert.equal(before.items.length,0);assert.equal(before.proposals.length,1);
  const proposal=before.proposals[0];
  assert.throws(()=>f.api.execute({action:'confirmProposal',confirmed:true,input:{id:proposal.id,digest:proposal.digest}}),/human_review_required/);
  f.host.agentInitiated=false;
  const result=f.api.execute({action:'confirmProposal',input:{id:proposal.id,digest:proposal.digest}});
  assert.equal(result.item.scope,'workspace');assert.equal(f.api.execute({action:'list'}).selection.mcp.length,0);
  assert.equal(f.api.execute({action:'list'}).proposals.length,0);
});
test('proposal digest, expiry, revision and rejection fail closed',()=>{
  for(const mode of ['digest','expiry','revision','tamper','reject']) {
    const f=studioProposalFixture();proposeConnection(f,'project');let p=f.api.execute({action:'list'}).proposals[0];f.host.agentInitiated=false;
    if(mode==='digest')p.digest='wrong';
    if(mode==='expiry')f.host.now=()=>10000000;
    if(mode==='revision')f.api.execute({action:'save',kind:'mcp',scope:'project',project:'Demo',input:connectionData()});
    if(mode==='tamper'){const d=JSON.parse(f.files.get('users/studio/mcp-proposals.json'));d.items[0].data.connection.url='https://changed.invalid/mcp';f.files.set('users/studio/mcp-proposals.json',JSON.stringify(d));}
    if(mode==='reject') {f.api.execute({action:'rejectProposal',input:{id:p.id,digest:p.digest}});assert.equal(f.files.has('project/Demo/mcp.json'),false);continue;}
    assert.throws(()=>f.api.execute({action:'confirmProposal',input:{id:p.id,digest:p.digest}}),/proposal_expired_or_changed|revision_conflict/);
  }
});
test('No Code and non-Studio hosts cannot propose; personal approval stays with its owner',()=>{
  const f=fixture();f.host.agentInitiated=true;
  assert.throws(()=>proposeConnection(f),/studio_configuration_required/);
  const owner=studioProposalFixture();proposeConnection(owner);
  owner.host.identity=()=>({admin:true,studio:true,user:'other',key:'other',owner:'other'});
  assert.equal(lib.create(owner.host).execute({action:'list'}).proposals.length,0);
});
test('agent proposals reject literal credentials and remain idempotent',()=>{
  const f=studioProposalFixture();proposeConnection(f);proposeConnection(f);
  assert.equal(f.api.execute({action:'list'}).proposals.length,1);
  const v=connectionData();v.connection.url='https://user:password@example.invalid/mcp';
  assert.throws(()=>f.api.execute({action:'save',kind:'mcp',scope:'workspace',input:v}),/mcp_url_credentials_forbidden|mcp_https_or_loopback_required/);
});
test('Fast POC and Security check ship bilingual and only to Studio',()=>{
  const f=studioProposalFixture();
  for(const id of ['fast-poc','security-check']) {
    const base=path.join(__dirname,'../.tigo/prompts',id),meta=JSON.parse(fs.readFileSync(path.join(base,'prompt.json'),'utf8'));
    assert.deepEqual(meta.surfaces,['studio']);
    for(const name of ['prompt.json','prompt.en.md','prompt.fr.md'])f.files.set('builtin/prompts/'+id+'/'+name,fs.readFileSync(path.join(base,name),'utf8'));
  }
  for(const language of ['en','fr'])assert.equal(f.api.execute({action:'list',language}).items.length,2);
  f.host.identity=()=>({admin:false,surface:'nocode',user:'person',key:'person',owner:'person'});
  assert.equal(lib.create(f.host).execute({action:'list'}).items.length,0);
});

test("an agent cannot duplicate a connection by disguising its requested kind", () => {
  const f=fixture();f.host.identity=()=>({admin:true,studio:true,key:"studio",owner:"studio"});
  const value=data("original");value.connection={transport:"http",url:"https://docs.example.com/mcp",env:[],headers:{}};
  const original=save(f,"mcp",value);
  f.host.agentInitiated=true;const agent=lib.create(f.host);
  assert.throws(()=>agent.execute({action:"duplicate",kind:"prompt",scope:"workspace",key:original.key,input:{id:"hidden-copy"}}),/human_review_required/);
  assert.equal(f.files.get("users/studio/mcp.json").includes("hidden-copy"),false);
});
function projectSkill(f, project, id, body) {
  f.files.set(
    "project/" + project + "/skills/" + id + "/SKILL.md",
    "---\nname: " + id + "\ndescription: Rules of " + id + "\n---\n" + (body || "Follow " + id + "."),
  );
  return "project:" + project + ":skill:" + id;
}
function withProjects(f) {
  f.host.projects = () => ({ Demo: "project/Demo", Other: "project/Other" });
  return f;
}
test("the skills of the conversation's project apply by default, read from disk without a library reload", () => {
  const f = withProjects(fixture());
  const state = { threadid: "c1", provider: "codex", externalSessionId: "s1", projectId: "Demo" };
  assert.equal(f.api.prepare(state).text, "", "no skill yet");
  const key = projectSkill(f, "Demo", "page-rules", "Duplicate the template page.");
  const turn = f.api.prepare(state);
  assert.match(turn.text, /Duplicate the template page/);
  assert.deepEqual(plain(turn.applied.map((x) => [x.key, x.auto, x.sent])), [[key, true, true]]);
  const catalog = f.api.execute({ action: "list", threadid: "c1", contextProject: "Demo" });
  const item = catalog.items.find((x) => x.key === key);
  assert.equal(item.enabled, true);
  assert.equal(item.auto, true);
  assert.deepEqual(plain(catalog.autoSkills), [key]);
  assert.equal(catalog.contextProject, "Demo");
  assert.deepEqual(plain(catalog.missingSelections), []);
});
test("a project skill turned off stays off for that conversation only", () => {
  const f = withProjects(fixture());
  const key = projectSkill(f, "Demo", "page-rules");
  f.api.execute({ action: "select", threadid: "c1", input: { skills: [], mcp: [], off: [key] } });
  const state = { threadid: "c1", provider: "codex", externalSessionId: "s1", projectId: "Demo" };
  assert.equal(f.api.prepare(state).text, "");
  assert.equal(
    f.api.execute({ action: "list", threadid: "c1", contextProject: "Demo" }).items.find((x) => x.key === key).enabled,
    false,
  );
  assert.match(f.api.prepare({ threadid: "c2", provider: "codex", projectId: "Demo" }).text, /Follow page-rules/);
  f.api.execute({ action: "select", threadid: "c1", input: { skills: [], mcp: [], off: [] } });
  assert.match(f.api.prepare(state).text, /Follow page-rules/);
  assert.throws(
    () => f.api.execute({ action: "select", threadid: "c1", input: { skills: [], mcp: [], off: ["builtin::skill:x"] } }),
    /invalid_selection/,
  );
});
test("changing the conversation's project swaps its default skills instead of blocking", () => {
  const f = withProjects(fixture());
  const demo = projectSkill(f, "Demo", "page-rules"),
    other = projectSkill(f, "Other", "naming");
  const state = { threadid: "c1", provider: "codex", externalSessionId: "s1", projectId: "Demo" };
  let turn = f.api.prepare(state);
  state.resourceSkillVersions = turn.versions;
  state.resourceContextEpoch = "codex:s1";
  state.projectId = "Other";
  turn = f.api.prepare(state);
  assert.match(turn.text, /Follow naming/);
  assert.doesNotMatch(turn.text, /page-rules/);
  assert.deepEqual(Object.keys(turn.versions), [other]);
  assert.deepEqual(plain(turn.skipped), []);
  const catalog = f.api.execute({ action: "list", threadid: "c1", contextProject: "Other" });
  assert.equal(catalog.items.find((x) => x.key === demo).enabled, false);
  assert.equal(catalog.items.find((x) => x.key === other).enabled, true);
});
test("a missing skill is skipped and reported, never blocking the message", () => {
  const f = withProjects(fixture());
  const key = projectSkill(f, "Demo", "page-rules");
  f.api.execute({ action: "select", threadid: "c1", input: { skills: [key], mcp: [] } });
  f.host.projects = () => ({ Other: "project/Other" });
  const turn = f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Other" });
  assert.equal(turn.text, "");
  assert.deepEqual(plain(turn.skipped.map((x) => [x.key, x.title])), [[key, "page-rules"]]);
  assert.equal(turn.skipped[0].reason, "unknown_project");
  assert.deepEqual(plain(f.api.execute({ action: "list", threadid: "c1", contextProject: "Other" }).missingSelections), [key]);
  const w = save(f, "skill", data("method", "skill"));
  f.api.execute({ action: "select", threadid: "c1", input: { skills: [key, w.key], mcp: [] } });
  assert.match(f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Other" }).text, /Read references/);
});
test("a new conversation takes the draft choices once; the next one starts from the skills on by default", () => {
  const f = withProjects(fixture());
  const auto = projectSkill(f, "Demo", "page-rules"),
    other = projectSkill(f, "Other", "naming");
  f.api.execute({ action: "select", input: { skills: [other], mcp: [], off: [auto] } });
  const first = f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo", language: "en" });
  assert.match(first.text, /Follow naming/);
  assert.doesNotMatch(first.text, /page-rules/);
  assert.deepEqual(plain(f.api.execute({ action: "list" }).selection), { skills: [], mcp: [], mcpRevisions: {}, off: [] });
  const second = f.api.prepare({ threadid: "c2", provider: "codex", projectId: "Demo", language: "en" });
  assert.match(second.text, /Follow page-rules/);
  assert.doesNotMatch(second.text, /Follow naming/);
  assert.match(f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo", language: "en" }).text, /Follow naming/);
});
test("personal skills made in the panel are on by default in every conversation of their owner, until set otherwise", () => {
  const f = withProjects(fixture());
  const d = data("custom-mw0fsptm", "skill");
  d.translations.en.body = "---\nname: \"custom-mw0fsptm\"\ndescription: \"Page templates\"\n---\nDuplicate the template page.";
  delete d.translations.fr;
  const s = save(f, "skill", d);
  for (const projectId of ["Demo", "Other", ""]) {
    const turn = f.api.prepare({ threadid: "t-" + projectId, provider: "convertigo", projectId, language: "fr" });
    assert.match(turn.text, /Duplicate the template page/, "on by default with project " + JSON.stringify(projectId));
    assert.deepEqual(plain(turn.applied.map((x) => [x.key, x.auto])), [[s.key, true]]);
  }
  let row = f.api.execute({ action: "list", threadid: "t-new", contextProject: "Demo" }).items.find((x) => x.key === s.key);
  assert.equal(row.enabled, true);
  assert.equal(row.defaultable, true);
  assert.equal(row.auto, true);
  f.api.execute({ action: "favorites", input: { favorites: [] } });
  f.api.execute({ action: "skillDefault", key: s.key, input: { enabled: false } });
  assert.deepEqual(plain(JSON.parse(f.files.get("users/studio/preferences.json"))), { schemaVersion: 1, favorites: [], notDefault: [s.key], skillApprovals: {} });
  assert.equal(f.api.prepare({ threadid: "t-after", provider: "convertigo", projectId: "Demo" }).text, "");
  row = f.api.execute({ action: "list", threadid: "t-new", contextProject: "Demo" }).items.find((x) => x.key === s.key);
  assert.deepEqual([row.enabled, row.defaultable, row.auto], [false, true, false]);
  f.api.execute({ action: "select", threadid: "t-hand", input: { skills: [s.key], mcp: [] } });
  assert.match(f.api.prepare({ threadid: "t-hand", provider: "convertigo" }).text, /Duplicate the template page/, "still on by hand");
  f.api.execute({ action: "favorites", input: { favorites: [] } });
  assert.deepEqual(plain(JSON.parse(f.files.get("users/studio/preferences.json")).notDefault), [s.key], "favorites keep the setting");
  f.api.execute({ action: "skillDefault", key: s.key, input: { enabled: true } });
  assert.match(f.api.prepare({ threadid: "t-back", provider: "convertigo" }).text, /Duplicate the template page/);
  f.api.execute({ action: "select", threadid: "t-off", input: { skills: [], mcp: [], off: [s.key] } });
  assert.equal(f.api.prepare({ threadid: "t-off", provider: "convertigo" }).text, "", "off for one conversation");
  assert.throws(() => f.api.execute({ action: "skillDefault", key: "workspace::prompt:x", input: { enabled: false } }), /resource_missing|not_a_skill/);
});
test("a No Code user's personal skills are on by default; project skills are not visible", () => {
  const f = withProjects(fixture(false, "alice"));
  projectSkill(f, "Demo", "page-rules");
  const s = save(f, "skill", data("method", "skill"));
  const turn = f.api.prepare({ threadid: "c1", provider: "convertigo", projectId: "Demo", userId: lib.conversationOwner("alice"), language: "en" });
  assert.match(turn.text, /Read references/);
  assert.doesNotMatch(turn.text, /page-rules/);
  assert.deepEqual(plain(turn.applied.map((x) => x.key)), [s.key]);
});
test("a default project skill needing an MCP connection that is off is skipped, not blocking", () => {
  const f = withProjects(fixture());
  const d = data("needs-api", "skill");
  d.requiresMcp = ["project:Demo:mcp:data-api"];
  const s = save(f, "skill", d, "project");
  const turn = f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo" });
  assert.equal(turn.text, "");
  assert.deepEqual(plain(turn.skipped), [{ key: s.key, title: "Example", reason: "skill_mcp_dependency_missing" }]);
});
test("default project skills past the budget reach the agent as a pointer to their SKILL.md", () => {
  const f = withProjects(fixture());
  projectSkill(f, "Demo", "a-large", "A".repeat(40000));
  projectSkill(f, "Demo", "b-large", "B".repeat(20000));
  projectSkill(f, "Demo", "c-small", "Keep it short.");
  const turn = f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo" });
  assert.match(turn.text, /A{40000}/);
  assert.doesNotMatch(turn.text, /B{20000}/);
  assert.match(turn.text, /Skill, not included here: b-large[\s\S]*Read project\/Demo\/skills\/b-large\/SKILL\.md/);
  assert.match(turn.text, /Keep it short/);
  assert.deepEqual(plain(turn.applied.map((x) => [x.title, x.full])), [["a-large", true], ["b-large", false], ["c-small", true]]);
});
test("No Code users get no project skills", () => {
  const f = withProjects(fixture(false, "alice"));
  projectSkill(f, "Demo", "page-rules");
  assert.equal(f.api.prepare({ threadid: "c1", provider: "convertigo", projectId: "Demo", userId: lib.conversationOwner("alice") }).text, "");
  const catalog = f.api.execute({ action: "list", threadid: "c1", contextProject: "Demo" });
  assert.deepEqual(plain(catalog.autoSkills), []);
  assert.equal(catalog.contextProject, "");
});

test("an unreadable skills folder never fails a message or the library", () => {
  const f = withProjects(fixture());
  projectSkill(f, "Demo", "page-rules");
  const list = f.host.list;
  f.host.list = (base, rel) => {
    if (base === "project/Demo" && rel === "skills") { const e = new Error("symlink_forbidden"); e.code = "symlink_forbidden"; throw e; }
    return list(base, rel);
  };
  assert.equal(f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo" }).text, "");
  const catalog = f.api.execute({ action: "list", threadid: "c1", contextProject: "Demo" });
  assert.equal(catalog.ok, true);
  assert.ok(catalog.errors.some((x) => x.project === "Demo"));
});
test("a project save keeps its target whatever the project in context", () => {
  const f = withProjects(fixture());
  const item = f.api.execute({ action: "save", kind: "skill", scope: "project", project: "Other", contextProject: "Demo", revision: "", input: data("naming", "skill") }).item;
  assert.equal(item.key, "project:Other:skill:naming");
});

test("the not-on-by-default list stays bounded and never stops the library or a message", () => {
  const f = withProjects(fixture());
  f.files.set("users/studio/preferences.json", JSON.stringify({ schemaVersion: 1, notDefault: Array.from({ length: 150 }, (_, i) => "workspace::skill:gone-" + i).concat([7]) }));
  const s = save(f, "skill", data("method", "skill"));
  assert.equal(f.api.execute({ action: "list", contextProject: "Demo" }).ok, true);
  assert.match(f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo", language: "en" }).text, /Read references/);
  f.api.execute({ action: "skillDefault", key: s.key, input: { enabled: false } });
  assert.deepEqual(plain(JSON.parse(f.files.get("users/studio/preferences.json")).notDefault), [s.key], "removed skills are dropped at the limit");
  assert.equal(f.api.prepare({ threadid: "c2", provider: "codex", projectId: "Demo" }).text, "");
  const keep = [];
  for (let i = 0; i < 100; i++) keep.push(save(f, "skill", data("s" + i, "skill")).key);
  f.files.set("users/studio/preferences.json", JSON.stringify({ schemaVersion: 1, favorites: null, notDefault: keep }));
  assert.throws(() => f.api.execute({ action: "skillDefault", key: s.key, input: { enabled: false } }), /selection_too_large/);
  f.api.execute({ action: "skillDefault", key: keep[0], input: { enabled: true } });
  assert.equal(JSON.parse(f.files.get("users/studio/preferences.json")).notDefault.length, 99, "turning one back on still works");
});
test("a personal skill created by the agent starts not on by default; the user decides", () => {
  const f = withProjects(fixture());
  f.host.agentInitiated = true;
  const result = f.api.execute({ action: "save", kind: "skill", scope: "workspace", revision: "", input: data("agent-made", "skill") });
  assert.match(result.notice, /not on by default/);
  const copy = f.api.execute({ action: "duplicate", key: result.item.key, scope: "workspace", input: { id: "agent-copy" } });
  assert.match(copy.notice, /not on by default/);
  assert.equal(f.api.prepare({ threadid: "c1", provider: "codex", projectId: "Demo" }).text, "");
  const project = f.api.execute({ action: "save", kind: "skill", scope: "project", project: "Demo", revision: "", input: data("team-rules", "skill") });
  f.host.agentInitiated = false;
  const catalog = f.api.execute({ action: "list", contextProject: "Demo" });
  assert.deepEqual(plain(catalog.items.filter((it) => it.requiresReview).map((it) => [it.key, it.auto])), [
    [result.item.key, false], [project.item.key, true],
  ]);
  f.api.execute({ action: "approveSkill", key: result.item.key, revision: result.item.revision });
  assert.equal(f.api.prepare({ threadid: "approved", provider: "codex", projectId: "Other" }).text, "");
  f.api.execute({ action: "skillDefault", key: result.item.key, input: { enabled: true } });
  assert.match(f.api.prepare({ threadid: "c2", provider: "codex", projectId: "Other", language: "en" }).text, /Source: workspace::skill:agent-made/);
});

test("an agent save pauses a default project skill until its revision is approved per user", () => {
  const f = fixture(true, "reviewer"), secondUser = fixture(true, "second-user", f.files);
  const agent = fixture(true, "mcp-project-only", f.files);
  agent.host.agentInitiated = true;
  const draft = data("team-rules", "skill"), item = save(f, "skill", draft, "project");
  const first = { threadid: "first", provider: "codex", projectId: "Demo", externalSessionId: "s1", resourceContextEpoch: "codex:s1" };
  const second = { ...first, threadid: "second", externalSessionId: "s2", resourceContextEpoch: "codex:s2" };
  first.resourceSkillVersions = f.api.prepare(first).versions;
  f.api.execute({ action: "select", threadid: second.threadid, input: { skills: [item.key] } });
  second.resourceSkillVersions = f.api.prepare(second).versions;

  assert.equal(save(agent, "skill", draft, "project", item.revision).revision, item.revision);
  assert.equal(f.api.execute({ action: "list", contextProject: "Demo" }).items[0].requiresReview, false);
  draft.translations.en.body += "\nRevised instructions.";
  draft.translations.fr.body += "\nConsignes révisées.";
  const pending = save(agent, "skill", draft, "project", item.revision);
  assert.equal(f.api.execute({ action: "list", contextProject: "Demo" }).items[0].requiresReview, true);
  for (const state of [first, second]) {
    const turn = f.api.prepare(state);
    assert.equal(turn.text, "");
    assert.deepEqual(Object.keys(turn.versions), []);
    assert.equal(turn.skipped[0].reason, "skill_review_required");
  }
  assert.equal(secondUser.api.prepare({ ...first, threadid: "another-user" }).text, "");
  const { review } = f.api.execute({ action: "reviewSkill", key: item.key });
  assert.equal(review.revision, pending.revision);
  assert.match(review.files.find((file) => file.path === "SKILL.md").diff, /\+Revised instructions\./);
  assert.match(review.files.find((file) => file.path === "SKILL.fr.md").diff, /\+Consignes révisées\./);
  assert.throws(() => agent.api.execute({ action: "approveSkill", key: item.key, revision: pending.revision }), /human_review_required/);
  f.api.execute({ action: "select", threadid: second.threadid, input: { skills: [item.key], reviewKey: item.key } });
  assert.equal(f.api.prepare(second).text, "");
  f.api.execute({ action: "approveSkill", key: item.key, revision: review.revision, threadid: second.threadid });
  f.api.execute({ action: "favorites", input: { favorites: [] } });
  for (const state of [first, second, { ...first, threadid: "new", resourceSkillVersions: {} }]) {
    assert.match(f.api.prepare(state).text, /Revised instructions/);
  }
  assert.equal(secondUser.api.prepare({ ...first, threadid: "another-user" }).text, "");
  const preferences = JSON.parse(f.files.get("users/reviewer/preferences.json"));
  assert.equal(preferences.skillApprovals[item.key], pending.revision);
  for (const thread of [first.threadid, second.threadid]) {
    assert.deepEqual(Object.keys(JSON.parse(f.files.get("users/reviewer/conversations/" + thread + ".json"))).sort(),
      ["mcp", "mcpRevisions", "off", "skills"]);
  }
});

test("writeFile pauses a skill, previews support changes and refuses a stale approval", () => {
  const f = fixture();
  const item = save(f, "skill", data("example", "skill"));
  const guide = { action: "writeFile", key: item.key, revision: "", input: { path: "references/guide.md", content: "Agent reference" } };
  f.host.agentInitiated = true;
  const first = f.api.execute(guide);
  f.host.agentInitiated = false;
  const { review } = f.api.execute({ action: "reviewSkill", key: item.key });
  assert.match(review.files.find((file) => file.path === guide.input.path).diff, /\+Agent reference/);
  f.host.agentInitiated = true;
  const same = f.api.execute({ ...guide, revision: first.revision });
  assert.equal(same.item.revision, first.item.revision);
  const newer = f.api.execute({ ...guide, revision: same.revision, input: { ...guide.input, content: "Updated by the agent" } });
  f.host.agentInitiated = false;
  assert.throws(() => f.api.execute({ action: "approveSkill", key: item.key, revision: review.revision }), /revision_conflict/);
  f.api.execute({ action: "approveSkill", key: item.key, revision: newer.item.revision });
  f.host.agentInitiated = true;
  f.api.execute({ ...guide, revision: newer.revision, input: { ...guide.input, content: "A third change" } });
  f.host.agentInitiated = false;
  const compare = f.api.execute({ action: "reviewSkill", key: item.key }).review.files.find((file) => file.path === guide.input.path);
  assert.match(compare.diff, /-Updated by the agent\n\+A third change/);
  assert.equal(f.api.prepare({ threadid: "paused" }).skipped[0].reason, "skill_review_required");
  f.files.set("users/studio/skills/example/SKILL.md", item.data.translations.en.body + "\nEdited by hand.");
  f.files.set("users/studio/skills/example/references/guide.md", "A manual reference edit");
  assert.equal(f.api.execute({ action: "list" }).items[0].requiresReview, false);
  const turn = f.api.prepare({ threadid: "manual" });
  assert.match(turn.text, /Edited by hand\./);
  assert.deepEqual(plain(turn.skipped), []);
});

test("a Git pull updates the project skill even while the previous agent revision awaits review", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tigo-skill-pull-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, "upstream"), checkout = path.join(root, "checkout");
  const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  const commit = () => git(upstream, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "commit", "-am", "Update skill");
  const md = ".tigo/skills/team-rules/SKILL.md";
  const body = (text) => "---\nname: team-rules\ndescription: Team rules\n---\n" + text;
  fs.mkdirSync(path.dirname(path.join(upstream, md)), { recursive: true });
  git(upstream, "init", "-q");
  fs.writeFileSync(path.join(upstream, md), body("First Git version"));
  git(upstream, "add", "--", md);
  commit();
  git(root, "clone", "-q", upstream, checkout);

  const f = fixture();
  const base = path.join(checkout, ".tigo");
  f.host.projects = () => ({ Demo: base });
  const { read, write, list } = f.host;
  f.host.read = (where, relative) => where === base
    ? fs.existsSync(path.join(where, relative)) ? fs.readFileSync(path.join(where, relative), "utf8") : null
    : read(where, relative);
  f.host.write = (where, relative, content) => where === base
    ? fs.writeFileSync(path.join(where, relative), content)
    : write(where, relative, content);
  f.host.list = (where, relative) => where === base && relative === "skills" ? ["team-rules"] : list(where, relative);
  const state = { threadid: "git", projectId: "Demo" };
  assert.match(f.api.prepare(state).text, /First Git version/);
  const { item } = f.api.execute({ action: "get", key: "project:Demo:skill:team-rules" });
  f.host.agentInitiated = true;
  item.data.translations.en.body = body("Agent version");
  save(f, "skill", item.data, "project", item.revision);
  f.host.agentInitiated = false;
  assert.equal(f.api.prepare(state).skipped[0].reason, "skill_review_required");

  fs.writeFileSync(path.join(upstream, md), body("Pulled Git version"));
  commit();
  // Discard the dirty working tree, as a checkout reset would do before pulling an updated team skill.
  git(checkout, "restore", "--", md);
  fs.unlinkSync(path.join(checkout, ".tigo/skills/team-rules/skill.json"));
  git(checkout, "pull", "--ff-only");
  assert.match(f.api.prepare(state).text, /Pulled Git version/);
  assert.equal(f.api.execute({ action: "list", contextProject: "Demo" }).items[0].requiresReview, false);
});

test("a partially failed agent save still leaves its changed instructions paused", () => {
  const f = fixture();
  const draft = data("example", "skill"), item = save(f, "skill", draft);
  const write = f.host.write;
  draft.translations.en.body += "\nPartially written instructions";
  f.host.write = (base, relative, content) => {
    if (relative.endsWith("/SKILL.fr.md")) throw new Error("write failed");
    write(base, relative, content);
  };
  f.host.agentInitiated = true;
  assert.throws(() => save(f, "skill", draft, "workspace", item.revision), /write failed/);
  f.host.agentInitiated = false;
  f.host.write = write;
  const state = { threadid: "partial" };
  assert.equal(f.api.prepare(state).skipped[0].reason, "skill_review_required");
  const { review } = f.api.execute({ action: "reviewSkill", key: item.key });
  const approve = { action: "approveSkill", key: item.key, revision: review.revision };
  f.api.execute(approve);
  f.api.execute(approve);
  assert.match(f.api.prepare(state).text, /Partially written instructions/);
});
