const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/tigo_access_files.js'), 'utf8');

// A Java-like exception as Rhino hands it to a catch: the message must never reach a diagnostic.
function failed(name) {
  return { javaException: { getClass: () => ({ getSimpleName: () => name }) }, message: 'SECRET MUST NOT LEAK agents/convertigo' };
}

// options.moveFailures: exception class names thrown by the successive moves (a locked target), then the move works.
// options.contents: initial file contents by name. options.onSleep(delay, fixture): runs while the writer waits.
// options.posixMode / options.installedAcl: permissions already in place.
function fixture(kind, failAt, options = {}) {
  const calls = [];
  const entries = new Map();
  const sleeps = [];
  const contents = new Map(Object.entries(options.contents || {}));
  const moveFailures = (options.moveFailures || []).slice();
  const fileSystem = { getUserPrincipalLookupService: () => ({
    lookupPrincipalByName(name) { calls.push(['principal', name]); return 'current-user-sid'; }
  }) };
  function file(name, directory = false) {
    return { name, directory, getFileSystem: () => fileSystem,
      toAbsolutePath: () => ({ normalize: () => '/workspace/' + name }) };
  }
  const directory = file('agents/convertigo', true);
  const key = file('agents/convertigo/llm-api-key');
  const temp = file('agents/convertigo/tigo-temp.tmp');
  const list = values => ({ size: () => values.length, get: index => values[index], values });
  const attributes = {
    PosixFileAttributeView: 'posix', AclFileAttributeView: 'acl',
    PosixFilePermissions: { fromString: mode => mode, toString: mode => mode },
    AclEntryPermission: 'all-permissions',
    AclEntryType: { ALLOW: 'ALLOW' },
    AclEntryFlag: { FILE_INHERIT: 'FILE_INHERIT', DIRECTORY_INHERIT: 'DIRECTORY_INHERIT' },
    AclEntry: { newBuilder() {
      const value = { equals(other) {
        return !!other && other.type === value.type && other.principal === value.principal &&
          other.permissions === value.permissions && String(other.flags || '') === String(value.flags || '');
      } };
      const builder = {
        setType(type) { value.type = type; return builder; },
        setPrincipal(principal) { value.principal = principal; return builder; },
        setPermissions(permissions) { value.permissions = permissions; return builder; },
        setFlags(...flags) { value.flags = flags; return builder; },
        build: () => value
      };
      return builder;
    } }
  };
  const Files = {
    getFileAttributeView(target, view, noFollow) {
      assert.equal(noFollow, 'NOFOLLOW_LINKS');
      if (view === 'posix' && kind === 'posix') {
        return {
          readAttributes: () => ({ permissions: () => options.posixMode && options.posixMode[target.name] || 'rw-r--r--' }),
          setPermissions(mode) { calls.push(['posix', target.name, mode]); }
        };
      }
      if (view === 'acl' && kind === 'windows') {
        return {
          getAcl: () => list(options.installedAcl && options.installedAcl[target.name] || []),
          setAcl(acl) {
            calls.push(['acl', target.name]);
            if (failAt === 'acl') throw failed('AccessDeniedException');
            entries.set(target.name, acl.values);
          }
        };
      }
      return null;
    },
    isDirectory: target => target.directory,
    isRegularFile: target => contents.has(target.name),
    size: target => contents.get(target.name).length,
    readAllBytes(target) { calls.push(['read', target.name]); return contents.get(target.name); },
    createTempFile() { calls.push(['temporary']); return temp; },
    write(target, bytes) { calls.push(['write', target.name, bytes]); contents.set(target.name, bytes); },
    move(from, to, atomic, replace) {
      calls.push(['move', from.name, to.name, atomic, replace]);
      if (failAt === 'move') throw failed('AtomicMoveNotSupportedException');
      if (moveFailures.length) throw failed(moveFailures.shift());
      contents.set(to.name, contents.get(from.name));
      contents.delete(from.name);
    },
    deleteIfExists(target) { calls.push(['cleanup', target.name]); contents.delete(target.name); }
  };
  const monitors = [];
  const f = { calls, entries, sleeps, contents, monitors, directory, key, temp, file };
  const sandbox = { java: {
    lang: {
      System: { getProperty: name => name === 'os.name' ? (kind === 'windows' ? 'Windows 11' : 'Linux') : 'developer' },
      String: function (value) {
        this.getBytes = () => String(value);
        this.intern = () => { monitors.push(String(value)); return 'monitor:' + String(value); };
      },
      Thread: { sleep(delay) { sleeps.push(delay); if (options.onSleep) options.onSleep(delay, f); } }
    },
    util: {
      EnumSet: { allOf: value => value },
      ArrayList: function () { this.values = []; this.add = value => this.values.push(value); },
      Arrays: { equals: (a, b) => a === b }
    },
    nio: { file: { Files, attribute: attributes, LinkOption: { NOFOLLOW_LINKS: 'NOFOLLOW_LINKS' },
      StandardCopyOption: { ATOMIC_MOVE: 'ATOMIC_MOVE', REPLACE_EXISTING: 'REPLACE_EXISTING' } } }
  }, Packages: {
    org: { mozilla: { javascript: { Synchronizer: function (fn, monitor) {
      return () => { calls.push(['lock', monitor]); try { return fn(); } finally { calls.push(['unlock', monitor]); } };
    } } } },
    com: { sun: { security: { auth: { module: { NTSystem: function () {
      this.getName = () => 'developer';
      this.getDomain = () => 'CLIENT';
    } } } } } }
  } };
  vm.runInNewContext(source, sandbox);
  f.api = sandbox.TigoAccessFiles;
  f.writer = sandbox.TigoAccessFiles.create(directory, target => calls.push(['safe', target.name]));
  return f;
}

function failureOf(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a failure');
}

test('Windows uses a current-user-only ACL for the directory and credential files', () => {
  const f = fixture('windows');
  f.writer.restrict(f.directory);
  f.writer.writePrivate(f.key, 'test-only-key');
  assert.equal(f.calls.find(c => c[0] === 'principal')[1], 'CLIENT\\developer', 'resolve the signed-in domain user, not an identically named local account');
  for (const name of [f.directory.name, 'agents/convertigo/tigo-temp.tmp']) {
    const acl = f.entries.get(name);
    assert.equal(acl.length, 1, 'do not retain an inherited shared allow entry');
    assert.equal(acl[0].principal, 'current-user-sid');
    assert.equal(acl[0].type, 'ALLOW');
    assert.equal(acl[0].permissions, 'all-permissions');
  }
  assert.deepEqual(Array.from(f.entries.get(f.directory.name)[0].flags), ['FILE_INHERIT', 'DIRECTORY_INHERIT']);
  assert.equal(f.entries.get('agents/convertigo/tigo-temp.tmp')[0].flags, undefined);
  assert.ok(f.calls.findIndex(c => c[0] === 'acl' && c[1].endsWith('.tmp')) < f.calls.findIndex(c => c[0] === 'write'));
  assert.deepEqual(f.calls.find(c => c[0] === 'move').slice(-2), ['ATOMIC_MOVE', 'REPLACE_EXISTING']);
  assert.equal(f.contents.get(f.key.name), 'test-only-key');
});

test('POSIX retains private directory 0700 and private file 0600', () => {
  const f = fixture('posix');
  f.writer.restrict(f.directory);
  f.writer.writePrivate(f.key, 'test-only-key');
  assert.deepEqual(f.calls.filter(c => c[0] === 'posix'), [
    ['posix', f.directory.name, 'rwx------'],
    ['posix', 'agents/convertigo/tigo-temp.tmp', 'rw-------']
  ]);
  assert.equal(f.calls.some(c => c[0] === 'acl'), false);
});

test('permissions already private are not written again on a refresh', () => {
  const posix = fixture('posix', null, { posixMode: { 'agents/convertigo': 'rwx------' } });
  posix.writer.restrict(posix.directory);
  assert.equal(posix.calls.some(c => c[0] === 'posix'), false);
  // The ACL a previous installation set: one entry for the signed-in user, inherited by the children.
  const probe = fixture('windows');
  probe.writer.restrict(probe.directory);
  const installed = probe.entries.get(probe.directory.name);
  const windows = fixture('windows', null, { installedAcl: { 'agents/convertigo': installed } });
  windows.writer.restrict(windows.directory);
  assert.equal(windows.calls.some(c => c[0] === 'acl'), false);
  // An inherited shared entry beside it is removed as before.
  const shared = fixture('windows', null, { installedAcl: { 'agents/convertigo': [installed[0], { type: 'ALLOW', principal: 'Users' }] } });
  shared.writer.restrict(shared.directory);
  assert.deepEqual(shared.calls.filter(c => c[0] === 'acl'), [['acl', 'agents/convertigo']]);
});

test('identical bytes are not written again: no temporary file, no move', () => {
  const f = fixture('windows', null, { contents: { 'agents/convertigo/llm-api-key': 'test-only-key' } });
  assert.equal(f.writer.writePrivate(f.key, 'test-only-key'), false);
  assert.equal(f.calls.some(c => c[0] === 'temporary' || c[0] === 'write' || c[0] === 'move'), false);
  assert.equal(f.writer.writePrivate(f.key, 'other-test-key'), true);
  assert.equal(f.contents.get(f.key.name), 'other-test-key');
});

test('a target locked by another handle is replaced once released: the move is tried again', () => {
  // Windows: a second tab, an antivirus or an indexer holds the file for a moment.
  const f = fixture('windows', null, { contents: { 'agents/convertigo/llm-api-key': 'old-test-key' },
    moveFailures: ['AccessDeniedException', 'FileSystemException', 'AccessDeniedException'] });
  assert.equal(f.writer.writePrivate(f.key, 'new-test-key'), true);
  assert.equal(f.contents.get(f.key.name), 'new-test-key');
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 4);
  assert.deepEqual(f.sleeps, [50, 100, 200]);
  assert.equal(f.writer.attempts(), 4);
  assert.equal(f.calls.at(-1)[0], 'cleanup');
  assert.equal(f.contents.has(f.temp.name), false, 'the private temporary file never stays behind');
});

test('a file locked for good fails after six moves, keeps the old file and logs the exact cause', () => {
  const locked = Array(10).fill('AccessDeniedException');
  const f = fixture('windows', null, { contents: { 'agents/convertigo/tigo-access.json': '{"old":true}' }, moveFailures: locked });
  const metadata = f.file('agents/convertigo/tigo-access.json');
  const failure = failureOf(() => f.writer.writePrivate(metadata, '{"new":true}'));
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 6);
  assert.deepEqual(f.sleeps, [50, 100, 200, 400, 800], 'about 1.5 s in all before failing');
  assert.equal(f.contents.get(metadata.name), '{"old":true}');
  assert.equal(f.contents.has(f.temp.name), false);
  const diagnostic = f.api.failure(failure, 'write_metadata', f.writer.attempts());
  assert.deepEqual({ ...diagnostic }, { operation: 'write_metadata', cause: 'access_denied', exception: 'AccessDeniedException', attempts: 6 });
  assert.equal(f.api.logLine(diagnostic, false),
    'TigoAccess local credential installation failed (write_metadata, access_denied): AccessDeniedException, 6 move attempts');
  assert.equal(f.api.logLine(diagnostic, true),
    'TigoAccess local credential installation failed (write_metadata, access_denied): AccessDeniedException, 6 move attempts; ' +
    'the key in place is already the selected one, Tigo stays ready');
  assert.doesNotMatch(JSON.stringify(diagnostic) + f.api.logLine(diagnostic, true), /SECRET|agents/);
});

test('a lock held while another installation writes the same bytes ends without an error', () => {
  const f = fixture('windows', null, { contents: { 'agents/convertigo/llm-api-key': 'old-test-key' },
    moveFailures: Array(10).fill('FileSystemException'),
    onSleep: (_delay, state) => state.contents.set('agents/convertigo/llm-api-key', 'new-test-key') });
  assert.equal(f.writer.writePrivate(f.key, 'new-test-key'), false);
  assert.deepEqual(f.sleeps, [50]);
  assert.equal(f.contents.has(f.temp.name), false);
});

test('a failure that does not come from a held file is not retried', () => {
  const f = fixture('windows', 'move');
  const failure = failureOf(() => f.writer.writePrivate(f.key, 'test-only-key'));
  assert.equal(f.api.failure(failure, 'write_key', f.writer.attempts()).cause, 'atomic_move_not_supported');
  assert.equal(f.api.failure(failure, 'write_key', f.writer.attempts()).attempts, undefined);
  assert.deepEqual(f.sleeps, []);
  assert.equal(f.calls.at(-1)[0], 'cleanup');
});

test('ACL failures prevent writing a credential, clean the temporary file, and expose no exception message', () => {
  const f = fixture('windows', 'acl');
  const failure = failureOf(() => f.writer.writePrivate(f.key, 'SECRET KEY'));
  assert.equal(f.calls.some(c => c[0] === 'write' || c[0] === 'move'), false);
  assert.equal(f.calls.at(-1)[0], 'cleanup');
  const diagnostic = f.api.failure(failure, 'write_key');
  assert.equal(diagnostic.cause, 'access_denied');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|agents/);
});

test('unsupported permission stores fail closed rather than keeping credentials readable', () => {
  const f = fixture('unsupported');
  assert.throws(() => f.writer.restrict(f.directory), /Private credential permissions/);
  assert.equal(f.calls.some(c => c[0] === 'write'), false);
  assert.equal(f.api.failure(failureOf(() => f.writer.restrict(f.directory)), 'restrict_directory').cause, 'private_permissions_unavailable');
});

test('installations of one credential directory share one engine-wide monitor', () => {
  const f = fixture('windows');
  const order = [];
  const result = f.api.serialized(f.directory, () => { order.push(f.calls.at(-1)[0]); return 'done'; });
  assert.equal(result, 'done');
  assert.deepEqual(order, ['lock']);
  assert.equal(f.calls.at(-1)[0], 'unlock');
  f.api.serialized(f.file('agents/convertigo', true), () => null);
  assert.deepEqual(f.monitors, ['lib_ConvertigoAssistant.tigoAccess.install:/workspace/agents/convertigo',
    'lib_ConvertigoAssistant.tigoAccess.install:/workspace/agents/convertigo'], 'an interned string survives include() of every run');
  assert.throws(() => f.api.serialized(f.directory, () => { throw new Error('install failed'); }), /install failed/);
  assert.equal(f.calls.at(-1)[0], 'unlock', 'a failure releases the monitor');
});
