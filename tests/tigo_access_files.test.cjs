const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/tigo_access_files.js'), 'utf8');

function fixture(kind, failAt) {
  const calls = [];
  const entries = new Map();
  const fileSystem = { getUserPrincipalLookupService: () => ({
    lookupPrincipalByName(name) { calls.push(['principal', name]); return 'current-user-sid'; }
  }) };
  function file(name, directory = false) {
    return { name, directory, getFileSystem: () => fileSystem };
  }
  const directory = file('agents/convertigo', true);
  const key = file('agents/convertigo/llm-api-key');
  const temp = file('agents/convertigo/tigo-temp.tmp');
  function failed(name) {
    return { javaException: { getClass: () => ({ getSimpleName: () => name }) }, message: 'SECRET MUST NOT LEAK' };
  }
  const attributes = {
    PosixFileAttributeView: 'posix', AclFileAttributeView: 'acl',
    PosixFilePermissions: { fromString: mode => mode },
    AclEntryPermission: 'all-permissions',
    AclEntryType: { ALLOW: 'ALLOW' },
    AclEntryFlag: { FILE_INHERIT: 'FILE_INHERIT', DIRECTORY_INHERIT: 'DIRECTORY_INHERIT' },
    AclEntry: { newBuilder() {
      const value = {};
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
    getFileAttributeView(file, view, noFollow) {
      assert.equal(noFollow, 'NOFOLLOW_LINKS');
      if (view === 'posix' && kind === 'posix') {
        return { setPermissions(mode) { calls.push(['posix', file.name, mode]); } };
      }
      if (view === 'acl' && kind === 'windows') {
        return { setAcl(list) {
          calls.push(['acl', file.name]);
          if (failAt === 'acl') throw failed('AccessDeniedException');
          entries.set(file.name, list.values);
        } };
      }
      return null;
    },
    isDirectory: file => file.directory,
    createTempFile() { calls.push(['temporary']); return temp; },
    write(file, bytes) { calls.push(['write', file.name, bytes]); },
    move(from, to, atomic, replace) {
      calls.push(['move', from.name, to.name, atomic, replace]);
      if (failAt === 'move') throw failed('AtomicMoveNotSupportedException');
    },
    deleteIfExists(file) { calls.push(['cleanup', file.name]); }
  };
  const sandbox = { java: {
    lang: {
      System: { getProperty: name => name === 'os.name' ? 'Windows 11' : 'developer' },
      String: function (value) { this.getBytes = () => String(value); }
    },
    util: {
      EnumSet: { allOf: value => value },
      ArrayList: function () { this.values = []; this.add = value => this.values.push(value); }
    },
    nio: { file: { Files, attribute: attributes, LinkOption: { NOFOLLOW_LINKS: 'NOFOLLOW_LINKS' },
      StandardCopyOption: { ATOMIC_MOVE: 'ATOMIC_MOVE', REPLACE_EXISTING: 'REPLACE_EXISTING' } } }
  }, Packages: { com: { sun: { security: { auth: { module: {
    NTSystem: function () {
      this.getName = () => 'developer';
      this.getDomain = () => 'CLIENT';
    }
  } } } } } } };
  vm.runInNewContext(source, sandbox);
  const writer = sandbox.TigoAccessFiles.create(directory, file => calls.push(['safe', file.name]));
  return { api: sandbox.TigoAccessFiles, writer, directory, key, calls, entries };
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

test('ACL failures prevent writing a credential, clean the temporary file, and expose no exception message', () => {
  const f = fixture('windows', 'acl');
  let failure;
  try { f.writer.writePrivate(f.key, 'SECRET KEY'); } catch (error) { failure = error; }
  assert.ok(failure);
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
});

test('an unsupported atomic move is identified and the private temporary file is removed', () => {
  const f = fixture('windows', 'move');
  let failure;
  try { f.writer.writePrivate(f.key, 'test-only-key'); } catch (error) { failure = error; }
  assert.equal(f.api.failure(failure, 'write_key').cause, 'atomic_move_not_supported');
  assert.equal(f.calls.at(-1)[0], 'cleanup');
});
