/* Tigo 1.5 resource library. Shared by the authenticated UI and project-only MCP tools. */
if (typeof C8O === "undefined") {
  var C8O = {};
}
C8O.tigoResources = (function () {
  function fail(code) {
    var e = new Error(code);
    e.code = code;
    throw e;
  }
  function text(v) {
    return v == null ? "" : String(v);
  }
  // The userId a server conversation is stored under: the email of a C8Oforms OAuth user
  // ("provider:subject:email"), the whole name otherwise. Same rule as callerUserId in agent_bridge_client.js.
  function conversationOwner(user) {
    var parts = text(user).trim().split(":"),
      last = parts[parts.length - 1];
    return parts.length > 2 && last.indexOf("@") > 0 ? last : parts.join(":");
  }
  function object(v) {
    if (typeof v === "string") {
      v = JSON.parse(v || "{}");
    }
    return v || {};
  }
  function id(v) {
    v = text(v);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(v)) {
      fail("invalid_id");
    }
    return v;
  }
  function lang(v) {
    v = text(v || "en")
      .toLowerCase()
      .split(/[-_]/)[0];
    if (!/^[a-z]{2,3}$/.test(v)) {
      fail("invalid_language");
    }
    return v;
  }
  function map(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      fail("invalid_object");
    }
    return v;
  }
  function bounded(v, max) {
    v = text(v);
    if (v.length > max || v.indexOf("\u0000") >= 0) {
      fail("content_too_large");
    }
    return v;
  }
  function unique(v) {
    var out = [];
    (v || []).forEach(function (x) {
      if (typeof x !== "string" || x.length > 220) {
        fail("invalid_selection");
      }
      if (out.indexOf(x) < 0) {
        out.push(x);
      }
    });
    if (out.length > 100) {
      fail("selection_too_large");
    }
    return out;
  }
  function normalize(kind, data) {
    data = object(data);
    var value = {
      schemaVersion: 1,
      id: id(data.id),
      defaultLanguage: lang(data.defaultLanguage),
      translations: {}
    };
    if (data.schemaVersion !== 1) {
      fail("unsupported_schema");
    }
    var translations = map(data.translations);
    var languages = Object.keys(translations);
    if (!languages.length || languages.length > 12) {
      fail("invalid_translations");
    }
    languages.forEach(function (code) {
      if (lang(code) !== code) {
        fail("invalid_language");
      }
      var t = map(translations[code]);
      value.translations[code] = {
        title: bounded(t.title, 160),
        description: bounded(t.description, 500)
      };
      if (!value.translations[code].title.trim()) {
        fail("title_required");
      }
      if (kind !== "mcp") {
        value.translations[code].body = bounded(t.body, 65536);
      }
    });
    if (!value.translations[value.defaultLanguage]) {
      fail("default_translation_required");
    }
    value.surfaces = unique(data.surfaces || ["studio", "nocode"]);
    if (
      value.surfaces.some(function (s) {
        return ["studio", "nocode"].indexOf(s) < 0;
      })
    ) {
      fail("invalid_surface");
    }
    if (kind === "skill") {
      value.requiresMcp = unique(data.requiresMcp);
      languages.forEach(function (code) {
        var body = value.translations[code].body;
        if (
          !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body) ||
          !/^name:\s*[^\r\n]+/m.test(body) ||
          !/^description:\s*[^\r\n]+/m.test(body)
        ) {
          fail("skill_frontmatter_required");
        }
      });
    } else if (kind === "mcp") {
      var c = map(data.connection);
      value.connection = { transport: text(c.transport) };
      if (c.transport === "http") {
        var url = bounded(c.url, 2000);
        if (
          !/^https:\/\/[^\s/@]+(?:\/[^\s]*)?$/.test(url) &&
          !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s]*)?$/.test(
            url
          )
        ) {
          fail("mcp_https_or_loopback_required");
        }
        if (
          /(?:[?&](?:key|token|secret|password|authorization|api_key)=)|[\r\n#]/i.test(
            url
          )
        ) {
          fail("mcp_url_credentials_forbidden");
        }
        value.connection.url = url;
      } else if (c.transport === "stdio") {
        value.connection.command = bounded(c.command, 1024);
        if (!value.connection.command.trim()) {
          fail("command_required");
        }
        value.connection.args = (c.args || []).map(function (a) {
          return bounded(a, 1024);
        });
        if (value.connection.args.length > 50) {
          fail("too_many_arguments");
        }
        if (
          value.connection.args.some(function (a) {
            return /(?:sk-[A-Za-z0-9]{12,}|Bearer\s+\S+|(?:api[-_]?key|token|password|secret)=\S+|^--?(?:api[-_]?key|token|password|secret)$)/i.test(
              a
            );
          })
        ) {
          fail("mcp_arguments_credentials_forbidden");
        }
      } else {
        fail("invalid_transport");
      }
      value.connection.env = unique(c.env);
      value.connection.headers = {};
      Object.keys(c.headers || {}).forEach(function (k) {
        if (!/^[A-Za-z0-9-]{1,80}$/.test(k)) {
          fail("invalid_header");
        }
        var h = map(c.headers[k]);
        if (["", "Bearer ", "Basic "].indexOf(text(h.prefix)) < 0) {
          fail("invalid_header_prefix");
        }
        value.connection.headers[k] = {
          env: bounded(h.env, 80),
          prefix: bounded(h.prefix, 30)
        };
      });
      var keys = value.connection.env.concat(
        Object.keys(value.connection.headers).map(function (k) {
          return value.connection.headers[k].env;
        })
      );
      keys.forEach(function (k) {
        if (
          !/^[A-Z][A-Z0-9_]{1,79}$/.test(k) ||
          /^(?:PATH|HOME|SHELL|BASH_ENV|ENV|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$|^(?:LD_|DYLD_|PYTHON|NODE_|JAVA_|CONVERTIGO_|C8O_|CODEX_|CLAUDE_|VIBE_|OPENAI_|ANTHROPIC_|MISTRAL_)/.test(
            k
          )
        ) {
          fail("invalid_secret_reference");
        }
      });
      if (
        JSON.stringify(value.connection).indexOf("\u0000") >= 0 ||
        Object.keys(value.connection.headers).some(function (k) {
          return /[\r\n]/.test(value.connection.headers[k].prefix);
        })
      ) {
        fail("invalid_connection");
      }
    } else if (kind !== "prompt") {
      fail("invalid_kind");
    }
    return value;
  }
  function create(host) {
    var who = host.identity(),
      personal = host.personal(who.key),
      builtins = host.builtins();
    function source(scope, project) {
      if (scope === "builtin") {
        return { scope: scope, project: "", base: builtins, readOnly: true };
      }
      if (scope === "workspace") {
        return { scope: scope, project: "", base: personal, readOnly: false };
      }
      if (scope !== "project" || !who.admin) {
        fail("project_access_denied");
      }
      if (project === "lib_ConvertigoAssistant") {
        fail("builtin_read_only");
      }
      var projects = host.projects(),
        base = projects[project];
      if (!base) {
        fail("unknown_project");
      }
      return { scope: scope, project: project, base: base, readOnly: false };
    }
    function paths(kind, slug) {
      id(slug);
      if (["prompt", "skill", "mcp"].indexOf(kind) < 0) {
        fail("invalid_kind");
      }
      return kind === "mcp"
        ? "mcp.json"
        : kind +
            "s/" +
            slug +
            "/" +
            (kind === "skill" ? "skill.json" : "prompt.json");
    }
    function key(s, kind, slug) {
      return s.scope + ":" + (s.project || "") + ":" + kind + ":" + slug;
    }
    function load(s, kind, slug) {
      var path = paths(kind, slug),
        raw = host.read(s.base, path),
        doc;
      if (kind === "mcp") {
        doc = raw ? object(raw) : { schemaVersion: 1, servers: [] };
        if (doc.schemaVersion !== 1) {
          fail("unsupported_schema");
        }
        doc = (doc.servers || []).filter(function (x) {
          return x.id === slug;
        })[0];
        if (!doc) {
          return null;
        }
      } else {
        if (!raw) {
          if (kind !== "skill") {
            return null;
          }
          var standard = host.read(s.base, "skills/" + slug + "/SKILL.md");
          if (!standard) {
            return null;
          }
          var name = /^name:\s*(.+)$/m.exec(standard),
            description = /^description:\s*(.+)$/m.exec(standard);
          doc = {
            schemaVersion: 1,
            id: slug,
            defaultLanguage: "en",
            translations: {
              en: {
                title: name ? name[1] : slug,
                description: description ? description[1] : "",
                body: standard
              }
            }
          };
        } else {
          doc = object(raw);
        }
        Object.keys(doc.translations || {}).forEach(function (code) {
          lang(code);
          var rel =
            kind +
            "s/" +
            slug +
            "/" +
            (kind === "skill"
              ? code === doc.defaultLanguage
                ? "SKILL.md"
                : "SKILL." + code + ".md"
              : "prompt." + code + ".md");
          doc.translations[code].body = host.read(s.base, rel) || "";
        });
      }
      var value = normalize(kind, doc),
        support =
          kind === "skill" && host.files
            ? host.files(s.base, "skills/" + slug)
            : [];
      var revision = host.hash(
        JSON.stringify(value) +
          JSON.stringify(
            support.map(function (p) {
              return [
                p,
                host.fileHash
                  ? host.fileHash(s.base, "skills/" + slug + "/" + p)
                  : host.hash(
                      host.read(s.base, "skills/" + slug + "/" + p) || ""
                    )
              ];
            })
          )
      );
      return {
        key: key(s, kind, slug),
        kind: kind,
        scope: s.scope,
        project: s.project,
        readOnly: s.readOnly,
        id: slug,
        revision: revision,
        data: value
      };
    }
    function entry(k) {
      var parts = text(k).split(":");
      if (parts.length !== 4) {
        fail("invalid_resource_key");
      }
      var s = source(parts[0], parts[1]);
      var found = load(s, parts[2], parts[3]);
      if (!found) {
        fail("resource_missing");
      }
      return found;
    }
    function prefs() {
      var v = object(host.read(personal, "preferences.json"));
      return {
        schemaVersion: 1,
        favorites: Array.isArray(v.favorites) ? unique(v.favorites) : null
      };
    }
    function selection(thread) {
      thread = text(thread || "draft");
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(thread)) {
        fail("invalid_conversation");
      }
      return "conversations/" + thread + ".json";
    }
    function selected(thread) {
      var p = selection(thread),
        v = object(host.read(personal, p));
      return {
        skills: unique(v.skills),
        mcp: unique(v.mcp),
        mcpRevisions: v.mcpRevisions || {}
      };
    }
    function list(language, thread) {
      var sources = [source("builtin"), source("workspace")],
        items = [],
        errors = [],
        l = lang(language);
      if (who.admin) {
        Object.keys(host.projects())
          .sort()
          .forEach(function (p) {
            if (p !== "lib_ConvertigoAssistant") {
              sources.push(source("project", p));
            }
          });
      }
      sources.forEach(function (s) {
        ["prompt", "skill", "mcp"].forEach(function (kind) {
          try {
            var slugs =
              kind === "mcp"
                ? (object(host.read(s.base, "mcp.json")).servers || []).map(
                    function (x) {
                      return x.id;
                    }
                  )
                : host.list(s.base, kind + "s");
            if (slugs.length > 200) {
              fail("too_many_resources");
            }
            slugs.forEach(function (slug) {
              try {
                var x = load(s, kind, slug);
                if (
                  x &&
                  (who.surface === "all" ||
                    x.data.surfaces.indexOf(
                      who.surface || (who.admin ? "studio" : "nocode")
                    ) >= 0)
                ) {
                  var t =
                    x.data.translations[l] ||
                    x.data.translations[x.data.defaultLanguage];
                  x.title = t.title;
                  x.description = t.description;
                  x.body = t.body || "";
                  items.push(x);
                }
              } catch (e) {
                errors.push({
                  scope: s.scope,
                  project: s.project,
                  id: text(slug),
                  error: text(e.code || "invalid_resource")
                });
              }
            });
          } catch (e) {
            errors.push({
              scope: s.scope,
              project: s.project,
              error: text(e.code || "invalid_catalog")
            });
          }
        });
      });
      var p = prefs(),
        favorites =
          p.favorites === null
            ? items
                .filter(function (x) {
                  return x.scope === "builtin" && x.kind === "prompt";
                })
                .map(function (x) {
                  return x.key;
                })
            : p.favorites;
      favorites = favorites.filter(function (k) {
        return items.some(function (x) {
          return x.key === k && x.kind === "prompt";
        });
      });
      var s = selected(thread),
        missing = s.skills.concat(s.mcp).filter(function (k) {
          return !items.some(function (x) {
            return x.key === k;
          });
        });
      items.forEach(function (x) {
        x.favorite = favorites.indexOf(x.key) >= 0;
        x.enabled = (x.kind === "skill" ? s.skills : s.mcp).indexOf(x.key) >= 0;
        x.requiresReview =
          x.kind === "mcp" && x.enabled && s.mcpRevisions[x.key] !== x.revision;
      });
      return {
        ok: true,
        schemaVersion: 1,
        items: items,
        favorites: favorites,
        selection: s,
        missingSelections: missing,
        canManageMcp: who.admin,
        projects: who.admin
          ? Object.keys(host.projects())
              .filter(function (p) {
                return p !== "lib_ConvertigoAssistant";
              })
              .sort()
          : [],
        secrets: host.secretNames(personal),
        errors: errors
      };
    }
    function write(s, kind, value, revision) {
      if (s.readOnly) {
        fail("builtin_read_only");
      }
      value = normalize(kind, value);
      return host.lock(s.base, function () {
        var previous = load(s, kind, value.id);
        if (previous ? previous.revision !== revision : !!revision) {
          fail("revision_conflict");
        }
        if (s.scope === "project") {
          host.protectProject(s.project);
        }
        if (kind === "mcp") {
          var doc = object(host.read(s.base, "mcp.json"));
          var servers = (doc.servers || []).filter(function (x) {
            return x.id !== value.id;
          });
          servers.push(value);
          host.write(
            s.base,
            "mcp.json",
            JSON.stringify({ schemaVersion: 1, servers: servers }, null, 2)
          );
        } else {
          var meta = object(JSON.stringify(value));
          Object.keys(meta.translations).forEach(function (code) {
            var rel =
              kind +
              "s/" +
              value.id +
              "/" +
              (kind === "skill"
                ? code === value.defaultLanguage
                  ? "SKILL.md"
                  : "SKILL." + code + ".md"
                : "prompt." + code + ".md");
            host.write(s.base, rel, meta.translations[code].body);
            delete meta.translations[code].body;
          });
          host.write(
            s.base,
            paths(kind, value.id),
            JSON.stringify(meta, null, 2)
          );
        }
        return load(s, kind, value.id);
      });
    }
    function execute(args) {
      args = object(args);
      var action = text(args.action || "list"),
        input = object(args.input);
      if (action === "list") {
        return list(args.language, args.threadid);
      }
      if (action === "get") {
        return { ok: true, item: entry(args.key) };
      }
      if (action === "save") {
        var destination = source(args.scope, args.project),
          origin = args.copyFromKey ? entry(args.copyFromKey) : null;
        if (
          origin &&
          (origin.kind !== "skill" ||
            args.kind !== "skill" ||
            origin.revision !== args.copyFromRevision ||
            args.revision)
        ) {
          fail("revision_conflict");
        }
        var item = write(destination, args.kind, input, args.revision || "");
        if (origin && host.files) {
          var originSource = source(origin.scope, origin.project);
          host
            .files(originSource.base, "skills/" + origin.id)
            .forEach(function (p) {
              if (host.copy) {
                host.copy(
                  originSource.base,
                  "skills/" + origin.id + "/" + p,
                  destination.base,
                  "skills/" + item.id + "/" + p
                );
              } else {
                host.write(
                  destination.base,
                  "skills/" + item.id + "/" + p,
                  host.read(originSource.base, "skills/" + origin.id + "/" + p)
                );
              }
            });
          item = load(destination, args.kind, item.id);
        }
        return { ok: true, item: item };
      }
      if (action === "duplicate") {
        var original = entry(args.key),
          copy = object(JSON.stringify(original.data));
        copy.id = id(input.id);
        var destination = source(args.scope, args.project);
        var written = write(destination, original.kind, copy, "");
        if (original.kind === "skill" && host.files) {
          var origin = source(original.scope, original.project);
          host
            .files(origin.base, "skills/" + original.id)
            .forEach(function (p) {
              if (host.copy) {
                host.copy(
                  origin.base,
                  "skills/" + original.id + "/" + p,
                  destination.base,
                  "skills/" + copy.id + "/" + p
                );
              } else {
                host.write(
                  destination.base,
                  "skills/" + copy.id + "/" + p,
                  host.read(origin.base, "skills/" + original.id + "/" + p)
                );
              }
            });
          written = load(destination, original.kind, copy.id);
        }
        return { ok: true, item: written };
      }
      if (action === "readFile" || action === "writeFile") {
        var resource = entry(args.key);
        if (resource.kind !== "skill") {
          fail("skill_required");
        }
        var origin = source(resource.scope, resource.project),
          relative = text(input.path);
        if (
          !/^(?:references|scripts|assets)\/[A-Za-z0-9_./-]{1,180}$/.test(
            relative
          ) ||
          relative.split("/").some(function (p) {
            return !p || p === "." || p === "..";
          })
        ) {
          fail("invalid_support_path");
        }
        var target = "skills/" + resource.id + "/" + relative,
          content = host.read(origin.base, target),
          revision = content === null ? "" : host.hash(content);
        if (action === "writeFile") {
          if (origin.readOnly) {
            fail("builtin_read_only");
          }
          host.lock(origin.base, function () {
            var current = host.read(origin.base, target);
            if (
              (current === null ? "" : host.hash(current)) !==
              text(args.revision)
            ) {
              fail("revision_conflict");
            }
            if (origin.scope === "project") {
              host.protectProject(origin.project);
            }
            host.write(origin.base, target, bounded(input.content, 65536));
          });
          content = host.read(origin.base, target);
          revision = host.hash(content);
        }
        return {
          ok: true,
          path: relative,
          content: content,
          revision: revision,
          item: load(origin, "skill", resource.id)
        };
      }
      if (action === "delete") {
        var item = entry(args.key),
          s = source(item.scope, item.project);
        if (s.readOnly) {
          fail("builtin_read_only");
        }
        return host.lock(s.base, function () {
          if (entry(args.key).revision !== args.revision) {
            fail("revision_conflict");
          }
          host.write(
            s.base,
            ".trash/" + host.hash(item.key + ":" + host.now()) + ".json",
            JSON.stringify(item)
          );
          if (item.kind === "mcp") {
            var doc = object(host.read(s.base, "mcp.json"));
            doc.servers = doc.servers.filter(function (x) {
              return x.id !== item.id;
            });
            host.write(s.base, "mcp.json", JSON.stringify(doc, null, 2));
          } else {
            host.remove(s.base, paths(item.kind, item.id));
            if (item.kind === "skill") {
              Object.keys(item.data.translations).forEach(function (code) {
                host.remove(
                  s.base,
                  "skills/" +
                    item.id +
                    "/" +
                    (code === item.data.defaultLanguage
                      ? "SKILL.md"
                      : "SKILL." + code + ".md")
                );
              });
            }
          }
          return { ok: true };
        });
      }
      if (action === "favorites") {
        var favorites = unique(input.favorites);
        favorites.forEach(function (k) {
          if (entry(k).kind !== "prompt") {
            fail("not_a_prompt");
          }
        });
        host.write(
          personal,
          "preferences.json",
          JSON.stringify({ schemaVersion: 1, favorites: favorites }, null, 2)
        );
        return { ok: true, favorites: favorites };
      }
      if (action === "select") {
        var skills = unique(input.skills),
          mcp = unique(input.mcp),
          previous = selected(args.threadid),
          approved = {};
        skills.forEach(function (k) {
          if (entry(k).kind !== "skill") {
            fail("not_a_skill");
          }
        });
        mcp.forEach(function (k) {
          var item = entry(k);
          if (item.kind !== "mcp") {
            fail("not_a_connection");
          }
          approved[k] =
            previous.mcp.indexOf(k) < 0 || input.reviewKey === k
              ? item.revision
              : previous.mcpRevisions[k] || "";
        });
        if (mcp.length && !who.admin) {
          fail("mcp_activation_admin_required");
        }
        var value = { skills: skills, mcp: mcp, mcpRevisions: approved };
        host.write(personal, selection(args.threadid), JSON.stringify(value));
        return { ok: true, selection: value };
      }
      if (action === "secret") {
        if (!who.admin) {
          fail("secret_admin_required");
        }
        var secretName = text(input.name);
        if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(secretName)) {
          fail("invalid_secret_reference");
        }
        host.secret(personal, secretName, bounded(input.value, 16000));
        return { ok: true, secrets: host.secretNames(personal) };
      }
      fail("invalid_action");
    }
    function prepare(state) {
      if (!who.admin && who.owner !== state.userId) {
        fail("conversation_access_denied");
      }
      var s = selected(state.threadid);
      if (!host.read(personal, selection(state.threadid))) {
        s = selected("");
        host.write(personal, selection(state.threadid), JSON.stringify(s));
      }
      var loaded = state.resourceSkillVersions || {},
        epoch = text(state.provider) + ":" + text(state.externalSessionId),
        sections = [],
        versions = {},
        connections = [];
      if (state.resourceContextEpoch !== epoch) {
        loaded = {};
      }
      s.skills.forEach(function (k) {
        var item = entry(k),
          l = lang(state.language),
          t =
            item.data.translations[l] ||
            item.data.translations[item.data.defaultLanguage];
        (item.data.requiresMcp || []).forEach(function (required) {
          if (s.mcp.indexOf(required) < 0) {
            fail("skill_mcp_dependency_missing");
          }
        });
        versions[k] = item.revision;
        if (loaded[k] !== item.revision) {
          var origin = source(item.scope, item.project);
          sections.push(
            "Custom skill: " +
              t.title +
              "\nSource: " +
              item.key +
              "\nDirectory: " +
              origin.base +
              "/skills/" +
              item.id +
              "\nRevision: " +
              item.revision +
              "\n\n" +
              t.body
          );
        }
      });
      s.mcp.forEach(function (k) {
        if (!who.admin) {
          fail("mcp_activation_admin_required");
        }
        var item = entry(k);
        if (s.mcpRevisions[k] !== item.revision) {
          fail("mcp_changed_requires_review");
        }
        var c = object(JSON.stringify(item.data.connection));
        c.name = "tigo_" + host.hash(item.key).substring(0, 16);
        c.envValues = {};
        var secrets = host.readSecrets(personal);
        c.env.forEach(function (name) {
          if (!secrets[name]) {
            fail("mcp_secret_missing");
          }
          c.envValues[name] = secrets[name];
        });
        Object.keys(c.headers).forEach(function (name) {
          var ref = c.headers[name].env;
          if (!secrets[ref]) {
            fail("mcp_secret_missing");
          }
          c.envValues[ref] = secrets[ref];
        });
        connections.push(c);
      });
      return {
        text: sections.length
          ? "\n\n<activated-tigo-skills>\n" +
            sections.join("\n\n---\n\n") +
            "\n</activated-tigo-skills>"
          : "",
        versions: versions,
        connections: connections,
        fingerprint: host.hash(JSON.stringify(connections))
      };
    }
    return {
      execute: function (args) {
        if (
          ["list", "get", "readFile"].indexOf(
            text((args && args.action) || "list")
          ) >= 0
        ) {
          return execute(args);
        }
        // Serialize a complete mutation, including support-file copies and
        // read/modify/write preferences, with the native reentrant lock.
        return host.lock(personal, function () {
          return execute(args);
        });
      },
      prepare: prepare
    };
  }
  function javaHost(ctx, projectOnly) {
    var E = Packages.com.twinsoft.convertigo.engine.Engine,
      F = Packages.java.io.File,
      N = Packages.java.nio.file.Files,
      UTF = Packages.java.nio.charset.StandardCharsets.UTF_8;
    var admin = E.authenticatedSessionManager.hasRole(
        ctx.httpSession,
        Packages.com.twinsoft.convertigo.engine.AuthenticatedSessionManager.Role
          .WEB_ADMIN
      ),
      studio = E.isStudioMode(),
      user = text(ctx.getAuthenticatedUser());
    if (!projectOnly && ctx.httpServletRequest) {
      var origin = text(ctx.httpServletRequest.getHeader("Origin"));
      if (origin) {
        try {
          var uri = new java.net.URI(origin),
            host = text(uri.getHost()).toLowerCase(),
            scheme = text(uri.getScheme());
          var sameHost =
            host === text(ctx.httpServletRequest.getServerName()).toLowerCase();
          var publicUrl =
            Packages.com.twinsoft.convertigo.engine.EnginePropertiesManager.getProperty(
              Packages.com.twinsoft.convertigo.engine.EnginePropertiesManager
                .PropertyName.APPLICATION_SERVER_CONVERTIGO_URL
            );
          var publicUri = new java.net.URI(text(publicUrl));
          var publicOrigin =
            origin ===
            text(publicUri.getScheme()) +
              "://" +
              text(publicUri.getAuthority());
          if (
            uri.getUserInfo() !== null ||
            ["http", "https"].indexOf(scheme) < 0 ||
            !(
              sameHost ||
              publicOrigin ||
              ["localhost", "127.0.0.1", "::1", "[::1]"].indexOf(host) >= 0 ||
              origin === "https://assistant.convertigo.com"
            )
          ) {
            fail("origin_forbidden");
          }
        } catch (e) {
          fail("origin_forbidden");
        }
      }
    }
    if (projectOnly) {
      admin = true;
      user = "mcp-project-only";
    } else if (studio ? !admin : !admin && !user) {
      fail("authentication_required");
    }
    var identity = {
      admin: !!admin,
      surface: projectOnly ? "all" : studio || !user ? "studio" : "nocode",
      user: studio && !projectOnly ? "studio" : user,
      owner: studio && !projectOnly ? "studio" : conversationOwner(user),
      key: studio && !projectOnly ? "studio" : hash(user || "admin")
    };
    function hash(v) {
      var b = Packages.java.security.MessageDigest.getInstance(
        "SHA-256"
      ).digest(new java.lang.String(text(v)).getBytes(UTF));
      var out = "";
      for (var i = 0; i < b.length; i++) {
        out += ("0" + ((b[i] + 256) % 256).toString(16)).slice(-2);
      }
      return out;
    }
    function project(name) {
      var p = E.theApp.databaseObjectsManager.getOriginalProjectByName(
        text(name)
      );
      if (!p) {
        fail("unknown_project");
      }
      return p.getDirFile();
    }
    function safe(base, rel) {
      var root = new F(base).getCanonicalFile(),
        file = new F(root, text(rel)).getCanonicalFile();
      if (!file.toPath().startsWith(root.toPath()) || file.equals(root)) {
        fail("path_escape");
      }
      var parts = text(rel).replace(/\\/g, "/").split("/");
      if (
        parts.some(function (p) {
          return !p || p === "." || p === "..";
        })
      ) {
        fail("invalid_path");
      }
      var current = new F(base);
      if (N.isSymbolicLink(current.toPath())) {
        fail("symlink_forbidden");
      }
      parts.forEach(function (p) {
        current = new F(current, p);
        if (N.isSymbolicLink(current.toPath())) {
          fail("symlink_forbidden");
        }
      });
      return file;
    }
    function read(base, rel) {
      var f = safe(base, rel);
      if (!f.isFile()) {
        return null;
      }
      if (f.length() > 1048576) {
        fail("file_too_large");
      }
      return String(new java.lang.String(N.readAllBytes(f.toPath()), UTF));
    }
    function write(base, rel, value) {
      var f = safe(base, rel);
      N.createDirectories(f.getParentFile().toPath());
      var tmp = N.createTempFile(f.getParentFile().toPath(), ".tigo-", ".tmp");
      try {
        try {
          N.setPosixFilePermissions(
            tmp,
            Packages.java.nio.file.attribute.PosixFilePermissions.fromString(
              "rw-------"
            )
          );
        } catch (ignore) {}
        N.write(tmp, new java.lang.String(text(value)).getBytes(UTF));
        try {
          N.move(
            tmp,
            f.toPath(),
            Packages.java.nio.file.StandardCopyOption.ATOMIC_MOVE,
            Packages.java.nio.file.StandardCopyOption.REPLACE_EXISTING
          );
        } catch (e) {
          if (
            !(
              e.javaException instanceof
              Packages.java.nio.file.AtomicMoveNotSupportedException
            )
          ) {
            throw e;
          }
          N.move(
            tmp,
            f.toPath(),
            Packages.java.nio.file.StandardCopyOption.REPLACE_EXISTING
          );
        }
      } finally {
        N.deleteIfExists(tmp);
      }
    }
    function secrets(base) {
      return object(read(base, "secrets.json"));
    }
    return {
      identity: function () {
        return identity;
      },
      hash: hash,
      now: function () {
        return Number(Packages.java.lang.System.currentTimeMillis());
      },
      personal: function (key) {
        return text(
          new F(text(E.USER_WORKSPACE_PATH), "agents/tigo/users/" + key)
        );
      },
      builtins: function () {
        return text(new F(project("lib_ConvertigoAssistant"), ".tigo"));
      },
      projects: function () {
        var out = {},
          it = E.theApp.databaseObjectsManager
            .getAllProjectNamesList()
            .iterator();
        while (it.hasNext()) {
          var name = text(it.next());
          try {
            out[name] = text(new F(project(name), ".tigo"));
          } catch (ignore) {}
        }
        return out;
      },
      read: read,
      write: write,
      remove: function (base, rel) {
        N.deleteIfExists(safe(base, rel).toPath());
      },
      fileHash: function (base, rel) {
        var f = safe(base, rel);
        if (f.length() > 1048576) {
          fail("file_too_large");
        }
        var b = Packages.java.security.MessageDigest.getInstance(
          "SHA-256"
        ).digest(N.readAllBytes(f.toPath()));
        var s = "";
        for (var i = 0; i < b.length; i++) {
          s += ("0" + ((b[i] + 256) % 256).toString(16)).slice(-2);
        }
        return s;
      },
      copy: function (base, rel, targetBase, targetRel) {
        var target = safe(targetBase, targetRel);
        N.createDirectories(target.getParentFile().toPath());
        N.copy(
          safe(base, rel).toPath(),
          target.toPath(),
          Packages.java.nio.file.StandardCopyOption.REPLACE_EXISTING
        );
      },
      list: function (base, rel) {
        var f = safe(base, rel),
          a = f.listFiles(),
          out = [];
        if (a) {
          for (var i = 0; i < a.length; i++) {
            if (a[i].isDirectory() && !N.isSymbolicLink(a[i].toPath())) {
              out.push(text(a[i].getName()));
            }
          }
        }
        return out.sort();
      },
      files: function (base, rel) {
        var out = [];
        function walk(path, depth) {
          if (depth > 5) {
            fail("support_tree_too_deep");
          }
          var dir = safe(base, rel + "/" + path),
            a = dir.listFiles();
          if (a) {
            for (var i = 0; i < a.length; i++) {
              var p = path + "/" + text(a[i].getName());
              if (N.isSymbolicLink(a[i].toPath())) {
                fail("symlink_forbidden");
              }
              if (a[i].isDirectory()) {
                walk(p, depth + 1);
              } else if (a[i].isFile()) {
                out.push(p);
                if (out.length > 100) {
                  fail("too_many_support_files");
                }
              }
            }
          }
        }
        ["references", "scripts", "assets"].forEach(function (p) {
          walk(p, 0);
        });
        return out.sort();
      },
      lock: function (base, fn) {
        var locks = E.theApp;
        return new Packages.org.mozilla.javascript.Synchronizer(function () {
          return fn();
        }, locks)();
      },
      protectProject: function (name) {
        var p = project(name),
          v = read(p, ".httpignore") || "";
        if (!/^\/?\.tigo\/\*\*\s*$/m.test(v)) {
          write(
            p,
            ".httpignore",
            v +
              "\n# Tigo prompts, skills and MCP declarations are private over HTTP.\n/.tigo/**\n"
          );
        }
      },
      readSecrets: secrets,
      secretNames: function (base) {
        return Object.keys(secrets(base)).sort();
      },
      secret: function (base, name, value) {
        var s = secrets(base);
        if (value) {
          s[name] = value;
        } else {
          delete s[name];
        }
        write(base, "secrets.json", JSON.stringify(s));
      }
    };
  }
  return {
    create: create,
    normalize: normalize,
    conversationOwner: conversationOwner,
    javaHost: javaHost,
    manage: function (args) {
      return create(javaHost(context)).execute(args);
    },
    prepare: function (state) {
      try {
        return create(javaHost(context)).prepare(state);
      } catch (e) {
        var messages = {
            resource_missing: [
              "Une ressource active a été retirée. Ouvrez la bibliothèque et retirez les sélections indisponibles.",
              "An active resource was removed. Open the library and clear unavailable selections."
            ],
            skill_mcp_dependency_missing: [
              "Activez les connexions MCP requises par les skills sélectionnés dans la bibliothèque.",
              "Enable the MCP connections required by your selected skills in the library."
            ],
            mcp_secret_missing: [
              "Un secret MCP personnel est absent. Renseignez-le dans la bibliothèque avant de continuer.",
              "A personal MCP secret is missing. Set it in the library before continuing."
            ],
            mcp_changed_requires_review: [
              "Une connexion MCP active a changé. Vérifiez sa déclaration dans la bibliothèque puis réactivez-la.",
              "An active MCP connection changed. Review its declaration in the library and re-enable it."
            ],
            mcp_activation_admin_required: [
              "Un administrateur doit activer les connexions MCP.",
              "An administrator must enable MCP connections."
            ]
          },
          pair = messages[text(e.code || e.message)];
        if (pair) {
          e.message = pair[lang(state.language) === "fr" ? 0 : 1];
        }
        throw e;
      }
    }
  };
})();
