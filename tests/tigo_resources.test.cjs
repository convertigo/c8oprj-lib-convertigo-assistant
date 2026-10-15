const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
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
    identity: () => ({ admin, user, key: user }),
    personal: (k) => "users/" + k,
    builtins: () => "builtin",
    projects: () => ({ Demo: "project/Demo" }),
    hash: (v) => crypto.createHash("sha256").update(v).digest("hex"),
    now: () => 1,
    read: (base, rel) => files.get(base + "/" + rel) || null,
    write: (base, rel, v) => files.set(base + "/" + rel, v),
    remove: (base, rel) => files.delete(base + "/" + rel),
    list: (base, rel) => [
      ...new Set(
        [...files.keys()]
          .filter((k) => k.startsWith(base + "/" + rel + "/"))
          .map((k) => k.slice((base + "/" + rel + "/").length).split("/")[0]),
      ),
    ],
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
    input: { skills: [], mcp: [] },
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
    key: "form-user",
    surface: "nocode",
  });
  const api = lib.create(f.host),
    catalog = api.execute({ action: "list", language: "es" });
  assert.equal(catalog.items[0].body, "NoCode prompt");
  assert.equal(catalog.favorites.length, 1);
});
