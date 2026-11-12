// The Studio on the desktop: the Eclipse Studio (Studio mode) and the Electron Studio, whose engine is a desktop Studio
// without Studio mode (Engine.isDesktopStudio, Convertigo 8.5). Both get the Studio's Tigo key, identity, quota and
// feedback; a server, and an 8.4 engine that has no isDesktopStudio, keep the server rules.
// node --test tests/desktop_studio.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers/assistant-source.cjs');

// eclipse: Studio mode; electron: desktop Studio engine; server: a Convertigo 8.5 server; server84: no isDesktopStudio
const ENGINES = {
  eclipse: { isStudioMode: () => true },
  electron: { isStudioMode: () => false, isDesktopStudio: () => true },
  server: { isStudioMode: () => false, isDesktopStudio: () => false },
  server84: { isStudioMode: () => false }
};
const DESKTOP = ['eclipse', 'electron'];

function engine(kind, admin) {
  return { ...ENGINES[kind], USER_WORKSPACE_PATH: '/workspace',
    authenticatedSessionManager: { hasRole: (session, role) => role === 'WEB_ADMIN' && admin === true },
    theApp: { databaseObjectsManager: { symbolsGetValue: () => null } } };
}

function packages(Engine) {
  const com = { twinsoft: { convertigo: { engine: { Engine, AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN' } },
    EngineException: class extends Error {} } } } };
  return { com, Packages: { com } };
}

// the JavaScript of the first expression of a sequence, as the Studio runs it
function stepSource(file) {
  const yaml = read(file).split('\n');
  const start = yaml.findIndex(l => /expression: \|/.test(l));
  const indent = yaml[start].search(/\S/), lines = [];
  for (let i = start + 1; i < yaml.length; i++) {
    if (yaml[i].trim() && yaml[i].search(/\S/) <= indent) break;
    lines.push(yaml[i].slice(indent + 2));
  }
  let source = lines.join('\n').trim();
  if (source.startsWith("'") && source.endsWith("'")) source = source.slice(1, -1).replace(/''/g, "'");
  return source;
}

for (const sequence of ['TigoAccessBootstrap', 'TigoAccessStatus']) {
  test(sequence + ': the WEB_ADMIN of a desktop Studio only', () => {
    const source = stepSource('_c8oProject/sequences/' + sequence + '.yaml');
    const guard = source.slice(0, source.indexOf('function hashLocal'));
    for (const kind of Object.keys(ENGINES)) {
      for (const admin of [true, false]) {
        const run = () => vm.runInNewContext(guard, { ...packages(engine(kind, admin)), context: { httpSession: {} } });
        if (admin && DESKTOP.includes(kind)) {
          assert.doesNotThrow(run, kind);
        } else {
          assert.throws(run, /Authenticated local Studio session required/, kind + (admin ? ' admin' : ''));
        }
      }
    }
  });
}

test('AgentSetup activates Tigo for the WEB_ADMIN of a desktop Studio only', () => {
  const condition = read('_c8oProject/sequences/AgentSetup.yaml').match(/↓PrepareTigoAccess [^\n]*\n\s+condition: ([^\n]+)\n/)[1];
  for (const kind of Object.keys(ENGINES)) {
    for (const admin of [true, false]) {
      const active = vm.runInNewContext(condition, { ...packages(engine(kind, admin)), context: { httpSession: {} }, provider: 'convertigo' });
      assert.equal(active, admin && DESKTOP.includes(kind), kind + (admin ? ' admin' : ''));
    }
  }
  assert.equal(vm.runInNewContext(condition, { ...packages(engine('electron', true)), context: { httpSession: {} }, provider: 'codex' }), false);
});

test('AgentQuota: the desktop Studio quota is the Studio one, a server one the user of the session', () => {
  const source = stepSource('_c8oProject/sequences/AgentQuota.yaml');
  const authorize = source.slice(0, source.indexOf('provider=String(provider'));
  const run = (kind, admin, user) => {
    const box = { ...packages(engine(kind, admin)), context: { httpSession: {}, getAuthenticatedUser: () => user } };
    vm.runInNewContext(authorize + '\nresult={studio:studio,trustedUserId:trustedUserId};', box);
    return box.result;
  };
  for (const kind of DESKTOP) {
    assert.deepEqual({ ...run(kind, true, 'c8o:admin') }, { studio: true, trustedUserId: 'studio' }, kind);
    assert.throws(() => run(kind, false, 'forms-user'), /A WEB_ADMIN session is required/, kind);
  }
  for (const kind of ['server', 'server84']) {
    assert.deepEqual({ ...run(kind, false, 'alice@example.com') }, { studio: false, trustedUserId: 'alice@example.com' }, kind);
    assert.throws(() => run(kind, false, ''), /Authenticated Assistant session required/, kind);
  }
});

test('AgentFeedback and AgentResources treat a desktop Studio as the Studio', () => {
  const feedback = stepSource('_c8oProject/sequences/AgentFeedback.yaml');
  const first = feedback.slice(0, feedback.indexOf('var admin='));
  for (const kind of Object.keys(ENGINES)) {
    const box = packages(engine(kind, true));
    vm.runInNewContext(first, box);
    assert.equal(box.studio, DESKTOP.includes(kind), kind);
  }
  const resources = read('_c8oProject/sequences/AgentResources.yaml');
  assert.match(resources, /Engine\.isDesktopStudio\(\) === true/);
  assert.match(resources, /if \(code === "authentication_required" && desktop\)/);
});

function resourcesIdentity(kind, admin, user) {
  const Engine = engine(kind, admin);
  const sandbox = {
    Packages: {
      com: { twinsoft: { convertigo: { engine: { Engine, AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN' } },
        EnginePropertiesManager: {} } } } },
      java: { io: { File: class {} }, nio: { file: { Files: {} }, charset: { StandardCharsets: { UTF_8: 'UTF-8' } } },
        security: { MessageDigest: { getInstance: () => ({ digest: () => [1, 2, 255] }) } } }
    },
    java: { lang: { String: class { getBytes() { return []; } } } }
  };
  vm.runInNewContext(read('js/tigo_resources.js'), sandbox);
  const host = sandbox.C8O.tigoResources.javaHost({ httpSession: {}, getAuthenticatedUser: () => user, httpServletRequest: null });
  return { ...host.identity() };
}

test('Tigo library: the desktop Studio has the Studio identity and prompts, a server user their own', () => {
  for (const kind of DESKTOP) {
    assert.deepEqual(resourcesIdentity(kind, true, 'c8o:admin'), { admin: true, surface: 'studio', user: 'studio', owner: 'studio', key: 'studio' }, kind);
    assert.throws(() => resourcesIdentity(kind, false, 'forms-user'), /authentication_required/, kind);
  }
  for (const kind of ['server', 'server84']) {
    const identity = resourcesIdentity(kind, false, 'alice@example.com');
    assert.equal(identity.surface, 'nocode', kind);
    assert.equal(identity.user, 'alice@example.com', kind);
    assert.equal(identity.key, '0102ff', kind);
  }
});

test('feedback store: the desktop Studio uses the Studio store and its Tigo key, a server its feedback key', () => {
  const source = read('js/agent_feedback.js');
  const helper = source.match(/\n    function localStudio\(\) \{\n[\s\S]*?\n    \}\n/)[0];
  for (const kind of Object.keys(ENGINES)) {
    assert.equal(vm.runInNewContext(helper + 'localStudio();', { Engine: engine(kind, true) }), DESKTOP.includes(kind), kind);
  }
  assert.match(source, /studio: function \(\) \{\n\s+return localStudio\(\);/);
  assert.match(source, /serverKey: function \(\) \{\n\s+if \(localStudio\(\)\) \{/);
  assert.match(source, /if \(!userKey\.length \|\| localStudio\(\)\) \{/);
  assert.match(source, /readKey: function \(\) \{\n\s+if \(!localStudio\(\)\) \{/);
});
