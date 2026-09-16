// Server-side stack installation: URL allow-list, access policy and install order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function load({ symbol = '', admin = false, user = '', projects = {}, gitCheckouts = [] } = {}) {
  const imported = [];
  const manager = {
    symbolsGetValue: name => (name === 'assistant.stack.selfupdate' ? symbol : null),
    existsProject: name => Object.prototype.hasOwnProperty.call(projects, name),
    getOriginalProjectByName: name => ({ getVersion: () => projects[name], getName: () => name, getDirFile: () => name })
  };
  const sandbox = {
    log: { info() {}, warn() {} },
    context: { httpSession: {}, getAuthenticatedUser: () => user },
    Packages: {
      com: { twinsoft: { convertigo: {
        engine: {
          Engine: {
            theApp: {
              databaseObjectsManager: manager,
              schemaManager: { clearCache() {} },
              referencedProjectManager: {
                importProject(parser) {
                  imported.push(parser.url);
                  const name = parser.url.split('=')[0];
                  projects[name] = parser.url.match(/download\/v([^/]+)\//)[1];
                  return { getName: () => name };
                }
              }
            },
            authenticatedSessionManager: { hasRole: () => admin }
          },
          AuthenticatedSessionManager: { Role: { WEB_ADMIN: 'WEB_ADMIN', PROJECTS_CONFIG: 'PROJECTS_CONFIG' } },
          util: {
            ProjectUrlParser: function (url) { this.url = url; this.isValid = () => true; },
            GitUtils: { getWorkingDir: dir => (gitCheckouts.includes(dir) ? '/git/' + dir : null) }
          },
          sync: { SharedWorkspaceSyncManager: { markProjectReload() {} } }
        },
        beans: { core: { Project: { executeAutoStartSequences() {} } } }
      } } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/agent_stack_server.js'), 'utf8'), sandbox);
  return { stack: sandbox.C8O.assistantAgentStack, imported, projects };
}

const manifest = [
  { name: 'lib_ConvertigoAssistant', version: '1.4.17', importUrl: 'lib_ConvertigoAssistant=https://github.com/convertigo/c8oprj-lib-convertigo-assistant/releases/download/v1.4.17/lib_ConvertigoAssistant.car' },
  { name: 'lib_ConvertigoMCP', version: '0.2.8', importUrl: 'lib_ConvertigoMCP=https://github.com/convertigo/c8oprj-lib-c8o-mcp/releases/download/v0.2.8/lib_ConvertigoMCP.car' },
  { name: 'lib_ConvertigoAgentBridge', version: '0.4.11', importUrl: 'lib_ConvertigoAgentBridge=https://github.com/convertigo/c8oprj-lib-convertigo-agent-bridge/releases/download/v0.4.11/lib_ConvertigoAgentBridge.car' }
];

test('only official release CARs of the three repositories are accepted', () => {
  const { stack } = load();
  assert.equal(stack.validateImportUrl('lib_ConvertigoMCP', manifest[1].importUrl), manifest[1].importUrl);
  assert.equal(stack.validateImportUrl('lib_ConvertigoMCP', 'https://github.com/convertigo/c8oprj-lib-c8o-mcp/releases/download/v0.2.8/lib_ConvertigoMCP.car'), manifest[1].importUrl);
  assert.equal(stack.validateImportUrl('lib_ConvertigoMCP', 'lib_ConvertigoMCP=https://evil.example/lib_ConvertigoMCP.car'), '');
  assert.equal(stack.validateImportUrl('lib_ConvertigoMCP', 'lib_ConvertigoMCP=https://github.com/convertigo/c8oprj-lib-c8o-mcp.git:branch=master'), '');
  assert.equal(stack.validateImportUrl('lib_ConvertigoMCP', 'lib_ConvertigoMCP=https://github.com/convertigo/other-repo/releases/download/v1/lib_ConvertigoMCP.car'), '');
  assert.equal(stack.validateImportUrl('lib_Other', 'lib_Other=https://github.com/convertigo/c8oprj-lib-c8o-mcp/releases/download/v0.2.8/lib_Other.car'), '');
});

test('policy defaults to administrator sessions and honours the symbol', () => {
  assert.equal(load().stack.updateAllowed({}).allowed, false);
  assert.equal(load().stack.updateAllowed({}).reason, 'admin_required');
  assert.equal(load({ admin: true }).stack.updateAllowed({}).allowed, true);
  assert.equal(load({ symbol: 'authenticated' }).stack.updateAllowed({}).allowed, false);
  assert.equal(load({ symbol: 'authenticated', user: 'jane@example.com' }).stack.updateAllowed({}).allowed, true);
  assert.equal(load({ symbol: 'true' }).stack.updateAllowed({}).allowed, true);
  assert.equal(load({ symbol: 'false', admin: true }).stack.updateAllowed({}).allowed, false);
  const checkout = load({ admin: true, projects: { lib_ConvertigoMCP: '0.2.8' }, gitCheckouts: ['lib_ConvertigoMCP'] });
  assert.equal(checkout.stack.updateAllowed({}).reason, 'source_managed');
  assert.equal(checkout.stack.install({ projects: manifest, forceUpdate: true }).status, 'forbidden');
  assert.equal(checkout.imported.length, 0);
  const status = load({ projects: { lib_ConvertigoAssistant: '1.4.16' } }).stack.status({});
  assert.equal(status.localAssistantVersion, '1.4.16');
  assert.equal(status.localMcpInstalled, false);
  assert.equal(status.localAgentStackState, 'missing');
  assert.equal(status.localAgentStackUpdatePolicy, 'admin');
});

test('install imports missing or outdated projects in dependency order, the Assistant last', () => {
  const { stack, imported } = load({ admin: true, projects: { lib_ConvertigoAssistant: '1.4.16', lib_ConvertigoMCP: '0.2.8' } });
  const javaString = { toString: () => JSON.stringify(manifest) };
  const result = stack.install({ projects: javaString, forceUpdate: 'false' });
  assert.equal(result.status, 'success');
  assert.deepEqual(imported.map(url => url.split('=')[0]), ['lib_ConvertigoAgentBridge', 'lib_ConvertigoAssistant']);
  assert.equal(result.results.map(entry => entry.action).join(','), 'up_to_date,installed,updated');
  assert.equal(result.assistantUpdated, true);
  assert.equal(result.state.localAgentBridgeVersion, '0.4.11');
});

test('forceUpdate reinstalls everything and forbidden sessions import nothing', () => {
  const forced = load({ admin: true, projects: { lib_ConvertigoAssistant: '1.4.17', lib_ConvertigoMCP: '0.2.8', lib_ConvertigoAgentBridge: '0.4.11' } });
  assert.equal(forced.stack.install({ projects: manifest, forceUpdate: true }).installedCount, 3);
  const denied = load({ projects: {} });
  const result = denied.stack.install({ projects: manifest, forceUpdate: true });
  assert.equal(result.status, 'forbidden');
  assert.equal(denied.imported.length, 0);
  const tampered = load({ admin: true });
  const rejected = tampered.stack.install({ projects: [{ name: 'lib_ConvertigoMCP', version: '9.9.9', importUrl: 'lib_ConvertigoMCP=https://evil.example/x.car' }] });
  assert.equal(rejected.status, 'error');
  assert.equal(rejected.results[0].action, 'rejected');
  assert.equal(tampered.imported.length, 0);
});

test('the Assistant page routes stack installation to the server when no Studio hosts it', () => {
  const ts = require(path.join(root, '_private/ionic/node_modules/typescript'));
  const page = fs.readFileSync(path.join(root, '_c8oProject/mobilePages/Page.yaml'), 'utf8');
  for (const marker of ['public isServerManagedAgentStack()', 'public refreshAgentStackServerStatus()', 'public installAgentStackOnServer(payload, forceUpdate)', 'lib_ConvertigoAssistant.AgentStackStatus', 'lib_ConvertigoAssistant.AgentStackInstall', 'Agent_Stack_Server_Restricted:']) {
    assert.ok(page.includes(marker), marker);
  }
  const start = page.indexOf('public isServerManagedAgentStack()');
  const end = page.indexOf('public getAgentActivationProjects()');
  const source = page.slice(start, end).replace(/''/g, "'");
  const diagnostics = ts.transpileModule('class Page {\n' + source + '\n}', { reportDiagnostics: true }).diagnostics || [];
  assert.deepEqual(diagnostics.map(d => d.messageText), []);
  const project = fs.readFileSync(path.join(root, 'c8oProject.yaml'), 'utf8');
  assert.ok(project.includes('sequences/AgentStackInstall.yaml') && project.includes('sequences/AgentStackStatus.yaml'));
});
